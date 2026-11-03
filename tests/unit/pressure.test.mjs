import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contextTokens, thresholdFrom, hasExternalPressureHook, pressureNote, decidePressure, DEFAULT_THRESHOLD } from '../../plugins/workspace-core/lib/pressure.mjs'
import { createTracker, replay } from '../../plugins/workspace-core/lib/usage.mjs'

test('context tokens = input + cache read + cache creation', () => {
  assert.equal(contextTokens({ input_tokens: 2, cache_read_input_tokens: 349000, cache_creation_input_tokens: 1000, output_tokens: 99 }), 350002)
  assert.equal(contextTokens(null), 0)
  assert.equal(contextTokens({ input_tokens: -1, cache_read_input_tokens: 'x' }), 0)
})

test('threshold: first valid positive integer, else 300K', () => {
  assert.equal(thresholdFrom(undefined, '250000'), 250000)
  assert.equal(thresholdFrom('1000', '250000'), 1000)
  assert.equal(thresholdFrom('abc', '0', ''), DEFAULT_THRESHOLD)
})

test('external user-level context-pressure hook is detected', () => {
  assert.ok(hasExternalPressureHook({ UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/home/u/.claude/hooks/context-pressure.sh' }] }] }))
  assert.ok(!hasExternalPressureHook({ UserPromptSubmit: [{ hooks: [{ command: 'other.sh' }] }] }))
  assert.ok(!hasExternalPressureHook(null))
  assert.ok(!hasExternalPressureHook({ SessionStart: [{ hooks: [{ command: 'context-pressure.sh' }] }] }))
})

test('decide: only over the threshold, never when disabled or duplicated', () => {
  assert.equal(decidePressure({ tokens: 300000 }), null, 'equal is not over')
  const d = decidePressure({ tokens: 312345 })
  assert.equal(d.tokens, 312345); assert.match(d.note, /about 312K/)
  assert.equal(decidePressure({ tokens: 400000, disabled: true }), null)
  assert.equal(decidePressure({ tokens: 400000, external: true }), null)
  assert.match(decidePressure({ tokens: 2000, threshold: 1000 }).note, /about 2K/)
})

test('note carries the spec: stopping point, CLEAR default, paste-back, cold-start handoff', () => {
  const n = pressureNote(310000)
  for (const re of [/natural stopping point/, /never mid-task/, /\*\*CLEAR\*\* or \*\*COMPACT\*\*/, /Default to CLEAR/, /paste the handoff note back/, /zero memory of this chat/, /goal; what is done/, /file paths/, /claude-mem/])
    assert.match(n, re)
  assert.ok(n.length < 1300)
})

test('footer shows the attached advice; replay reproduces it from events', () => {
  const t = createTracker(); t.turnStart(); t.pressure(312000)
  assert.match(t.finish('ok').footer, /context ~312K: \/clear-or-\/compact advice attached/)
  const rows = [{ ev: 'pressure', tokens: 400000 }, { ev: 'turn.start' }, { ev: 'turn.complete' }]
  assert.match(replay(rows)[0].footer, /context ~400K/)
})
