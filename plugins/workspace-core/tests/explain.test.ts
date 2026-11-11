// Engine-level test of Explain (no model calls): `claude plugin test plugins/workspace-core`.
// Hooks registered here stand for the engine beneath workspace-core; git is a fake.
import { expect, test } from 'claude-code/testing'

const ROOT = '/proj'
const NUMSTAT = '3\t1\tsrc/cart.js\n'
const DIFF = '--- a/src/cart.js\n+++ b/src/cart.js\n@@ -5 +5,3 @@\n+x\n'
let files: Record<string, string> = {}
let bashExit = 0
let skillText = ''

function engine(on: any, env: Record<string, string> = {}) {
  on('env.get', (_: any, e: any) => ({ value: { CW_PLAN_EXECUTION: '0', CW_MEMORY: '0', ...env }[e.name] }))
  on('session.root', () => ({ value: ROOT }))
  on('fs.read', (_: any, e: any) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] } })
  on('fs.write', (_: any, e: any) => { if (String(e.path).startsWith(ROOT)) files[e.path] = e.text; return { value: undefined } })
  on('fs.exists', (_: any, e: any) => ({ value: e.path in files }))
  on('fs.list', (_: any, e: any) => ({ value: Object.keys(files).filter((p) => p.startsWith(e.path + '/')).map((p) => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }))
  on('process.run', (_: any, e: any) => {
    const a = e.argv.join(' ')
    const out = a.includes('rev-parse') ? 'abc' : a.includes('ls-files') ? 'docs/new.md\n' : a.includes('decisions.md') ? '+## Clamp at zero\n' : a.includes('--numstat') ? NUMSTAT : a.includes('-U0') ? DIFF : ''
    return { value: { exitCode: 0, stdout: out, stderr: '' } }
  })
  on('prompt.submit', (_: any, e: any) => ({ text: e.text }))
  on('skill.prompt', () => ({ text: skillText }))
  on('tool.call', (_: any, e: any) => (e.tool === 'Bash' ? (bashExit ? { result: {}, isError: true, text: `Exit code ${bashExit}\nfail` } : { result: {}, text: 'ok' }) : { result: { ok: true }, text: 'ok' }))
  on('turn.step', async function* (_: any, e: any) {
    yield { kind: 'text', index: 0, text: 'ok', ref: 1 }
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: null }
  })
}
const reset = () => { files = { [`${ROOT}/docs/new.md`]: 'a\nb\n', [`${ROOT}/src/cart.js`]: 'x' }; bashExit = 0; skillText = '# Explain\n\nTarget: \n' }
const explain = ($: any) => $.skill.prompt({ skill: 'workspace-core:explain', text: skillText, frontmatter: {}, source: 'plugin', pluginName: 'workspace-core' })
const bash = ($: any, command: string, exit = 0) => { bashExit = exit; return $.tool.call({ tool: 'Bash', command } as any) }

const GOOD = `# u-0001 · Cart total fix

**In short:** Totals no longer go negative. A coupon above the price now clamps at zero.

## What changed
- **Clamp:** \`src/cart.js:5-7\` · ran \`npm test\` (exit 0)
- **Notes:** \`docs/new.md\` says why.

## Why
You asked to fix negative totals.

## How it works now
1. The total is clamped at zero.

## Not done / not tested
- nothing known

## Verify yourself
\`\`\`sh
npm test
\`\`\`

## Start reading at
\`src/cart.js:5\`
`

test('/explain captures the record by code and hands it to the skill', async ($, on) => {
  reset(); engine(on)
  await $.prompt.submit({ text: 'Fix negative cart totals', origin: { kind: 'composer' } } as any)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/cart.js`, old_string: 'a', new_string: 'b' } as any)
  await bash($, 'npm test', 1)
  await bash($, 'ls -la')
  await bash($, 'npm test')
  const r: any = await explain($)
  expect(r.text).toContain('write the explanation to `.explain/units/u-0001.md`')
  const rec = JSON.parse(files[`${ROOT}/.explain/records/u-0001.json`])
  expect(rec.files.map((f: any) => f.path)).toEqual(['src/cart.js', 'docs/new.md'])
  expect(rec.files[0].hunks).toEqual([[5, 7]])
  expect(rec.commands.map((c: any) => [c.cmd, c.exit])).toEqual([['npm test', 1], ['npm test', 0]])
  expect(rec.verifiedAfterLastEdit).toBe('npm test')
  expect(rec.request).toEqual(['Fix negative cart totals'])
  expect(rec.decisions).toEqual(['Clamp at zero'])
  // the next unit starts fresh: no old commands, the next id
  const r2: any = await explain($)
  expect(r2.text).toContain('u-0002')
  expect(JSON.parse(files[`${ROOT}/.explain/records/u-0002.json`]).commands).toEqual([])
})

test('writing the unit file runs the validator: feedback on failure, silence on pass', async ($, on) => {
  reset(); engine(on)
  await bash($, 'npm test')
  await explain($)
  const path = `${ROOT}/.explain/units/u-0001.md`
  files[path] = GOOD.replace('`src/cart.js:5-7`', '`src/cart.js:90`')
  const bad: any = await $.tool.call({ tool: 'Write', file_path: path, content: files[path] } as any)
  expect((bad.context ?? []).join('\n')).toContain('grounding-files: `src/cart.js:90`'.replace('`src/cart.js:90`', 'src/cart.js:90'))
  files[path] = GOOD
  const ok: any = await $.tool.call({ tool: 'Write', file_path: path, content: GOOD } as any)
  expect(ok.context).toBeUndefined()
})

test('feedback is given at most twice per unit; nothing is ever denied', async ($, on) => {
  reset(); engine(on)
  await explain($)
  const path = `${ROOT}/.explain/units/u-0001.md`
  files[path] = '# nothing'
  const n = []
  for (let i = 0; i < 3; i++) {
    const r: any = await $.tool.call({ tool: 'Write', file_path: path, content: files[path] } as any)
    expect(r.deny).toBeUndefined()
    n.push((r.context ?? []).length)
  }
  expect(n).toEqual([1, 1, 0])
})

test('a bad target and CW_EXPLAIN=0 write nothing', async ($, on) => {
  reset(); engine(on, { CW_EXPLAIN: '0' })
  const off: any = await explain($)
  expect(off.text).toContain('CW_EXPLAIN=0')
  expect(Object.keys(files).some((p) => p.includes('.explain'))).toBe(false)
})

test('a bad target is refused before git runs', async ($, on) => {
  reset(); engine(on); skillText = '# Explain\n\nTarget: HEAD; rm -rf /\n'
  const r: any = await explain($)
  expect(r.text).toContain('not a commit name')
  expect(Object.keys(files).some((p) => p.includes('.explain'))).toBe(false)
})
