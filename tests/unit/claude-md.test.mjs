import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from '../helpers.mjs'
import { addImport, removeImport, importState, render, demote, workspaceMd, lengthLimit, karpathyPin, readVendored, IMPORT_LINE, BEGIN, END } from '../../cli/lib/claude-md.mjs'
import { importsWorkspace } from '../../plugins/workspace-core/lib/claude-md.mjs'
import { CONTRACTS } from '../../plugins/workspace-core/lib/contracts.mjs'
import { loadLock } from '../../cli/lib/context.mjs'

const BLOCK = `${BEGIN}\n${IMPORT_LINE}\n${END}\n`
const ctx = { repoRoot: ROOT, lock: loadLock(ROOT) }

test('install table: create, append, no-op, restore, dedupe', () => {
  assert.deepEqual(addImport(null), { text: BLOCK, action: 'created' })
  assert.deepEqual(addImport(''), { text: BLOCK, action: 'created' })
  assert.deepEqual(addImport('# Mine\n'), { text: `# Mine\n\n${BLOCK}`, action: 'appended' })
  assert.deepEqual(addImport('# Mine'), { text: `# Mine\n\n${BLOCK}`, action: 'appended' }, 'no trailing newline')
  assert.deepEqual(addImport('# Mine\r\nx\r\n'), { text: `# Mine\r\nx\r\n\r\n${BEGIN}\r\n${IMPORT_LINE}\r\n${END}\r\n`, action: 'appended' }, 'CRLF kept')
  const once = addImport('# Mine\n').text
  assert.deepEqual(addImport(once), { text: once, action: null }, 'identical block: nothing')
  const edited = `top\n${BEGIN}\n@somewhere/else.md\n${END}\nbottom\n`
  assert.deepEqual(addImport(edited), { text: `top\n${BLOCK}bottom\n`, action: 'restored' }, 'position kept')
  const two = `a\n${BLOCK}b\n${BLOCK}c\n`
  assert.deepEqual(addImport(two), { text: `a\n${BLOCK}b\nc\n`, action: 'deduplicated' })
})

test('malformed markers: install refuses (throws with the line)', () => {
  assert.throws(() => addImport(`a\n${BEGIN}\n${IMPORT_LINE}\n`), /line 2/)
  assert.throws(() => addImport(`a\nb\n${END}\n`), /line 3/)
  assert.equal(importState(`${BEGIN}\nx\n`).state, 'malformed')
})

test('import state for doctor', () => {
  assert.equal(importState('').state, 'missing')
  assert.equal(importState(BLOCK).state, 'ok')
  assert.equal(importState(`${BEGIN}\n@x\n${END}\n`).state, 'edited')
  assert.equal(importState(BLOCK + BLOCK).state, 'duplicate')
})

test('uninstall: removes the block and the blank line before it, nothing else', () => {
  for (const t of ['# Mine\n', '# Mine\r\nx\r\n', 'a\n\n\nb\n']) assert.equal(removeImport(addImport(t).text), t, JSON.stringify(t))
  assert.equal(removeImport(addImport('# Mine').text), '# Mine\n', 'a missing final newline comes back as one')
  assert.equal(removeImport(BLOCK), '')
  assert.equal(removeImport(`a\n${BLOCK}b\n`), 'a\nb\n')
  const bad = `a\n${BEGIN}\n`
  assert.equal(removeImport(bad), bad, 'malformed: left alone')
})

test('engine-side detection agrees with the CLI', () => {
  assert.equal(importsWorkspace(addImport('# Mine\r\n').text), true)
  assert.equal(importsWorkspace(`${BEGIN}\n@x\n${END}\n`), false)
  assert.equal(importsWorkspace(IMPORT_LINE), false, 'the line alone (no block) is not ours')
  assert.equal(importsWorkspace(''), false)
})

test('template renders every feature combination without leftover markers, within the limits', () => {
  const tpl = readFileSync(join(ROOT, 'templates', 'CLAUDE.workspace.md'), 'utf8')
  for (const mdMemory of [true, false]) for (const contracts of [true, false]) for (const karpathy of [true, false]) {
    const out = render(tpl, { mdMemory, contracts, karpathy, version: '9.9.9', karpathyCommit: 'abc', karpathyGuidelines: '### G\nbody' })
    assert.doesNotMatch(out, /\{\{|\}\}/, 'no template markers')
    assert.equal(out.includes('## Memory'), mdMemory); assert.equal(out.includes('## Workflow contracts'), contracts)
    assert.equal(out.includes('## Coding guidelines (Karpathy)'), karpathy)
    assert.match(out, /## Secrets/); assert.ok(out.endsWith('\n') && !out.endsWith('\n\n'))
    assert.doesNotMatch(out, /\n\n\n/)
  }
  const full = workspaceMd(ctx)
  assert.ok(full.split('\n').length - 1 <= lengthLimit({ karpathy: true }), `${full.split('\n').length - 1} lines`)
  const own = workspaceMd(ctx, { mdMemory: true, contracts: true, karpathy: false })
  assert.ok(own.split('\n').length - 1 <= lengthLimit({ karpathy: false }), `${own.split('\n').length - 1} lines`)
  assert.match(full, /^# Workspace defaults \(claude-workspace \d+\.\d+\.\d+, managed file: do not edit\)/)
  assert.match(full, /`\.memory\/session\.md`/)
})

test('vendored Karpathy text: pinned sha, title dropped, headings demoted, attribution kept', () => {
  const pin = karpathyPin(ctx.lock)
  assert.ok(pin, 'the lock pins the vendored file')
  const v = readVendored(ROOT, pin)
  assert.ok(v.ok, `sha256 ${v.actual}`)
  const d = demote(v.text)
  assert.doesNotMatch(d, /^# CLAUDE\.md/m)
  assert.doesNotMatch(d, /^## /m, 'no ## left')
  assert.match(d, /^### 1\. Think Before Coding$/m)
  assert.match(d, /For trivial tasks, use judgment/, 'upstream wording kept')
  assert.equal(demote('# CLAUDE.md\n\n## A\n```\n## not a heading\n```\n'), '### A\n```\n## not a heading\n```')
  const full = workspaceMd(ctx)
  assert.match(full, new RegExp(`<!-- Vendored from multica-ai/andrej-karpathy-skills@${pin.commit} CLAUDE\\.md, MIT License\\.`))
  assert.match(full, /## Coding guidelines \(Karpathy\)\n<!-- Vendored[^\n]*-->\n\*\*Behavioral|## Coding guidelines \(Karpathy\)\n<!-- Vendored[^\n]*-->\nBehavioral/)
})

test('a tampered vendored file is refused', () => {
  const lock = structuredClone(ctx.lock)
  karpathyPin(lock).sha256 = '0'.repeat(64)
  assert.throws(() => workspaceMd({ ...ctx, lock }), /does not match the lock/)
})

test('contracts no longer name the Karpathy skill', () => {
  assert.doesNotMatch(JSON.stringify(CONTRACTS), /karpathy/i)
})
