// Engine-level test of the Phase 4 compaction restore (no model calls): `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

function engine(on: any) {
  // CW_PLAN_EXECUTION=0: these tests are about the restore; execution.test.ts covers the plan-execution note.
  on('env.get', (_: any, e: any) => ({ value: e.name === 'CW_PLAN_EXECUTION' ? '0' : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('classic.SessionStart', () => ({}))
}
const ask = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })

test('after compaction the active request contract is re-attached', async ($, on) => {
  engine(on)
  await ask($, "The test 'quantity discount starts at 10 items' fails. Fix it.")
  const r: any = await ($ as any).classic.SessionStart({ source: 'compact' })
  expect(r.additionalContext?.length).toBe(1)
  expect(r.additionalContext[0]).toContain('[workspace contract: debug, restored after compaction]')
})

test('no restore on a normal start, or for a trivial request', async ($, on) => {
  engine(on)
  const start: any = await ($ as any).classic.SessionStart({ source: 'startup' })
  expect(start.additionalContext).toBeUndefined()
  await ask($, 'What does this repo do?')
  const r: any = await ($ as any).classic.SessionStart({ source: 'compact' })
  expect(r.additionalContext).toBeUndefined()
})
