// Engine-level test of the plan-execution note (no model calls): `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

const NOTE = '[workspace: plan execution]'
function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('classic.SessionStart', () => ({}))
}
const start = ($: any, source: string, extra: any = {}) => $.classic.SessionStart({ source, ...extra })

test('every main-conversation SessionStart states the Native execution method', async ($, on) => {
  engine(on)
  for (const source of ['startup', 'resume', 'clear', 'compact']) {
    const r: any = await start($, source)
    const notes = (r.additionalContext ?? []).filter((t: string) => t.includes(NOTE))
    expect(notes.length).toBe(1)
    expect(notes[0]).toContain('superpowers:executing-plans')
    expect(notes[0]).toContain('one fresh review of the whole branch')
  }
})

test('after compaction the note and the restored contract are both attached', async ($, on) => {
  engine(on)
  await $.prompt.submit({ text: "The test 'quantity discount starts at 10 items' fails. Fix it.", origin: { kind: 'composer' } } as any)
  const r: any = await start($, 'compact')
  expect(r.additionalContext.length).toBe(2)
  expect(r.additionalContext[0]).toContain(NOTE)
  expect(r.additionalContext[1]).toContain('restored after compaction')
})

test('CW_PLAN_EXECUTION=0 turns the note off', async ($, on) => {
  engine(on, { CW_PLAN_EXECUTION: '0' })
  const off: any = await start($, 'startup')
  expect(off.additionalContext).toBeUndefined()
})

test('a subagent session start gets no note', async ($, on) => {
  engine(on)
  const sub: any = await start($, 'startup', { agent_id: 'a1' })
  expect(sub.additionalContext).toBeUndefined()
})
