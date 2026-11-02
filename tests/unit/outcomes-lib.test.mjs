import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { timeline, grade, summarizeOutcomes, runFailed } from '../live/outcomes/lib.mjs'
import { ROOT } from '../helpers.mjs'

const spec = Object.fromEntries(JSON.parse(readFileSync(join(ROOT, 'tests', 'live', 'outcomes', 'outcomes.json'), 'utf8')).prompts.map((p) => [p.id, p]))

// minimal stream-json builders
let n = 0
const text = (t) => ({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })
const use = (name, input) => { const id = `t${++n}`; return [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } }, id] }
const result = (id, out, isErr = false) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: out, is_error: isErr }] } })
const call = (name, input, out = 'ok', isErr = false) => { const [u, id] = use(name, input); return [u, result(id, out, isErr)] }
const edit = (f) => call('Edit', { file_path: `/tmp/x/shop-cart/${f}` })
const run = (out) => call('Bash', { command: 'node --test test/' }, out, /# fail [1-9]/.test(out))

test('timeline: tool results attach to their calls; paths are fixture-relative', () => {
  const steps = timeline([...edit('src/cart.js'), ...run('# pass 1\n# fail 2'), text('done')])
  assert.deepEqual(steps.map((s) => s.kind), ['edit', 'bash', 'text'])
  assert.equal(steps[0].file, 'src/cart.js')
  assert.equal(runFailed(steps[1]), true)
})

test('debug: root cause before the fix passes; fixing first fails; scope creep fails diffWithin', () => {
  const good = timeline([...run('not ok 1 - quantity discount\n# fail 1'), text('Root cause: `qty > 10` should be `>= 10`.'), ...edit('src/cart.js')])
  const g = grade(spec['debug-fix'], good, { changed: { 'src/cart.js': 2 }, graders: { 'discount-test-passes': true } })
  assert.equal(g.pass, true)
  assert.equal(g.checks.reproducedFirst.pass, true)

  const rushed = timeline([...edit('src/cart.js'), text('Fixed: qty > 10 was off by one.')])
  const r = grade(spec['debug-fix'], rushed, { changed: { 'src/cart.js': 2, 'src/coupons.js': 1 }, graders: { 'discount-test-passes': true } })
  assert.equal(r.checks.rootCauseBeforeFix.pass, false)
  assert.equal(r.checks.reproducedFirst.soft, true, 'reproduction is soft (tools may not allow it)')
  assert.match(r.checks.diffWithin.why, /outside scope: src\/coupons.js/)
  assert.equal(r.pass, false)
})

test('feature: stopping at design passes; editing after brainstorming passes; editing blind fails', () => {
  assert.equal(grade(spec['feat-design'], timeline([text('Questions first: …')]), { changed: {}, graders: {} }).pass, true)
  const designed = timeline([...call('Skill', { skill: 'superpowers:brainstorming' }), ...edit('src/cart.js')])
  assert.equal(grade(spec['feat-design'], designed, { changed: { 'src/cart.js': 9 }, graders: {} }).pass, true)
  const blind = timeline([...edit('src/cart.js')])
  assert.equal(grade(spec['feat-design'], blind, { changed: { 'src/cart.js': 9 }, graders: {} }).checks.designBeforeEdit.pass, false)
})

test('tdd: test then red run then src passes; green-only or src-first fails', () => {
  const red = timeline([...edit('test/cart.test.js'), ...run('not ok 4 - itemCount\n# fail 1'), ...edit('src/cart.js'), ...run('# fail 0')])
  assert.equal(grade(spec['tdd-new'], red, { changed: { 'src/cart.js': 3, 'test/cart.test.js': 6 }, graders: { 'itemCount-works': true } }).pass, true)
  const noRed = timeline([...edit('test/cart.test.js'), ...edit('src/cart.js'), ...run('# fail 0')])
  assert.match(grade(spec['tdd-new'], noRed, { changed: {}, graders: { 'itemCount-works': true } }).checks.testFirst.why, /no failing run/)
  const srcFirst = timeline([...edit('src/cart.js'), ...edit('test/cart.test.js')])
  assert.match(grade(spec['tdd-new'], srcFirst, { changed: {}, graders: { 'itemCount-works': true } }).checks.testFirst.why, /src edited before/)
})

test('coverage: tests must be run after writing them, src untouched', () => {
  const ok = timeline([...edit('test/cart.test.js'), ...run('# fail 0')])
  assert.equal(grade(spec.coverage, ok, { changed: { 'test/cart.test.js': 12 }, graders: {} }).pass, true)
  const touched = grade(spec.coverage, ok, { changed: { 'test/cart.test.js': 12, 'src/cart.js': 1 }, graders: {} })
  assert.equal(touched.checks.diffWithin.pass, false)
})

test('summary counts runs and checks per condition', () => {
  const s = summarizeOutcomes([
    { condition: 'with', id: 'coverage', graded: { pass: true, checks: { diffWithin: { pass: true } } } },
    { condition: 'with', id: 'coverage', graded: { pass: false, checks: { diffWithin: { pass: false } } } },
    { condition: 'nocontract', id: 'coverage', error: 'x' },
  ])
  assert.deepEqual(s, { with: { runs: 2, pass: 1, checks: { 'coverage/diffWithin': { n: 2, pass: 1, soft: false } } } })
})

test('shell writes into src/ or test/ count as edits (acceptEdits lets them through)', () => {
  const steps = timeline([
    ...call('Bash', { command: "cat >> test/cart.test.js <<'EOF'\ntest('x', () => {})\nEOF" }),
    ...call('Bash', { command: "sed -i 's/> 10/>= 10/' src/cart.js" }),
    ...call('Bash', { command: 'cat src/cart.js | grep qty' }),
  ])
  assert.deepEqual(steps.map((s) => [s.kind, s.file ?? null]), [['edit', 'test/cart.test.js'], ['edit', 'src/cart.js'], ['bash', null]])
})
