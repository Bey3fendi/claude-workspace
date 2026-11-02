// Engine-level test of the Phase 4 root-cause gate (no model calls): `claude plugin test plugins/workspace-core`.
// Hooks registered here stand for the engine beneath workspace-core.
import { expect, test } from 'claude-code/testing'

const EDIT = { tool: 'Edit', file_path: '/p/src/cart.js', old_string: 'qty > 10', new_string: 'qty >= 10' } as const

let reply = '' // what the stand-in model "says" on the next step

function engine(on: any) {
  on('env.get', () => ({ value: undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('tool.call', () => ({ result: { ok: true } }))
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: reply, ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: reply, toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

const ask = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })
const say = async ($: any, _on: any, text: string) => {
  reply = text
  for await (const _c of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) { /* drain */ }
}

test('debug request: a source edit is held until a root cause is stated', async ($, on) => {
  engine(on)
  await ask($, "The test 'quantity discount starts at 10 items' fails. Fix it.")
  const held = await $.tool.call(EDIT as any)
  expect(typeof (held as any).deny).toBe("string")
  expect(String((held as any).deny)).toContain('root cause first')

  const testEdit = await $.tool.call({ ...EDIT, file_path: '/p/test/cart.test.js' } as any)
  expect((testEdit as any).deny).toBeUndefined()

  await say($, on, 'Root cause: src/cart.js:5 uses qty > 10, so exactly 10 gets no discount.')
  const fixed = await $.tool.call(EDIT as any)
  expect((fixed as any).deny).toBeUndefined()
})

test('non-debug request: edits are never held', async ($, on) => {
  engine(on)
  await ask($, "Add a 'buy 2 get 1 free' promotion to the cart.")
  const r = await $.tool.call(EDIT as any)
  expect((r as any).deny).toBeUndefined()
})

test('the gate gives up after two holds in one request', async ($, on) => {
  engine(on)
  await ask($, 'The checkout crashes with a TypeError. Fix it.')
  expect(typeof ((await $.tool.call(EDIT as any)) as any).deny).toBe("string")
  expect(typeof ((await $.tool.call(EDIT as any)) as any).deny).toBe("string")
  expect(((await $.tool.call(EDIT as any)) as any).deny).toBeUndefined()
})
