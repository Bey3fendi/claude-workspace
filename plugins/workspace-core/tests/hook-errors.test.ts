// Engine-level tests of the 1.0 M1 error policy (no model calls): `claude plugin test plugins/workspace-core`.
// For each of workspace-core's 21 hooks a fault is injected before and after its `next()` (the CW_TEST_FAULT seam in
// hooks/register.mjs): what the hook wraps runs exactly once, and a `hook.error` row names the hook. Then the footer
// line, and the two regression tests of the v1.0 review (a fault after `next()` in the Bash and Stop hooks).
import { expect, test } from 'claude-code/testing'

const EVENTS = '/home/t/.local/state/claude-workspace/events'
let ran: Record<string, number> = {}
let bodies: Record<string, string> = {}
let marker: string | null = null
const count = (k: string) => { ran[k] = (ran[k] ?? 0) + 1 }

function engine(on: any, env: Record<string, string> = {}) {
  ran = {}; bodies = {}
  on('env.get', (_: any, e: any) => ({ value: { HOME: '/home/t', CW_PLAN_EXECUTION: '0', CW_MEMORY: '0', CW_BASH_EDITS: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.read', (_: any, e: any) => { if (marker && String(e.path).endsWith('.claude/workspace.json')) return { value: marker }; throw new Error('ENOENT') })
  on('fs.write', (_: any, e: any) => { if (String(e.path).startsWith(EVENTS)) bodies[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: any, e: any) => { if (e.argv[0] === 'sh') count('check'); return { value: { exitCode: 0, stdout: '', stderr: '' } } })
  on('ui.status', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('session.start', (_: any, e: any) => { count('session.start'); return { cwd: e.cwd } })
  on('session.end', () => { count('session.end'); return { sessionId: 'sess-1' } })
  on('prompt.compose', () => { count('prompt.compose'); return { sections: [] } })
  on('prompt.submit', (_: any, e: any) => { count('prompt.submit'); return { text: e.text, context: e.context } })
  on('prompt.attachment', (_: any, e: any) => { count('prompt.attachment'); return { text: e.text } })
  on('turn.start', (_: any, e: any) => { count('turn.start'); return { turnId: e.turnId } })
  on('turn.step', async function* (_: any, e: any) {
    count('turn.step')
    yield { kind: 'text', index: 0, text: 'done', ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: 'done', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('turn.complete', () => { count('turn.complete'); return { text: '' } })
  on('agent.spawn', (_: any, e: any) => { count('agent.spawn'); return { model: e.model ?? 'claude-sonnet-5-5' } })
  on('skill.prompt', () => { count('skill.prompt'); return { text: '# skill' } })
  on('tool.call', (_: any, e: any) => { count(`tool:${e.tool}`); return e.tool === 'Bash' ? { result: { ok: true }, text: 'ok', exitCode: 0 } : { result: { ok: true }, text: 'ok' } })
  on('session.append', (_: any, e: any, next: any) => { count('session.append'); return next(e) })
  on('state.set', (_: any, e: any, next: any) => { count('state.set'); return next(e) })
  on('classic.SessionStart', () => { count('classic.SessionStart'); return {} })
  on('classic.PostToolUse', () => { count('classic.PostToolUse'); return {} })
  on('classic.PreCompact', () => { count('classic.PreCompact'); return {} })
  on('classic.Stop', () => { count('classic.Stop'); return {} })
  on('classic.PostToolUseFailure', () => { count('classic.PostToolUseFailure'); return {} })
}

const rows = () => Object.values(bodies).flatMap((b) => b.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)))
const errors = () => rows().filter((r) => r.ev === 'hook.error')
const start = ($: any) => $.session.start({ cwd: '/proj', surface: null, isInteractive: false })
const drain = async (s: any) => { for await (const _c of s) { /* drain */ } }
const step = ($: any) => drain($.turn.step({ turnId: 't1', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 }))

// Each hook: how to raise its event, and the bottom that must run exactly once.
// `hook` is the name its hook.error row carries (the three tool.call hooks share one: the engine asks one .catch per
// event for a module), `seam` the CW_TEST_FAULT name. state.set is not here: only the plugin that owns a value raises
// it (the router), so the kit cannot; its hook has the same .catch as the others.
const HOOKS: [string, string, ($: any) => Promise<unknown>, string?][] = [
  ['session.start', 'session.start', async () => {}], // raised by start() in every test
  ['session.end', 'session.end', ($) => $.session.end({ reason: 'other' })],
  ['prompt.compose', 'prompt.compose', ($) => $.prompt.compose({ sections: [], model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] })],
  ['prompt.submit', 'prompt.submit', ($) => $.prompt.submit({ text: 'fix the failing test in cart.ts', origin: { kind: 'composer' } })],
  ['prompt.attachment', 'prompt.attachment', ($) => $.prompt.attachment({ type: 'skill_listing', text: '- a: b' })],
  ['turn.start', 'turn.start', ($) => $.turn.start({ turnId: 't1' })],
  ['turn.step', 'turn.step', ($) => step($)],
  ['agent.spawn', 'agent.spawn', ($) => $.agent.spawn({ prompt: 'x', model: 'claude-sonnet-5-5' })],
  ['tool.call', 'tool:Edit', ($) => $.tool.call({ tool: 'Edit', file_path: '/proj/src/cart.ts', old_string: 'a', new_string: 'b' })],
  ['turn.complete', 'turn.complete', ($) => $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' })],
  ['skill.prompt', 'skill.prompt', ($) => $.skill.prompt({ skill: 'superpowers:brainstorming', text: '# skill', frontmatter: {}, source: 'plugin', pluginName: 'superpowers' })],
  ['tool.call', 'tool:Skill', ($) => $.tool.call({ tool: 'Skill', skill: 'superpowers:brainstorming' }), 'tool.call:Skill'],
  ['tool.call', 'tool:Bash', ($) => $.tool.call({ tool: 'Bash', command: 'ls' }), 'tool.call:Bash:safety'],
  ['tool.call', 'tool:Bash', ($) => $.tool.call({ tool: 'Bash', command: 'ls' }), 'tool.call:Bash'],
  ['session.append', 'session.append', ($) => $.session.append({ message: { type: 'attachment', role: 'user', content: [{ type: 'text', text: 'hi' }] }, door: 'hook-context', origin: { kind: 'hook', event: 'SessionStart' }, uuid: 'u1' })],
  ['classic.SessionStart', 'classic.SessionStart', ($) => $.classic.SessionStart({ source: 'startup' })],
  ['classic.PostToolUse', 'classic.PostToolUse', ($) => $.classic.PostToolUse({ tool_name: 'Read', tool_input: { file_path: '/proj/a.ts' }, tool_response: {} })],
  ['classic.PreCompact', 'classic.PreCompact', ($) => $.classic.PreCompact({ trigger: 'manual', custom_instructions: null })],
  ['classic.Stop', 'classic.Stop', ($) => $.classic.Stop({ stop_hook_active: false })],
  ['classic.PostToolUseFailure', 'classic.PostToolUseFailure', ($) => $.classic.PostToolUseFailure({ tool_name: 'Skill', tool_input: { skill: 'x' }, error: 'boom' })],
]

test('the fault table covers the 20 hooks the kit can raise (21 with state.set)', () => { expect(HOOKS.length).toBe(20) })

for (const [hook, bottom, raise, seam = hook] of HOOKS) {
  for (const at of ['before', 'after']) {
    test(`${seam}: a fault ${at} next() is recorded, and what it wraps runs once`, async ($, on) => {
      engine(on, { CW_TEST_FAULT: `${seam}:${at}` })
      await start($)
      await raise($)
      expect(ran[bottom]).toBe(1)
      const errs = errors()
      expect(errs.length).toBe(1)
      expect(errs[0]).toMatchObject({ hook, kind: 'throw' })
      expect(errs[0].message).toContain(`injected fault (${seam}, ${at} next)`)
    })
  }
}

test('no fault: no hook.error row', async ($, on) => {
  engine(on)
  await start($)
  for (const [, , raise] of HOOKS) await raise($)
  expect(errors()).toEqual([])
})

test('footer: a hook error shows under the answer, once, naming the hook', async ($, on) => {
  engine(on, { CW_TEST_FAULT: 'prompt.submit:before' })
  await start($)
  await $.turn.start({ turnId: 't1' } as any)
  await $.prompt.submit({ text: 'fix the failing test in cart.ts', origin: { kind: 'composer' } } as any)
  const r: any = await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as any)
  expect(r.text).toBe('workspace-core: 1 hook error (prompt.submit)')
  await $.turn.start({ turnId: 't2' } as any)
  const r2: any = await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'done' } as any)
  expect(r2?.text || null).toBeNull()
})

test('footer: the active check commands are shown once per session', async ($, on) => {
  marker = JSON.stringify({ managedBy: 'claude-workspace', checks: { stop: 'npm test', edit: 'npx eslint {file}' } })
  try {
    engine(on)
    await start($)
    await $.turn.start({ turnId: 't1' } as any)
    const r: any = await $.turn.complete({ turnId: 't1', reason: 'answer', answer: 'done' } as any)
    expect(r.text).toBe('workspace-core: stop check: npm test · edit check: npx eslint {file} (from .claude/workspace.json, run with sh -c)')
    await $.turn.start({ turnId: 't2' } as any)
    const r2: any = await $.turn.complete({ turnId: 't2', reason: 'answer', answer: 'done' } as any)
    expect(r2?.text || null).toBeNull()
  } finally { marker = null }
})

// Regression tests from the v1.0 review (2026-11-16): a fault after next() in the Bash hook ran the command once, and
// in the Stop hook ran the hooks beneath once, but left no record. Now each also leaves a hook.error row.
test('regression: a fault after next() in the Bash hook runs the command once and is recorded', async ($, on) => {
  engine(on, { CW_TEST_FAULT: 'tool.call:Bash:after' })
  await start($)
  const r: any = await $.tool.call({ tool: 'Bash', command: 'npm test' } as any)
  expect(r.deny).toBeUndefined()
  expect(ran['tool:Bash']).toBe(1)
  expect(errors()).toMatchObject([{ hook: 'tool.call', part: 'tool Bash' }])
})

test('regression: a fault after next() in the Stop hook runs the hooks beneath once and is recorded', async ($, on) => {
  engine(on, { CW_TEST_FAULT: 'classic.Stop:after' })
  await start($)
  const r: any = await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(r?.block).toBeUndefined()
  expect(ran['classic.Stop']).toBe(1)
  expect(errors().map((x) => x.hook)).toEqual(['classic.Stop'])
})
