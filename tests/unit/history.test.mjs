import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushHistory, rollbackPlan, pinState, HISTORY_MAX } from '../../cli/lib/history.mjs'

const P = (v) => ({ 'workspace-core@cw': { version: v, sha: null }, 'superpowers@cw': { version: '7.0.1', sha: 'a'.repeat(40) } })

test('history: nothing on first install or when unchanged; previous state on change; capped', () => {
  const m = {}
  assert.equal(pushHistory(m, { plugins: { a: null }, source: 's', workspaceVersion: '0.7.0' }, { plugins: P('0.7.0'), source: 's', workspaceVersion: '0.7.0' }), false, 'first install')
  assert.equal(pushHistory(m, { plugins: P('0.7.0'), source: 's', workspaceVersion: '0.7.0' }, { plugins: P('0.7.0'), source: 's', workspaceVersion: '0.7.0' }), false, 'no change')
  assert.equal(pushHistory(m, { at: 't1', plugins: P('0.7.0'), source: 's', workspaceVersion: '0.7.0' }, { plugins: P('0.7.1'), source: 's', workspaceVersion: '0.7.1' }), true)
  assert.equal(m.history.at(-1).plugins['workspace-core@cw'].version, '0.7.0')
  for (let i = 0; i < 10; i++) pushHistory(m, { at: `x${i}`, plugins: P(`0.${i}.0`), source: 's' }, { plugins: P('9.9.9'), source: 's' })
  assert.equal(m.history.length, HISTORY_MAX)
})

test('rollback plan: local checkout vs published ref; nothing recorded', () => {
  assert.equal(rollbackPlan({}, { projectRoot: '/p' }).ok, false)
  const local = rollbackPlan({ history: [{ at: 't', source: '/src/cw', workspaceVersion: '0.7.0', plugins: P('0.7.0') }] }, { projectRoot: '/p' })
  assert.ok(local.ok); assert.match(local.message, /workspace 0\.7\.0, workspace-core 0\.7\.0/)
  assert.match(local.steps.join('\n'), /git -C \/src\/cw checkout/); assert.match(local.steps.at(-1), /cli\/bin\/claude-workspace\.mjs repair --project \/p$/)
  const pub = rollbackPlan({ history: [{ at: 't', source: 'me/claude-workspace#v0.7.0', workspaceVersion: '0.7.0', plugins: P('0.7.0') }] }, { projectRoot: '/p' })
  assert.equal(pub.steps[0], 'npx -y github:me/claude-workspace#v0.7.0 repair --project /p --marketplace me/claude-workspace#v0.7.0')
})

test('pinState reads the registry per id', () => {
  const s = pinState({}, ['a', 'b'], (_c, id) => (id === 'a' ? { version: '1', gitCommitSha: 'x' } : null))
  assert.deepEqual(s, { a: { version: '1', sha: 'x' }, b: null })
})

test('rollback plan names the recorded commit for a local checkout', () => {
  const p = rollbackPlan({ history: [{ at: 't', source: '/src/cw', plugins: { 'workspace-core@cw': { version: '0.7.0', sha: 'abcdef1234567890' } } }] }, { projectRoot: '/p' })
  assert.match(p.steps[0], /^git -C \/src\/cw checkout abcdef123456 /)
  assert.equal(p.steps.length, 2)
})
