import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide, editTarget, gatedFile, statesRootCause, GATE_LIMIT, denyText } from '../../plugins/workspace-core/lib/gates.mjs'

const st = (o = {}) => ({ class: 'debug', text: '', denies: 0, released: false, ...o })
const edit = (file_path) => ({ tool: 'Edit', file_path })

test('edit targets: edit tools and shell writes', () => {
  assert.equal(editTarget(edit('/p/src/cart.js')), '/p/src/cart.js')
  assert.equal(editTarget({ tool: 'Write', file_path: 'a.py' }), 'a.py')
  assert.equal(editTarget({ tool: 'Read', file_path: 'a.py' }), null)
  assert.equal(editTarget({ tool: 'Bash', command: "cat > src/cart.js <<'EOF'" }), 'src/cart.js')
  assert.equal(editTarget({ tool: 'Bash', command: 'sed -i "s/>/>=/" src/cart.js' }), 'src/cart.js')
  assert.equal(editTarget({ tool: 'Bash', command: 'echo x | tee -a lib/x.ts' }), 'lib/x.ts')
  assert.equal(editTarget({ tool: 'Bash', command: 'node --test test/*.test.js 2>&1' }), null)
  assert.equal(editTarget({ tool: 'Bash', command: 'npm test > /dev/null' }), null)
  assert.equal(editTarget({ tool: 'Bash', command: 'git diff' }), null)
})

test('gated files: source yes; tests and docs no', () => {
  for (const f of ['src/cart.js', '/abs/lib/a.ts', 'app/models.py', 'main.go']) assert.ok(gatedFile(f), f)
  for (const f of ['test/cart.test.js', 'src/cart.spec.ts', 'tests/test_cart.py', 'pkg/x_test.go', '__tests__/a.js', 'README.md', null, ''])
    assert.ok(!gatedFile(f), String(f))
})

test('root-cause detector', () => {
  assert.ok(statesRootCause('Root cause: src/cart.js:12 uses > instead of >='))
  assert.ok(statesRootCause('The root cause is the comparison.'))
  assert.ok(statesRootCause('src/cart.js:12 fails because qty > 10 excludes exactly 10'))
  assert.ok(statesRootCause('On line 12 the discount never applies, due to a strict comparison.'))
  assert.ok(!statesRootCause("Let me look at the code and find the root cause."), 'intent is not a statement')
  assert.ok(!statesRootCause('I will fix src/cart.js:12 now.'), 'location without a cause')
  assert.ok(!statesRootCause('It fails because of something.'), 'cause without a location')
  assert.ok(!statesRootCause(''))
})

test('decide: only debug, only main loop, only source edits, until a cause is stated', () => {
  assert.equal(decide(st({ class: 'feature' }), edit('src/a.js')).action, 'pass')
  assert.equal(decide(null, edit('src/a.js')).action, 'pass')
  assert.equal(decide(st(), { ...edit('src/a.js'), agentId: 'a1' }).action, 'pass')
  assert.equal(decide(st(), edit('test/a.test.js')).action, 'pass')
  assert.equal(decide(st(), { tool: 'Read', file_path: 'src/a.js' }).action, 'pass')
  const d = decide(st(), edit('src/a.js'))
  assert.equal(d.action, 'deny'); assert.equal(d.file, 'src/a.js')
  assert.equal(decide(st({ text: 'Root cause: src/a.js:3 — off by one' }), edit('src/a.js')).action, 'pass')
  assert.equal(decide(st({ released: true }), edit('src/a.js')).action, 'pass')
})

test('decide: never more than GATE_LIMIT denies per request', () => {
  const r = decide(st({ denies: GATE_LIMIT }), edit('src/a.js'))
  assert.equal(r.action, 'pass'); assert.equal(r.reason, 'gate limit reached')
})

test('deny text names the file and the expected form, not the path', () => {
  const t = denyText('/home/u/proj/src/cart.js')
  assert.match(t, /cart\.js/); assert.doesNotMatch(t, /home\/u/); assert.match(t, /Root cause: <file:line>/)
})

test('footer reports the gate from engine events', async () => {
  const { createTracker, replay } = await import('../../plugins/workspace-core/lib/usage.mjs')
  const t = createTracker(); t.turnStart(); t.gate('deny'); t.gate('release', 'root cause stated')
  assert.match(t.finish('done').footer, /root-cause gate held 1 edit until a root cause was stated/)
  const t2 = createTracker(); t2.turnStart()
  assert.equal(t2.finish('done').footer, null, 'no gate, no skills: no footer')
  const rows = [{ ev: 'turn.start' }, { ev: 'gate', action: 'deny' }, { ev: 'gate', action: 'deny' }, { ev: 'gate', action: 'release', reason: 'gate limit reached' }, { ev: 'turn.complete' }]
  assert.match(replay(rows)[0].footer, /held 2 edits, then let it through \(limit reached\)/)
})
