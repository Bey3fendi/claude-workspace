import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../helpers.mjs'
import { buildRecord, citedPaths, exitFrom, isCommit, isVerification, newDecisions, nextUnitId, parseHunks, parseNumstat, parseTarget, recordText, validate, wordsFrom, EXPLAIN_ALLOWS } from '../../plugins/workspace-core/lib/explain.mjs'
import { createTracker } from '../../plugins/workspace-core/lib/usage.mjs'
import { ENTRIES } from '../../cli/lib/gitignore.mjs'

const NUMSTAT = '38\t4\tsrc/decide.js\n12\t0\ttests/decide.test.js\n-\t-\tlogo.png\n0\t0\tsrc/{old => new}/name.js\n'
const DIFF = [
  'diff --git a/src/decide.js b/src/decide.js', '--- a/src/decide.js', '+++ b/src/decide.js',
  '@@ -40,0 +41,38 @@ export function decide', '+x', '@@ -90,2 +128,0 @@', '-gone',
  'diff --git a/tests/decide.test.js b/tests/decide.test.js', '--- /dev/null', '+++ b/tests/decide.test.js', '@@ -0,0 +1,12 @@', '+t',
  'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null', '@@ -1,3 +0,0 @@',
].join('\n')
const T0 = Date.parse('2026-11-11T10:00:00Z')
const record = () => buildRecord({
  unit: 'u-0001', target: null, requests: ['hold tainted writes'],
  numstat: parseNumstat(NUMSTAT).filter((f) => f.path !== 'logo.png' && !f.path.includes('name.js')), hunks: parseHunks(DIFF),
  untracked: [{ path: 'docs/taint.md', lines: 5 }],
  commands: [{ cmd: 'ls -la', exit: 0, at: T0 }, { cmd: 'npm test', exit: 1, at: T0 + 1 }, { cmd: 'npm test', exit: 0, at: T0 + 3 }],
  lastEditAt: T0 + 2, skills: ['superpowers:test-driven-development'], decisions: ['Clamp at zero'], closedAt: '2026-11-11T10:05:00Z',
})

const GOOD = `# u-0001 · Writes after untrusted input need approval

**In short:** Writes now wait for approval after the agent reads untrusted text. Before, an injected request could change every tenant.

## What changed
- **Decision rule:** two branches for tainted sessions → \`src/decide.js:41-78\`
- **Tests:** 2 new cases → \`tests/decide.test.js:1-12\` · ran \`npm test\` (exit 0)
- **Notes:** \`docs/taint.md\` explains the flag.

## Why
You asked to "hold tainted writes". The old entry point stays the same (context) \`src/index.js:3\`.

## How it works now
1. A read of untrusted text marks the session.
2. A later write asks \`decide()\`, which sees the mark.

## Not done / not tested
- The timeout path is not tested.

## Verify yourself
\`\`\`sh
npm test
\`\`\`

## Start reading at
\`src/decide.js:41\`

<details><summary>Details</summary>
Nothing else.
</details>
`

test('diff parsing: numstat (binary, renames), new-side hunks, decisions', () => {
  const n = parseNumstat(NUMSTAT)
  assert.deepEqual(n[0], { path: 'src/decide.js', added: 38, removed: 4 })
  assert.deepEqual(n[2], { path: 'logo.png', added: null, removed: null })
  assert.equal(n[3].path, 'src/new/name.js')
  assert.deepEqual(parseHunks(DIFF), { 'src/decide.js': [[41, 78]], 'tests/decide.test.js': [[1, 12]] })
  assert.deepEqual(newDecisions('+## Clamp at zero\n+- why\n ## Old\n-## Removed\n'), ['Clamp at zero'])
})

test('record: facts only; read-only commands dropped; verified only after the last edit', () => {
  const r = record()
  assert.deepEqual(r.files.map((f) => f.path), ['src/decide.js', 'tests/decide.test.js', 'docs/taint.md'])
  assert.deepEqual(r.files[2], { path: 'docs/taint.md', added: 5, removed: 0, hunks: [[1, 5]], new: true })
  assert.deepEqual(r.commands.map((c) => [c.cmd, c.exit]), [['npm test', 1], ['npm test', 0]])
  assert.equal(r.verifiedAfterLastEdit, 'npm test')
  const stale = buildRecord({ ...{ unit: 'u-1', numstat: [], hunks: {}, commands: [{ cmd: 'npm test', exit: 0, at: 1 }] }, lastEditAt: 5 })
  assert.equal(stale.verifiedAfterLastEdit, false, 'a test run before the last edit does not count')
  assert.equal(buildRecord({ unit: 'u-1', target: 'HEAD', numstat: [], hunks: {} }).verifiedAfterLastEdit, 'n/a (a commit)')
  assert.match(recordText(r, '.explain/records/u-0001.json'), /write the explanation to `\.explain\/units\/u-0001\.md`/)
  assert.match(recordText({ ...r, files: [] }, 'x'), /nothing to explain; write no file/)
})

test('helpers: target, exit codes, commits, verification commands, unit ids, word budget', () => {
  assert.equal(parseTarget('Target: \n'), null)
  assert.equal(parseTarget('Target: $ARGUMENTS'), null)
  assert.equal(parseTarget('x\nTarget: HEAD~2\n'), 'HEAD~2')
  assert.deepEqual(parseTarget('Target: HEAD; rm -rf /'), { invalid: 'HEAD; rm -rf /' })
  assert.equal(exitFrom({ text: 'ok' }), 0)
  assert.equal(exitFrom({ isError: true, text: 'Exit code 2\nboom' }), 2)
  assert.equal(exitFrom({ isError: true, text: 'boom' }), 1)
  assert.equal(exitFrom({ deny: 'no' }), null)
  assert.ok(isCommit('git commit -m "x"') && isCommit('git -c user.name=a commit -F -') && !isCommit('git commit --dry-run') && !isCommit('git log'))
  assert.ok(isVerification('npm test') && isVerification('cargo test -q') && !isVerification('git push'))
  assert.equal(nextUnitId(['u-0001.json', 'u-0009.json', 'x.json']), 'u-0010')
  assert.equal(nextUnitId([]), 'u-0001')
  assert.equal(wordsFrom('500'), 500); assert.equal(wordsFrom('5'), 300); assert.equal(wordsFrom(undefined), 300)
  assert.deepEqual(citedPaths('see `a/b.js:3` and http://x.io:80\n```\nc.js:1\n```\n'), ['a/b.js', 'x.io'])
})

test('validator: a good explanation passes all 8 rules', () => {
  const res = validate(GOOD, record(), { exists: (p) => p === 'src/index.js' })
  assert.deepEqual(res.failed, [])
  assert.equal(res.passed.length, 8)
})

test('validator: each rule fails on its own fixture', () => {
  const r = record()
  const fails = (md, opts) => validate(md, r, { exists: () => true, ...opts }).failed.map((f) => f.rule)
  assert.deepEqual(fails(GOOD.replace('## Why', '## Reason')), ['structure'])
  assert.deepEqual(fails(GOOD.replace('**In short:** Writes', '**In short:** One. Two. Three. Writes')), ['structure'])
  assert.deepEqual(fails(GOOD.replace('`src/decide.js:41-78`', '`src/decide.js:200-210`')), ['grounding-files'])
  assert.deepEqual(fails(GOOD.replace('(context) `src/index.js:3`', '`src/index.js:3`')), ['grounding-files'])
  assert.deepEqual(fails(GOOD, { exists: () => false }), ['grounding-files'], 'a (context) citation must exist')
  assert.deepEqual(fails(GOOD.replace('ran `npm test` (exit 0)', 'ran `npm run lint` (exit 0)')), ['grounding-commands'])
  assert.deepEqual(fails(GOOD.replace('ran `npm test` (exit 0)', 'ran `npm test` (exit 3)')), ['grounding-commands'])
  assert.deepEqual(fails(GOOD.replace('`docs/taint.md` explains the flag.', 'a notes file explains the flag.')), ['coverage'])
  assert.deepEqual(fails(GOOD.replace('- The timeout path is not tested.', '')), ['honesty'])
  const noPass = { ...r, commands: r.commands.filter((c) => c.exit !== 0) }
  assert.deepEqual(validate(GOOD.replace(' · ran `npm test` (exit 0)', '').replace('2 new cases', '2 new cases, all pass'), noPass, { exists: () => true }).failed.map((f) => f.rule), ['honesty'])
  assert.deepEqual(fails(GOOD.replace('marks the session', 'marks the session in a robust way')), ['readability'])
  assert.deepEqual(fails(GOOD.replace('A later write asks', `A later write ${'very '.repeat(36)}asks`)), ['readability'])
  assert.deepEqual(fails(GOOD.replace('## Not done', '```mermaid\nflowchart LR\n```\n```mermaid\nflowchart LR\n```\n\n## Not done')), ['diagrams'])
  assert.deepEqual(fails(GOOD, { maxWords: 100 }), ['length'])
  assert.deepEqual(fails(GOOD.replace('Nothing else.', 'A short note here. '.repeat(100))), [], 'Details do not count toward the budget')
})

test('footer: explain lines are engine evidence', () => {
  const t = createTracker()
  t.turnStart(); t.explain({ unit: 'u-0002', files: 3 })
  assert.match(t.finish('').footer, /explain u-0002: record captured, no file written/)
  t.turnStart(); t.explain({ unit: 'u-0002', passed: 6, total: 8, failedRules: ['coverage', 'length'] })
  assert.match(t.finish('').footer, /explain u-0002: 6\/8 checks \(failed: coverage, length\)/)
  t.turnStart(); t.explain({ commit: true })
  assert.match(t.finish('').footer, /commit made: \/explain HEAD explains it/)
})

test('install wiring: .explain/ ignored, writes allowed, skill run by the developer only', () => {
  assert.ok(ENTRIES.includes('.explain/'))
  assert.deepEqual(EXPLAIN_ALLOWS, ['Edit(.explain/**)'])
  const skill = readFileSync(join(ROOT, 'plugins', 'workspace-core', 'skills', 'explain', 'SKILL.md'), 'utf8')
  assert.match(skill, /^disable-model-invocation: true$/m)
  assert.match(skill, /^Target: \$ARGUMENTS$/m)
})

test('piped commands: flagged, and named with a caveat as verification', () => {
  const r = buildRecord({ unit: 'u-1', numstat: [], hunks: {}, commands: [{ cmd: 'node --test 2>&1 | tail -10', exit: 0, at: 9 }], lastEditAt: 5 })
  assert.equal(r.commands[0].piped, true)
  assert.match(r.verifiedAfterLastEdit, /piped: exit 0 is the last stage's/)
  assert.equal(buildRecord({ unit: 'u-1', numstat: [], hunks: {}, commands: [{ cmd: 'npm test || echo "a|b"', exit: 0, at: 9 }] }).commands[0].piped, undefined)
  assert.equal(buildRecord({ unit: 'u-1', numstat: [], hunks: {}, commands: [{ cmd: 'set -o pipefail; npm test | tail', exit: 0, at: 9 }] }).commands[0].piped, undefined)
})

test('footer: a slash-command skill that loads before its turn starts is still counted', () => {
  const t = createTracker()
  t.skillPrompt('workspace-core:explain'); t.turnStart(); t.explain({ unit: 'u-0003', passed: 8, total: 8, failedRules: [] })
  const f = t.finish('').footer
  assert.match(f, /activated workspace-core:explain/); assert.match(f, /explain u-0003: 8\/8 checks/)
})

test('the prompt carries the diff (old and new lines), capped', () => {
  const r = record()
  const t = recordText(r, 'x', '--- a/src/decide.js\n+++ b/src/decide.js\n@@ -1 +1 @@\n-old line\n+new line\n')
  assert.match(t, /## Diff \(git, 3 lines of context/); assert.match(t, /-old line\n\+new line/)
  assert.doesNotMatch(recordText(r, 'x', ''), /## Diff/)
  const big = recordText(r, 'x', Array.from({ length: 3000 }, (_, i) => `+line ${i}`).join('\n'))
  assert.match(big, /diff truncated at 12000 characters/)
  assert.ok(big.length < 16000)
  assert.match(recordText(r, 'x', '+```js\n'), /~~~~diff/, 'a diff with a code fence gets a longer fence')
})
