// Engine-level tests of md-memory (no model calls): `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

const ROOT = '/proj'
const SESSION = `${ROOT}/.memory/session.md`
const CONTEXT = `${ROOT}/.memory/context.md`
const DECISIONS = `${ROOT}/.memory/decisions.md`

function engine(on: any, files: Record<string, string>, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_: any, e: any) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.write', (_: any, e: any) => { if (String(e.path).startsWith(ROOT)) files[e.path] = e.text; return { value: undefined } })
  on('process.run', (_: any, e: any) => ({ value: { exitCode: 0, stdout: e.argv.includes('log') ? 'abc1234 last change' : ' M src/cart.js', stderr: '' } }))
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('classic.SessionStart', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.PreCompact', () => ({}))
  on('classic.Stop', () => ({}))
}
const LOG = '# Session log\n\nheader\n\n## 2026-11-10 17:00 · cart work\n- Goal: fix totals\n- Next step: coupon clamp\n'
const CTX = '# Context\n\n## Cart\n<!-- paths: src/cart.js, src/{coupons,tax}.js -->\n- Prices are integer cents.\n\n## Untagged\n- never injected\n'
const DEC = '# Decisions\n\n## Clamp at zero\n<!-- paths: src/coupons.js -->\n- Decision: totals never go negative.\n'

test('SessionStart loads the rules and session.md on startup, clear and compact', async ($, on) => {
  engine(on, { [SESSION]: LOG })
  for (const source of ['startup', 'clear', 'compact']) {
    const r: any = await ($ as any).classic.SessionStart({ source })
    const text = (r.additionalContext ?? []).join('\n')
    expect(text).toContain('[md-memory] Project memory lives in .memory/')
    expect(text).toContain('## 2026-11-10 17:00 · cart work')
  }
})

test('when CLAUDE.md imports the workspace file, the rules are not attached twice (the log still is)', async ($, on) => {
  const IMPORT = '# Mine\n\n<!-- >>> claude-workspace (managed) >>> -->\n@.claude/workspace/CLAUDE.workspace.md\n<!-- <<< claude-workspace (managed) <<< -->\n'
  engine(on, { [SESSION]: LOG, [`${ROOT}/CLAUDE.md`]: IMPORT, [`${ROOT}/.claude/workspace/CLAUDE.workspace.md`]: '# W\n## Memory\n## Coding guidelines (Karpathy)\n' })
  const r: any = await ($ as any).classic.SessionStart({ source: 'startup' })
  const text = (r.additionalContext ?? []).join('\n')
  expect(text).not.toContain('[md-memory] Project memory lives in .memory/')
  expect(text).toContain('## 2026-11-10 17:00 · cart work')
})

test('an empty session log and an imported CLAUDE.md attach no memory text at all', async ($, on) => {
  engine(on, { [`${ROOT}/CLAUDE.local.md`]: '<!-- >>> claude-workspace (managed) >>> -->\n@.claude/workspace/CLAUDE.workspace.md\n<!-- <<< claude-workspace (managed) <<< -->\n' })
  const r: any = await ($ as any).classic.SessionStart({ source: 'startup' })
  expect(r.additionalContext).toBeUndefined()
})

test('without session.md only the rules are attached; CW_MEMORY=0 attaches nothing', async ($, on) => {
  engine(on, {})
  const r: any = await ($ as any).classic.SessionStart({ source: 'startup' })
  expect(r.additionalContext.length).toBe(1)
  expect(r.additionalContext[0]).not.toContain('Project session log')
})

test('CW_MEMORY=0 turns memory off', async ($, on) => {
  engine(on, { [SESSION]: LOG }, { CW_MEMORY: '0' })
  const r: any = await ($ as any).classic.SessionStart({ source: 'startup' })
  expect(r.additionalContext).toBeUndefined()
})

test('touching a file injects matching sections once per session, again after /clear', async ($, on) => {
  engine(on, { [CONTEXT]: CTX, [DECISIONS]: DEC })
  await ($ as any).classic.SessionStart({ source: 'startup' })
  const touch = (file_path: string) => ($ as any).classic.PostToolUse({ tool_name: 'Read', tool_input: { file_path }, tool_response: {} })
  const first: any = await touch(`${ROOT}/src/coupons.js`)
  const text = first.additionalContext.join('\n')
  expect(text).toContain('Notes that apply to src/coupons.js')
  expect(text).toContain('## Cart') // brace glob src/{coupons,tax}.js
  expect(text).toContain('## Clamp at zero')
  expect(text).not.toContain('never injected')
  const again: any = await touch(`${ROOT}/src/coupons.js`)
  expect(again.additionalContext).toBeUndefined()
  const other: any = await touch(`${ROOT}/README.md`)
  expect(other.additionalContext).toBeUndefined()
  await ($ as any).classic.SessionStart({ source: 'clear' })
  const afterClear: any = await touch(`${ROOT}/src/cart.js`)
  expect(afterClear.additionalContext.join('\n')).toContain('## Cart')
})

test('auto PreCompact appends a mechanical snapshot; manual does not', async ($, on) => {
  const files: Record<string, string> = { [SESSION]: LOG }
  engine(on, files)
  await ($ as any).classic.PreCompact({ trigger: 'manual', custom_instructions: null })
  expect(files[SESSION]).toBe(LOG)
  await ($ as any).classic.PreCompact({ trigger: 'auto', custom_instructions: null })
  expect(files[SESSION]).toContain('· auto-snapshot (auto)')
  expect(files[SESSION]).toContain('- Last commit: abc1234 last change')
  expect(files[SESSION]).toContain('  - M src/cart.js')
  expect(files[SESSION].startsWith(LOG)).toBe(true)
})

test('Stop trims session.md to the cap, dropping the oldest blocks', async ($, on) => {
  const blocks = Array.from({ length: 30 }, (_, i) => `## 2026-11-${String(i + 1).padStart(2, '0')} 10:00 · block ${i}\n- Goal: g\n- Next step: n\n`).join('\n')
  const files: Record<string, string> = { [SESSION]: '# Session log\n\n' + blocks }
  engine(on, files, { CW_MEMORY_MAX_LINES: '40' })
  await ($ as any).classic.Stop({ stop_hook_active: false })
  const lines = files[SESSION].split('\n').length - 1
  expect(lines <= 40).toBe(true)
  expect(files[SESSION]).toContain('# Session log')
  expect(files[SESSION]).toContain('block 29')
  expect(files[SESSION]).not.toContain('block 0\n')
})
