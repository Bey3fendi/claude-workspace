// Engine-level test of /ci (no model calls): `claude plugin test plugins/workspace-core`.
// The skill's request is a debug request: contract, Ponytail's rule when active, and the root-cause gate.
import { expect, test } from 'claude-code/testing'

let reply = ''
function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_MEMORY: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('skill.prompt', () => ({ text: '# Check CI and fix a failure\n\nTarget: \n' }))
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  on('ui.status', () => ({ value: undefined }))
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: reply, ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: reply, toolUses: [], stopReason: 'end_turn', usage: null }
  })
}
const ci = async ($: any, pluginName = 'workspace-core') => ((await $.skill.prompt({ skill: `${pluginName}:ci`, text: '# Check CI', frontmatter: {}, source: 'plugin', pluginName })) as any).text as string
const say = async ($: any, text: string) => { reply = text; for await (const _c of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) { /* drain */ } }
const edit = async ($: any, file_path: string) => ((await $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as any)) as any).deny
const ponytailStarts = ($: any) => $.session.append({
  message: { type: 'attachment', role: 'user', content: [{ type: 'text', text: 'PONYTAIL MODE ACTIVE — level: full\n\nYou are a lazy senior developer.' }] },
  door: 'hook-context', origin: { kind: 'hook', event: 'SessionStart' }, uuid: 'u-pt',
})

test('/ci carries the debug contract, and the gate holds the first source edit until the root cause is stated', async ($, on) => {
  engine(on)
  const text = await ci($)
  expect(text).toContain('[workspace contract: debug]')
  expect(text).toContain('superpowers:systematic-debugging')
  await say($, 'The CI build fails; reading the log.')
  expect(String(await edit($, '/proj/src/sink.cpp'))).toContain('[workspace gate: root cause first]')
  expect(await edit($, '/proj/tests/sink_test.cpp')).toBeUndefined() // tests are never held
  await say($, 'Root cause: src/sink.cpp:42 — the path is built without the directory, so open() fails.')
  expect(await edit($, '/proj/src/sink.cpp')).toBeUndefined()
})

test('with Ponytail active, its rule rides with the /ci contract', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  expect(await ci($)).toContain('[workspace · ponytail full] Smallest complete change')
})

test('CW_CONTRACTS=0 and CW_GATES=0 are honoured', async ($, on) => {
  engine(on, { CW_CONTRACTS: '0', CW_GATES: '0' })
  expect(await ci($)).not.toContain('[workspace contract')
  await say($, 'Fixing.')
  expect(await edit($, '/proj/src/sink.cpp')).toBeUndefined()
})

test('a "ci" skill from another plugin gets nothing', async ($, on) => {
  engine(on)
  expect(await ci($, 'other')).toBe('# Check CI and fix a failure\n\nTarget: \n')
})
