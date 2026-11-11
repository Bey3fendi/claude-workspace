// Engine-level tests of the automatic memory (no model calls): the pre-edit hold, the end-of-request
// session.md block and the decisions nudge. `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

const ROOT = '/proj'
const SESSION = `${ROOT}/.memory/session.md`
const CONTEXT = `${ROOT}/.memory/context.md`
const DECISIONS = `${ROOT}/.memory/decisions.md`
const LOG = '# Session log\n\nheader\n'
const DEC = '# Decisions\n\n## Clamp at zero\n<!-- paths: src/coupons.js -->\n- Decision: totals never go negative.\n'

let bashExit = 0
let status = '' // what `git status --porcelain` prints
// CW_GATES=0: the root-cause gate would hold the edits of debug-worded requests (it has its own tests).
function engine(on: any, files: Record<string, string>, env: Record<string, string> = {}) {
  status = ''
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_GATES: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_: any, e: any) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.write', (_: any, e: any) => { if (String(e.path).startsWith(ROOT)) files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv.includes('status') ? status : '', stderr: '' } }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('skill.prompt', () => ({ text: 'skill body' }))
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'Bash') return bashExit ? { result: {}, isError: true, text: `Exit code ${bashExit}` } : { result: {}, text: 'ok' }
    if (e.tool === 'Write' || e.tool === 'Edit') files[e.file_path] = e.content ?? e.new_string ?? ''
    return { result: { ok: true }, text: 'ok' }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.Stop', () => ({}))
}
const ask = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' } })
const write = ($: any, file_path: string, content = 'x', agentId?: string) => $.tool.call({ tool: 'Write', file_path, content, ...(agentId ? { agentId } : {}) } as any)
const bash = ($: any, command: string, exit = 0) => { bashExit = exit; return $.tool.call({ tool: 'Bash', command } as any) }

test('first edit of a file with unseen notes is held with the notes; the retry goes through', async ($, on) => {
  const files: Record<string, string> = { [DECISIONS]: DEC }
  engine(on, files)
  await ($ as any).classic.SessionStart({ source: 'startup' })
  await ask($, 'Change the coupon rounding in src/coupons.js')
  const held: any = await write($, `${ROOT}/src/coupons.js`)
  expect(String(held.deny)).toContain('## Clamp at zero')
  expect(String(held.deny)).toContain('this edit was not applied')
  expect(files[`${ROOT}/src/coupons.js`]).toBeUndefined()
  const retry: any = await write($, `${ROOT}/src/coupons.js`)
  expect(retry.deny).toBeUndefined()
  expect(files[`${ROOT}/src/coupons.js`]).toBe('x')
  const other: any = await write($, `${ROOT}/src/other.js`)
  expect(other.deny).toBeUndefined()
})

test('reading the file first delivers the notes, so the edit is not held; a subagent gets them again', async ($, on) => {
  engine(on, { [DECISIONS]: DEC })
  await ($ as any).classic.SessionStart({ source: 'startup' })
  await ask($, 'Change the coupon rounding')
  const read: any = await ($ as any).classic.PostToolUse({ tool_name: 'Read', tool_input: { file_path: `${ROOT}/src/coupons.js` }, tool_response: {} })
  expect(read.additionalContext.join('\n')).toContain('## Clamp at zero')
  expect(((await write($, `${ROOT}/src/coupons.js`)) as any).deny).toBeUndefined()
  expect(String(((await write($, `${ROOT}/src/coupons.js`, 'y', 'agent-1')) as any).deny)).toContain('## Clamp at zero')
})

for (const env of [{ CW_MEMORY_PREEDIT: '0' }, { CW_MEMORY: '0' }]) {
  test(`${Object.keys(env)[0]}=0 never holds an edit`, async ($, on) => {
    engine(on, { [DECISIONS]: DEC }, env)
    await ask($, 'Change the coupon rounding')
    expect(((await write($, `${ROOT}/src/coupons.js`)) as any).deny).toBeUndefined()
  })
}

test('a request that changed files gets a facts-only session.md block, once, with the last check', async ($, on) => {
  const files: Record<string, string> = { [SESSION]: LOG }
  engine(on, files)
  await ask($, "The total is wrong for negative amounts; token=abcdefgh123 fix it")
  await write($, `${ROOT}/src/cart.js`)
  await write($, `${ROOT}/.explain/records/U1.json`, '{}')
  await bash($, 'npm test', 0)
  await ($ as any).classic.Stop({ stop_hook_active: false })
  const log = files[SESSION]
  expect(log).toContain('· debug: The total is wrong for negative amounts; token=[REDACTED] fix it')
  expect(log).toContain('- Files changed: src/cart.js\n')
  expect(log).toContain('- Last check after the last edit: `npm test` → exit 0')
  expect(log).not.toContain('abcdefgh123')
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(files[SESSION].split('Auto-logged').length).toBe(2)
})

test('no block when nothing changed, or when Claude wrote its own block', async ($, on) => {
  const a: Record<string, string> = { [SESSION]: LOG }
  engine(on, a)
  await ask($, 'What does src/cart.js do with coupons?')
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(a[SESSION]).toBe(LOG)

  await ask($, 'Fix the crash in src/cart.js')
  await write($, `${ROOT}/src/cart.js`)
  await write($, SESSION, LOG + '\n## 2026-11-11 10:00 · my own block\n')
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(a[SESSION]).not.toContain('Auto-logged')
})

test('CW_MEMORY_AUTOLOG=0 writes no block', async ($, on) => {
  const a: Record<string, string> = { [SESSION]: LOG }
  engine(on, a, { CW_MEMORY_AUTOLOG: '0' })
  await ask($, 'Fix the crash in src/cart.js')
  await write($, `${ROOT}/src/cart.js`)
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(a[SESSION]).toBe(LOG)
})

test('a designed feature with no recorded decision gets one nudge, then the block lists what was recorded', async ($, on) => {
  const files: Record<string, string> = { [SESSION]: LOG, [DECISIONS]: '# Decisions\n' }
  engine(on, files)
  await ask($, 'Implement a new todo app with due dates')
  await ($ as any).skill.prompt({ skill: 'superpowers:brainstorming', text: 'skill body', frontmatter: {}, source: 'plugin', pluginName: 'superpowers' })
  await bash($, 'npm test', 0)
  await write($, `${ROOT}/src/todo.js`)
  const first: any = await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(String(first.block)).toContain('nothing was added to .memory/decisions.md')
  expect(files[SESSION]).toBe(LOG)
  await write($, DECISIONS, '# Decisions\n\n## Tasks in localStorage\n<!-- paths: src/todo.js -->\n- Decision: no server.\n')
  const second: any = await ($ as any).classic.Stop({ stop_hook_active: true })
  expect(second.block).toBeUndefined()
  expect(files[SESSION]).toContain('- Recorded: decisions.md "Tasks in localStorage"')
  expect(files[SESSION]).toContain('- Last check after the last edit: none run')
})

test('no nudge for a feature without a design step', async ($, on) => {
  engine(on, { [SESSION]: LOG })
  await ask($, 'Add a dark mode toggle to the settings page')
  await write($, `${ROOT}/src/settings.js`)
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
})

test('an architecture request is nudged without a skill; CW_MEMORY_NUDGE=0 turns it off', async ($, on) => {
  engine(on, { [SESSION]: LOG })
  await ask($, 'Design a new app for invoices: how should we structure the services?')
  await write($, `${ROOT}/src/invoices.js`)
  expect(String(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block)).toContain('decisions.md')
})

test('CW_MEMORY_NUDGE=0: no nudge', async ($, on) => {
  const files: Record<string, string> = { [SESSION]: LOG }
  engine(on, files, { CW_MEMORY_NUDGE: '0' })
  await ask($, 'Design a new app for invoices: how should we structure the services?')
  await write($, `${ROOT}/src/invoices.js`)
  expect(((await ($ as any).classic.Stop({ stop_hook_active: false })) as any).block).toBeUndefined()
})

// Live run 2026-11-11: Claude appended its own block with `cat >> .memory/session.md <<EOF ... node --test ... EOF`,
// created files through Bash, and the heredoc counted as the last check. Each is covered here.
test('Bash work counts: git-only changes are listed, a Bash-written block suppresses ours, a heredoc is no check', async ($, on) => {
  const files: Record<string, string> = { [SESSION]: LOG }
  engine(on, files)
  status = ' M src/old.js\n'
  await ask($, 'Add a pricing module')
  await write($, `${ROOT}/src/cart.js`)
  status = ' M src/old.js\n?? src/pricing/index.js\n?? .memory/notes.md\n'
  await bash($, "cat >> .memory/decisions.md <<'EOF'\n## X\nrun node --test\nEOF", 0)
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(files[SESSION]).toContain('- Files changed: src/cart.js, src/pricing/index.js\n')
  expect(files[SESSION]).toContain('- Last check after the last edit: none run')
  expect(files[SESSION]).not.toContain('src/old.js')

  await ask($, 'Add a coupon module')
  await write($, `${ROOT}/src/coupon.js`)
  files[SESSION] += '\n## 2026-11-11 10:00 · Claude wrote this with Bash\n'
  const before = files[SESSION]
  await ($ as any).classic.Stop({ stop_hook_active: false })
  expect(files[SESSION]).toBe(before)
})
