// Engine-level tests of 0.19.0's opt-in check hooks (no model calls): the stop check runs the project's command when a
// request changed code and ran no passing check after it, and a failure goes back to Claude; the edit check runs on
// each edited file. `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

const MARKER = JSON.stringify({ managedBy: 'claude-workspace', checks: { stop: 'npm test', edit: 'npx eslint {file}' } })
let shExit = 1 // what the check command exits with
let shRuns: string[] = []
function engine(on: any, env: Record<string, string> = {}) {
  shRuns = []
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_MEMORY: '0', CW_BASH_EDITS: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', (_: any, e: any) => { if (String(e.path).endsWith('.claude/workspace.json')) return { value: MARKER }; throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_: any, e: any) => {
    if (e.argv[0] === 'sh') { shRuns.push(e.argv[2]); return { value: { exitCode: shExit, stdout: shExit ? '# fail 1\nnot ok 1 - total' : '# pass 2', stderr: '' } } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  on('tool.call', (_: any, e: any) => (e.tool === 'Bash' ? { result: { ok: true }, text: 'ok', exitCode: 0 } : { result: { ok: true }, text: 'ok' }))
  on('classic.Stop', () => ({}))
  on('classic.PostToolUse', () => ({}))
}
const ask = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })
const edit = ($: any, file = '/proj/src/cart.ts') => $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' } as any)
const stop = async ($: any) => ((await ($ as any).classic.Stop({ stop_hook_active: false })) as any)?.block ?? null

test('a code edit with no check after it: the stop check runs, and a failure goes back to Claude', async ($, on) => {
  engine(on); shExit = 1
  await ask($, 'here is the KB page with the real payload shapes')
  await edit($)
  const block = await stop($)
  expect(shRuns).toEqual(['npm test'])
  expect(block).toContain('[workspace · stop check] `npm test` failed (exit 1)')
  expect(block).toContain('not ok 1 - total')
  // Claude stops again without a new edit: the same edit is not checked twice
  expect(await stop($)).toBeNull()
  expect(shRuns.length).toBe(1)
})

test('a passing stop check adds nothing; no edit means no stop check', async ($, on) => {
  engine(on); shExit = 0
  await ask($, 'here is the KB page with the real payload shapes')
  expect(await stop($)).toBeNull()
  expect(shRuns.length).toBe(0)
  await edit($)
  expect(await stop($)).toBeNull()
  expect(shRuns).toEqual(['npm test'])
})

test('the edit check runs on the edited file and shows a failure next to the edit; docs are skipped', async ($, on) => {
  engine(on); shExit = 2
  await ask($, 'here is the KB page with the real payload shapes')
  const r: any = await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: '/proj/src/cart.ts' }, tool_response: {} })
  expect(shRuns).toEqual(["npx eslint 'src/cart.ts'"])
  expect((r?.additionalContext ?? []).join('\n')).toContain("[workspace · edit check] `npx eslint 'src/cart.ts'` failed on src/cart.ts (exit 2)")
  await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: '/proj/README.md' }, tool_response: {} })
  expect(shRuns.length).toBe(1)
})

test('CW_CHECKS=0 turns both off', async ($, on) => {
  engine(on, { CW_CHECKS: '0' }); shExit = 1
  await ask($, 'here is the KB page with the real payload shapes')
  await edit($)
  await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: '/proj/src/cart.ts' }, tool_response: {} })
  expect(await stop($)).toBeNull()
  expect(shRuns.length).toBe(0)
})
