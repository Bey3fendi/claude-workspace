import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeLevel, hasClosingLine, injectedLevel, promptLevel, reminderText, CODE_CLASSES } from '../../plugins/workspace-core/lib/ponytail.mjs'
import { createTracker, replay } from '../../plugins/workspace-core/lib/usage.mjs'

test('Ponytail level: from its own injected text and its own commands only', () => {
  assert.equal(injectedLevel('PONYTAIL MODE ACTIVE — level: full\n\nYou are a lazy senior developer.'), 'full')
  assert.equal(injectedLevel([{ type: 'text', text: 'PONYTAIL MODE ACTIVE - level: ultra' }]), 'ultra')
  assert.equal(injectedLevel('ponytail is installed'), null)
  assert.equal(promptLevel('stop ponytail'), 'off'); assert.equal(promptLevel('Normal mode.'), 'off')
  assert.equal(promptLevel('/ponytail lite'), 'lite'); assert.equal(promptLevel('please stop ponytail from doing X'), null)
  assert.equal(activeLevel('full'), 'full'); assert.equal(activeLevel('off'), null); assert.equal(activeLevel('review'), null); assert.equal(activeLevel(null), null)
  assert.match(reminderText('lite'), /^\[workspace · ponytail lite\] Smallest complete change[\s\S]*skipped or did not check/)
  for (const c of ['feature', 'debug', 'tests', 'architecture', 'review-feedback']) assert.ok(CODE_CLASSES.has(c), c)
  assert.ok(!CODE_CLASSES.has('trivial'))
})

test('closing line: looked for in the last lines (AgentBridge: 16 of 97 answers had it)', () => {
  assert.ok(hasClosingLine('Done.\n\nNext: run npm test.\n\nNot checked: the coupon path.'))
  assert.ok(hasClosingLine("Fixed.\nI didn't run the e2e suite; risk: low."))
  assert.ok(hasClosingLine('Done.\nSkipped: docs.'))
  assert.ok(!hasClosingLine('Done: the discount applies from 10 items.\n\nNext: review the diff.'))
  assert.ok(!hasClosingLine('Skipped: docs.\n' + 'line\n'.repeat(10)), 'only the end counts')
  assert.ok(!hasClosingLine(''))
})

test('footer and replay: the Ponytail line is evidence, not a claim', () => {
  const t = createTracker()
  t.turnStart(); t.ponytail({ reminded: 'contract', level: 'full' }); t.ponytail({ level: 'full', closing: false }); t.ponytail({ asked: true })
  assert.match(t.finish('').footer, /ponytail full: rule repeated, closing line missing \(asked for it\)/)
  const rows = [
    { ev: 'turn.start', agentId: null, t: 1 },
    { ev: 'ponytail', action: 'closing', present: true, level: 'lite' },
    { ev: 'turn.complete', agentId: null, reason: 'answer', t: 2 },
  ]
  assert.match(replay(rows)[0].footer, /ponytail lite: closing line present/)
})
