// Engine-level test of the Bash safety check (no model calls): `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

let ran: string[] = []
function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('fs.write', () => ({ value: undefined }))
  on('tool.call', (_: any, e: any) => { ran.push(e.command); return { result: { ok: true } } })
}
const bash = ($: any, command: string, extra: any = {}) => $.tool.call({ tool: 'Bash', command, ...extra })

test('a force push is refused before it runs, for the main loop and subagents', async ($, on) => {
  engine(on); ran = []
  const r: any = await bash($, 'git -C . push -f origin main')
  expect(r.deny).toMatch(/\[workspace · safety\] Blocked a force push/)
  const s: any = await bash($, 'cat .env', { agentId: 'a1' })
  expect(s.deny).toMatch(/Blocked reading that file \(\.env\)/)
  expect(ran).toEqual([])
})

test('ordinary commands run unchanged', async ($, on) => {
  engine(on); ran = []
  const r: any = await bash($, 'git push -u origin main && npm test')
  expect(r.deny).toBeUndefined()
  expect(ran).toEqual(['git push -u origin main && npm test'])
})

test('CW_SAFETY=0 turns the check off', async ($, on) => {
  engine(on, { CW_SAFETY: '0' }); ran = []
  expect(((await bash($, 'git reset --hard')) as any).deny).toBeUndefined()
  expect(ran).toEqual(['git reset --hard'])
})

test('CW_OFF=1 keeps the safety check', async ($, on) => {
  engine(on, { CW_OFF: '1' }); ran = []
  expect(((await bash($, 'git reset --hard')) as any).deny).toMatch(/Blocked git reset --hard/)
  expect(ran).toEqual([])
})
