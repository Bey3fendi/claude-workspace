// CLAUDE.md integration (spec: docs/claude-md-integration.md). The workspace owns one file,
// .claude/workspace/CLAUDE.workspace.md, and adds a three-line managed block to the user's CLAUDE.md
// (or CLAUDE.local.md) that imports it with Claude Code's @path syntax. Text outside the block is
// never read for meaning, reordered or changed.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { inspect, upsert, remove } from './managed-block.mjs'

import { OWNED, BEGIN, END, IMPORT_LINE } from '../../plugins/workspace-core/lib/claude-md.mjs'
export { OWNED, BEGIN, END, IMPORT_LINE }
export const MARKERS = { begin: BEGIN, end: END }
export const TARGETS = { project: 'CLAUDE.md', local: 'CLAUDE.local.md' }
/** Above this many lines the owned file costs more context than intended (doctor warns). */
export const lengthLimit = (features) => (features.karpathy ? 100 : 40)

const sha256 = (b) => createHash('sha256').update(b).digest('hex')

/** The vendored Karpathy pin from the lock, or null. */
export const karpathyPin = (lock) => (lock.vendored ?? []).find((v) => v.name === 'karpathy-guidelines') ?? null

/** Read the vendored file and check it against the lock's sha256. */
export function readVendored(repoRoot, pin) {
  const buf = readFileSync(join(repoRoot, pin.file))
  const actual = sha256(buf)
  return { text: buf.toString('utf8'), ok: actual === pin.sha256, actual }
}

/** Upstream's CLAUDE.md nested under our heading: its `# CLAUDE.md` title dropped, `##` demoted to `###`. */
export function demote(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  if (/^#\s+CLAUDE\.md\s*$/.test(lines[0] ?? '')) { lines.shift(); while (lines[0] === '') lines.shift() }
  let fence = false
  const out = lines.map((l) => {
    if (/^\s*```/.test(l)) fence = !fence
    return !fence && /^##\s/.test(l) ? `#${l}` : l
  })
  return out.join('\n').replace(/\s+$/, '')
}

/** Render the template: `{{#if x}}…{{/if}}` line blocks and `{{name}}` values. No markers survive. */
export function render(template, vars) {
  const out = []
  const stack = []
  for (const line of template.replace(/\r\n/g, '\n').split('\n')) {
    const open = line.match(/^\{\{#if (\w+)\}\}\s*$/)
    if (open) { stack.push(!!vars[open[1]]); continue }
    if (/^\{\{\/if\}\}\s*$/.test(line)) { stack.pop(); continue }
    if (stack.every(Boolean)) out.push(line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

/** The owned file for the features this install has. `responseStyle: false` is `--no-response-style`. */
export function workspaceMd(ctx, opts = {}) {
  const features = { mdMemory: true, contracts: true, karpathy: true, responseStyle: true, ...opts }
  const template = readFileSync(join(ctx.repoRoot, 'templates', 'CLAUDE.workspace.md'), 'utf8')
  const pin = karpathyPin(ctx.lock)
  const k = features.karpathy && pin ? readVendored(ctx.repoRoot, pin) : null
  if (k && !k.ok) throw new Error(`${pin.file} does not match the lock (sha256 ${k.actual.slice(0, 12)}…, expected ${pin.sha256.slice(0, 12)}…)`)
  return render(template, {
    ...features, karpathy: !!k, version: ctx.lock.workspaceVersion,
    karpathyCommit: pin?.commit ?? '', karpathyGuidelines: k ? demote(k.text) : '',
  })
}

/** Where the import goes: null for --no-claude-md. */
export function targetOf(opts) {
  if (opts.claudeMd === false) return null
  return opts.claudeMd === 'local' ? TARGETS.local : TARGETS.project
}

/** State of the import in a CLAUDE.md text: 'missing' | 'ok' | 'edited' | 'duplicate' | 'malformed'. */
export function importState(text) {
  const i = inspect(text ?? '', MARKERS)
  if (!i.wellFormed) return { state: 'malformed', problem: i.problem }
  if (!i.count) return { state: 'missing' }
  if (i.count > 1) return { state: 'duplicate' }
  return { state: i.body.trim() === IMPORT_LINE ? 'ok' : 'edited' }
}

/** Apply the install table to a CLAUDE.md text (null = no file). Throws on malformed markers. */
export function addImport(text) {
  const { text: out, action } = upsert(text ?? '', [IMPORT_LINE], MARKERS, { blankLineBefore: true })
  return { text: out, action: text == null || text === '' ? (action ? 'created' : null) : action }
}

export const removeImport = (text) => remove(text, MARKERS, { blankLineBefore: true })
