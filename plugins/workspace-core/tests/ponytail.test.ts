// Engine-level tests of the workspace driving Ponytail (no model calls), and of CW_OFF.
// `claude plugin test plugins/workspace-core`. Hooks registered here stand for the engine beneath workspace-core.
import { expect, test } from 'claude-code/testing'

const ROOT = '/proj'
let reply = '' // what the stand-in model "says" on the next step

function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_GATES: '0', CW_MEMORY: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  on('tool.call', () => ({ result: { ok: true }, text: 'ok' }))
  on('ui.status', () => ({ value: undefined }))
  on('classic.SessionStart', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: reply, ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: reply, toolUses: [], stopReason: 'end_turn', usage: null }
  })
}

// Ponytail's own SessionStart hook injecting its rules (what announces it to the workspace).
const ponytailStarts = ($: any, level = 'full') => $.session.append({
  message: { type: 'attachment', role: 'user', content: [{ type: 'text', text: `PONYTAIL MODE ACTIVE — level: ${level}\n\nYou are a lazy senior developer.` }] },
  door: 'hook-context', origin: { kind: 'hook', event: 'SessionStart' }, uuid: `u-${level}`,
})
const ask = async ($: any, text: string) => ((await $.prompt.submit({ text, origin: { kind: 'composer' } })) as any)
const say = async ($: any, text: string) => { reply = text; for await (const _c of $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5', messageCount: 1 })) { /* drain */ } }
const edit = ($: any, file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as any)
const ctxOf = (r: any) => (r?.context ?? []).join('\n')

test('a code request carries the Ponytail rule with its contract, at the announced level', async ($, on) => {
  engine(on)
  await ponytailStarts($, 'ultra')
  const r = await ask($, 'Add a bulk discount option to the cart.')
  expect(ctxOf(r)).toContain('[workspace contract: feature]')
  expect(ctxOf(r)).toContain('[workspace · ponytail ultra] Smallest complete change')
})

test('without Ponytail announced, or after "stop ponytail", nothing is added', async ($, on) => {
  engine(on)
  expect(ctxOf(await ask($, 'Add a bulk discount option to the cart.'))).not.toContain('ponytail')
  await ponytailStarts($)
  await ask($, 'stop ponytail')
  expect(ctxOf(await ask($, 'Add a bulk discount option to the cart.'))).not.toContain('ponytail')
})

test('a review goes to ponytail-review, an audit to ponytail-audit', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  expect(ctxOf(await ask($, 'Review src/cart.js please.'))).toContain('ponytail:ponytail-review')
  expect(ctxOf(await ask($, 'Audit the codebase and tell me what can I delete.'))).toContain('ponytail:ponytail-audit')
})

test('a request with no class gets the rule once, after its first source edit', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  expect(ctxOf(await ask($, 'yes keep going with Task 3'))).not.toContain('ponytail')
  const doc: any = await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: `${ROOT}/README.md` }, tool_response: {} })
  expect(JSON.stringify(doc ?? {})).not.toContain('ponytail')
  const first: any = await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: `${ROOT}/src/a.ts` }, tool_response: {} })
  expect((first.additionalContext ?? []).join('\n')).toContain('[workspace · ponytail full]')
  const second: any = await ($ as any).classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path: `${ROOT}/src/b.ts` }, tool_response: {} })
  expect(JSON.stringify(second ?? {})).not.toContain('ponytail')
})

test('the closing line is asked for once when code changed and the answer has none', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  await ask($, 'Add a bulk discount option to the cart.')
  await edit($, `${ROOT}/src/cart.ts`)
  await say($, 'Done: the discount applies from 10 items.')
  const first: any = await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(String(first.block)).toContain('closing line Ponytail asks for')
  await say($, 'Not checked: the coupon path; risk: none known.')
  const second: any = await ($ as any).classic.Stop({ stop_hook_active: true })
  expect(second.block).toBeUndefined()
})

test('no ask when the answer has the line, when no code changed, or with CW_PONYTAIL_CLOSE=0', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  await ask($, 'Add a bulk discount option to the cart.')
  await edit($, `${ROOT}/src/cart.ts`)
  await say($, 'Done.\n\nSkipped: the coupon path is untested.')
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
  await ask($, 'Update the README wording.')
  await edit($, `${ROOT}/README.md`)
  await say($, 'Done.')
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
})

test('CW_PONYTAIL_CLOSE=0 turns only the ask off', async ($, on) => {
  engine(on, { CW_PONYTAIL_CLOSE: '0' })
  await ponytailStarts($)
  const r = await ask($, 'Add a bulk discount option to the cart.')
  expect(ctxOf(r)).toContain('[workspace · ponytail full]')
  await edit($, `${ROOT}/src/cart.ts`)
  await say($, 'Done.')
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
})

test('CW_OFF=1: no contract, no Ponytail rule, no hold, no Stop block', async ($, on) => {
  engine(on, { CW_OFF: '1', CW_GATES: '1' })
  await ponytailStarts($)
  const r = await ask($, 'The checkout crashes with a TypeError. Fix it.')
  expect(ctxOf(r)).toBe('')
  expect(((await edit($, `${ROOT}/src/cart.ts`)) as any).deny).toBeUndefined()
  await say($, 'Done.')
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
})
