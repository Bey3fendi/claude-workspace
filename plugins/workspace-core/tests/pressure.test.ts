// Engine-level test of the built-in context-pressure note (no model calls).
import { expect, test } from 'claude-code/testing'

let tokens = 0
let seen: string[] = []
function engine(on: any) {
  on('env.get', (_: any, e: any) => ({ value: e.name === 'CW_CONTEXT_PRESSURE_TOKENS' ? '1000' : undefined }))
  on('fs.write', () => ({ value: undefined }))
  on('prompt.submit', (_: any, e: any) => { seen = [...(e.context ?? [])]; return { text: e.text } })
  on('classic.SessionStart', () => ({}))
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok', ref: 1 }
    yield { kind: 'stop', stopReason: 'end_turn', usage: { model: 'm', input_tokens: 2, cache_read_input_tokens: tokens, cache_creation_input_tokens: 0, output_tokens: 1 }, ref: 2 }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}
const ask = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })
const step = async ($: any, t: number) => { tokens = t; for await (const _c of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) { /* drain */ } }
const noted = () => seen.some((c) => c.includes('[workspace: context pressure]'))

test('over the threshold: the next prompt carries the note; under: none', async ($, on) => {
  engine(on)
  await ask($, 'What does this repo do?'); expect(noted()).toBe(false)
  await step($, 500)
  await ask($, 'And the tests?'); expect(noted()).toBe(false)
  await step($, 5000)
  await ask($, 'Thanks, what next?'); expect(noted()).toBe(true)
  expect(seen.find((c) => c.includes('context pressure'))).toContain('about 5K')
})

test('after /clear the stale size is dropped', async ($, on) => {
  engine(on)
  await step($, 5000)
  await ($ as any).classic.SessionStart({ source: 'clear' })
  await ask($, 'New topic.'); expect(noted()).toBe(false)
})

// The precedence rule (a user-level context-pressure hook suppresses this note) reads $.settings, which the
// test kit does not provide; it is covered by tests/unit/pressure.test.mjs. Here: a failed settings read
// must not suppress the note or break the prompt.
test('without readable settings the note still applies', async ($, on) => {
  engine(on)
  await step($, 5000)
  await ask($, 'Next?'); expect(noted()).toBe(true)
})

test('the engine live context fill is used when available (e.g. a resumed session)', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { context: { tokens: 7000, window: 200000, percent: 3 } } }))
  await ask($, 'First prompt after resume.'); expect(noted()).toBe(true)
  expect(seen.find((c) => c.includes('context pressure'))).toContain('about 7K')
})

test('engine says no fill yet (fresh or just compacted): no note even if a stale step was seen', async ($, on) => {
  engine(on)
  on('session.usage', () => ({ value: { context: { window: 200000 } } }))
  await step($, 5000)
  await ask($, 'Next?'); expect(noted()).toBe(false)
})
