// Engine-level tests of 0.18.1 (no model calls): follow-up confirmations inherit the previous request's contract,
// and files changed through Bash count as edits. `claude plugin test plugins/workspace-core`.
import { expect, test } from 'claude-code/testing'

let status = '' // what `git status --porcelain -uall` prints now
let hashes: Record<string, string> = {}
function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_MEMORY: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: '/proj' }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('fs.write', () => ({ value: undefined }))
  on('process.run', (_: any, e: any) => {
    const a = e.argv.join(' ')
    if (a.includes('status --porcelain')) return { value: { exitCode: 0, stdout: status, stderr: '' } }
    if (a.includes('hash-object')) return { value: { exitCode: 0, stdout: e.argv.slice(e.argv.indexOf('--') + 1).map((p: string) => hashes[p] ?? 'h0').join('\n') + '\n', stderr: '' } }
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text, context: e.context }))
  on('tool.call', (_: any, e: any) => {
    if (e.tool === 'Bash' && /python3/.test(e.command)) { status = ' M src/cart.ts\n'; hashes['src/cart.ts'] = 'h-new' } // the script edits a file
    return { result: { ok: true }, text: 'ok' }
  })
  on('classic.PostToolUse', () => ({}))
}
const ask = async ($: any, text: string) => (((await $.prompt.submit({ text, origin: { kind: 'composer' } })) as any)?.context ?? []).join('\n')
const ponytailStarts = ($: any) => $.session.append({
  message: { type: 'attachment', role: 'user', content: [{ type: 'text', text: 'PONYTAIL MODE ACTIVE — level: full\n\nYou are a lazy senior developer.' }] },
  door: 'hook-context', origin: { kind: 'hook', event: 'SessionStart' }, uuid: 'u-pt',
})

test('"yes lets do all three" after a debug request carries the debug contract as a follow-up', async ($, on) => {
  engine(on)
  expect(await ask($, 'The webhook handler fails on real DefensX payloads, find out why')).toContain('[workspace contract: debug]')
  expect(await ask($, 'yes lets do all three.')).toContain('[workspace contract: debug, follow-up]')
})

test('a follow-up after a question or an unclassified request gets nothing; CW_FOLLOW_UP=0 turns it off', async ($, on) => {
  engine(on)
  await ask($, 'how does the Partner API work?')
  expect(await ask($, 'ok go ahead')).not.toContain('[workspace contract')
})

test('CW_FOLLOW_UP=0', async ($, on) => {
  engine(on, { CW_FOLLOW_UP: '0' })
  await ask($, 'The webhook handler fails on real DefensX payloads, find out why')
  expect(await ask($, 'yes lets do all three.')).not.toContain('follow-up')
})

test('a source file changed by a python script counts as an edit: Ponytail\'s rule follows', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  status = ''; hashes = {}
  await ask($, 'here is the KB page with the real payload shapes')
  await $.tool.call({ tool: 'Bash', command: "python3 - <<'EOF'\nopen('src/cart.ts','w').write('x')\nEOF" } as any)
  const r: any = await ($ as any).classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'python3 -' }, tool_response: {} })
  expect((r?.additionalContext ?? []).join('\n')).toContain('[workspace · ponytail full] Smallest complete change')
})

test('a read-only command takes no snapshot', async ($, on) => {
  engine(on)
  await ponytailStarts($)
  status = ' M src/cart.ts\n'; hashes = { 'src/cart.ts': 'h1' }
  await ask($, 'here is the KB page with the real payload shapes')
  await $.tool.call({ tool: 'Bash', command: 'cat src/cart.ts | head -5' } as any)
  const r: any = await ($ as any).classic.PostToolUse({ tool_name: 'Bash', tool_input: { command: 'cat' }, tool_response: {} })
  expect((r?.additionalContext ?? []).join('\n')).not.toContain('ponytail')
})
