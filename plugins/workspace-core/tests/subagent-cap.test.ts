// Engine-level test of the subagent model/effort cap (no model calls).
import { expect, test } from 'claude-code/testing'

let sent: any[] = []
function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('fs.write', () => ({ value: undefined }))
  on('turn.step', async function* (_: any, e: any) {
    sent.push({ model: e.model, effort: e.effort })
    yield { kind: 'text', index: 0, text: 'ok', ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}
const step = async ($: any, input: any) => { sent = []; for await (const _c of $.turn.step({ turnId: 't', index: 0, messageCount: 1, ...input })) { /* drain */ } return sent[0] }

test('a subagent on Fable at max effort is sent as Opus 5.5 at high', async ($, on) => {
  engine(on)
  expect(await step($, { agentId: 'a1', model: 'claude-fable-5-1', effort: 'max' })).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  expect(await step($, { agentId: 'a1', model: 'fable', effort: 'xhigh' })).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
})

test('within the cap nothing changes; effort is capped on any model', async ($, on) => {
  engine(on)
  expect(await step($, { agentId: 'a1', model: 'claude-opus-5-5', effort: 'high' })).toEqual({ model: 'claude-opus-5-5', effort: 'high' })
  expect(await step($, { agentId: 'a1', model: 'claude-haiku-5-5' })).toEqual({ model: 'claude-haiku-5-5', effort: undefined })
  expect(await step($, { agentId: 'a1', model: 'claude-sonnet-5-5', effort: 'max' })).toEqual({ model: 'claude-sonnet-5-5', effort: 'high' })
  expect(await step($, { agentId: 'a1', model: 'claude-fable-5-1' })).toEqual({ model: 'claude-opus-5-5', effort: undefined })
})

test('the main loop is never capped', async ($, on) => {
  engine(on)
  expect(await step($, { model: 'claude-fable-5-1', effort: 'max' })).toEqual({ model: 'claude-fable-5-1', effort: 'max' })
})

test('CW_SUBAGENT_CAP=0 turns the cap off', async ($, on) => {
  engine(on, { CW_SUBAGENT_CAP: '0' })
  expect(await step($, { agentId: 'a1', model: 'claude-fable-5-1', effort: 'max' })).toEqual({ model: 'claude-fable-5-1', effort: 'max' })
})

const spawn = ($: any, input: any) => $.agent.spawn({ tool_use_id: 'tu', prompt: 'p', description: 'd', subagentType: 'general-purpose', parentModel: 'claude-sonnet-5-5', background: false, fork: false, ...input })
function spawner(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: env[e.name] }))
  on('agent.spawn', (_: any, e: any) => ({ model: e.model ?? e.parentModel }))
}

test('at spawn an explicit Fable pick becomes Opus 5.5; no model given and other models are kept', async ($, on) => {
  spawner(on)
  expect((await spawn($, { model: 'fable' })).model).toBe('claude-opus-5-5')
  expect((await spawn($, { parentModel: 'claude-fable-5-1' })).model).toBe('claude-fable-5-1') // inherited: capped per request by turn.step
  expect((await spawn($, { model: 'haiku' })).model).toBe('haiku')
})

test('at spawn: CW_SUBAGENT_CAP=0 and forks are left alone', async ($, on) => {
  spawner(on, { CW_SUBAGENT_CAP: '0' })
  expect((await spawn($, { model: 'fable' })).model).toBe('fable')
})
