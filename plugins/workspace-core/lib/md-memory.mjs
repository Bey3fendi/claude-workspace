// md-memory: file-based session-to-session memory (replaces claude-mem). Ported from the user's POC
// (.claude/hooks/mem.mjs): same files, same formats, same behaviour, now built into workspace-core.
//   .memory/session.md    rolling log, loaded at every SessionStart (startup|resume|clear|compact)
//   .memory/context.md    module facts  } "## " sections with <!-- paths: glob, glob -->, injected
//   .memory/decisions.md  choices + why } once per session when Claude reads/edits a matching file
// PreCompact (auto) appends a mechanical snapshot; Stop trims session.md to MAX_LINES (oldest blocks first).
// Pure functions only; register.mjs does the I/O. No network, no dependencies.

export const MEMORY_DIR = '.memory'
export const FILES = { session: `${MEMORY_DIR}/session.md`, context: `${MEMORY_DIR}/context.md`, decisions: `${MEMORY_DIR}/decisions.md` }
export const DEFAULT_MAX_LINES = 150
// Not under .claude/: Claude Code treats every file there as sensitive and asks before each edit (and a
// headless run can never write it), whatever the allow rules say. Outside it, this one rule suffices.
export const MEMORY_ALLOWS = [`Edit(${MEMORY_DIR}/**)`] // Edit(path) covers every file-editing tool; Write(path) rules are never matched

/** How Claude should use the memory (the POC's CLAUDE.md snippet, attached with session.md instead of editing CLAUDE.md). */
export const MEMORY_RULES = [
  '[md-memory] Project memory lives in .memory/ (plain markdown, committed with the project).',
  '- session.md is loaded automatically at start, after /clear and after /compact.',
  '- After each verified unit of work, append a block to the BOTTOM of session.md (format is in its header). Keep it short: the file is capped and the oldest blocks are dropped. If a request changes files and you write no block, the workspace appends a facts-only one (files, last check); yours is better, since only you know the goal and the next step.',
  '- When you recommend /clear or /compact, first write the handoff into session.md (not into the chat), then tell the user to run the command. Nothing needs to be pasted back.',
  '- A durable fact about a module goes in context.md; a choice and its reason goes in decisions.md. Every section there needs `<!-- paths: glob, glob -->` or it is never loaded.',
  '- Do not read context.md or decisions.md in full; the relevant sections are injected when you read a matching file, or returned instead of applying your first edit to it, before anything changes.',
].join('\n')

/** Glob → RegExp: ** (any dirs), * (no slash), ?, {a,b}. Paths are POSIX, relative to the project root. */
export function globToRegex(glob) {
  let re = '', i = 0
  glob = glob.trim().replace(/^\.\//, '')
  while (i < glob.length) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 3 : 2; continue }
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if (c === '{' && glob.indexOf('}', i) > i) {
      const end = glob.indexOf('}', i)
      re += '(?:' + glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'
      i = end
    } else re += c.replace(/[.+^$()|[\]\\{}]/g, '\\$&')
    i++
  }
  return new RegExp('^' + re + '$')
}

/** Split a paths line on commas that are not inside {…} (POC fix: `src/{a,b}.ts` stays one glob). */
export function splitGlobs(line) {
  const out = []; let cur = '', depth = 0
  for (const ch of line) {
    if (ch === '{') depth++
    if (ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** "## Title" blocks that carry `<!-- paths: … -->`. Blocks without it are never injected. */
export function parseSections(text, file) {
  const out = []
  for (const block of String(text ?? '').split(/^(?=## )/m)) {
    if (!block.startsWith('## ')) continue
    const m = block.match(/<!--\s*paths:\s*(.+?)\s*-->/)
    if (!m) continue
    out.push({ id: `${file}#${block.split('\n')[0].slice(3).trim()}`, globs: splitGlobs(m[1]).map(globToRegex), body: block.trim() })
  }
  return out
}

/** Project-relative POSIX path of a tool's file, or null when outside the project or inside the memory dir. */
export function relPath(root, filePath) {
  if (!filePath || !root) return null
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const r = norm(root), f = norm(filePath)
  let rel = f.startsWith('/') || /^[A-Za-z]:\//.test(f) ? (f === r ? '' : f.startsWith(r + '/') ? f.slice(r.length + 1) : null) : f.replace(/^\.\//, '')
  if (rel == null || rel === '' || rel.startsWith('../') || rel.startsWith(`${MEMORY_DIR}/`)) return null
  return rel
}

/** Sections to inject for one touched file; `injected` is the ids already sent this session. */
export function matchSections(sections, rel, injected) {
  if (!rel) return []
  return sections.filter((s) => !injected.has(s.id) && s.globs.some((g) => g.test(rel)))
}

export function injectText(rel, hits) {
  return `[md-memory] Notes that apply to ${rel}:\n\n` + hits.map((h) => `(${h.id.split('#')[0]})\n${h.body}`).join('\n\n')
}

/** SessionStart context: the rules, plus session.md when it has content. */
export function sessionStartText(sessionText, { rules = true } = {}) {
  // rules = false: the project's CLAUDE.md imports the workspace file, which carries the same rules
  const s = String(sessionText ?? '').trim()
  const log = s ? `[md-memory] Project session log (.memory/session.md). Read it before continuing; the newest block is last.\n\n${s}` : ''
  return [rules ? MEMORY_RULES : '', log].filter(Boolean).join('\n\n') || null
}

/** Mechanical PreCompact block (not written by Claude). */
export function snapshotBlock({ stamp, trigger = 'compact', lastCommit = '', porcelain = '' }) {
  const changed = String(porcelain).split('\n').filter(Boolean).slice(0, 15).map((l) => `  - ${l.trim()}`)
  return [`## ${stamp} · auto-snapshot (${trigger})`,
    '- Written by the PreCompact hook, not by Claude: check the block above for intent and next step.',
    lastCommit && `- Last commit: ${lastCommit}`, changed.length ? '- Uncommitted:' : '- Working tree clean', ...changed].filter(Boolean).join('\n')
}

export function appendBlock(text, block) {
  const t = String(text ?? '')
  return t + (t.endsWith('\n') || !t ? '' : '\n') + '\n' + block + '\n'
}

/** Keep at most maxLines lines, dropping the oldest "## " blocks (the header stays). */
export function trimSession(text, maxLines = DEFAULT_MAX_LINES) {
  const t = String(text ?? '')
  if (!t) return t
  const parts = t.split(/^(?=## )/m)
  const header = parts[0].startsWith('## ') ? '' : parts.shift()
  const count = (s) => s.split('\n').length - 1
  while (parts.length > 1 && count(header + parts.join('')) > maxLines) parts.shift()
  let out = header + parts.join('')
  if (count(out) > maxLines) out = out.split('\n').slice(0, maxLines).join('\n') + '\n'
  return out
}

export const maxLinesFrom = (v) => (/^\d+$/.test(String(v ?? '')) && Number(v) > 0 ? Number(v) : DEFAULT_MAX_LINES)

/** Local time as YYYY-MM-DD HH:MM. */
export const stampOf = (d = new Date()) => d.toLocaleString('sv-SE').slice(0, 16)

/** Templates the installer writes when a file is missing (the POC's headers, without its project-specific examples). */
export const TEMPLATES = {
  session: [
    '# Session log',
    '',
    `Rolling log, max ${DEFAULT_MAX_LINES} lines; the oldest blocks are dropped automatically. Newest block goes at the BOTTOM.`,
    'One block per session or per verified unit of work. Format:',
    '',
    '  ## YYYY-MM-DD HH:MM · short title',
    '  - Goal:',
    '  - Done (verified):',
    '  - Decisions: (one line each; the reasoning goes in decisions.md)',
    '  - Ruled out:',
    '  - Next step:',
    '  - Files:',
    '',
  ].join('\n'),
  context: [
    '# Context',
    '',
    'Facts about parts of the codebase. Each "## " section is injected only when Claude reads or edits',
    'a file matching its `paths:` globs (once per session; again after /clear or /compact).',
    'Sections without a `paths:` line are never injected. Keep each section short (5–15 lines).',
    '',
    'Example (indented, so it is not a section; write yours at the start of the line):',
    '',
    '  ## Payments module',
    '  <!-- paths: src/payments/**, src/checkout.ts -->',
    '  - All provider calls go through src/payments/client.ts.',
    '',
  ].join('\n'),
  decisions: [
    '# Decisions',
    '',
    'Why things are the way they are, so a fresh session does not undo them. Same rules as context.md:',
    'each "## " section needs a `paths:` line and is injected only when a matching file is touched.',
    '',
    'Example (indented, so it is not a section; write yours at the start of the line):',
    '',
    '  ## Prices are integer cents',
    '  <!-- paths: src/cart.js, src/coupons.js -->',
    '  - Decision (YYYY-MM-DD): store money as integer cents.',
    '  - Why: float rounding errors in totals.',
    '  - Rejected: decimal.js (extra dependency).',
    '',
  ].join('\n'),
}

// ---------------------------------------------------------------- automatic memory (v0.13.0)
// Three pieces, all switchable: a pre-edit hold (notes for a path reach the model before its first edit there),
// an end-of-request block in session.md written by the workspace (facts only), and one Stop nudge asking the
// model to record the decisions of a designed change. Pure functions; register.mjs owns state and I/O.

/** Deny text for the first edit of a file whose notes the model has not seen yet. The retry goes through. */
export function preEditText(rel, hits) {
  return `${injectText(rel, hits)}\n\n[md-memory] These notes were not in your context yet, so this edit was not applied. ` +
    'Check the change against them, then make the edit again (as is, or adjusted to fit them).'
}

/** "## " headings of a memory file (context.md / decisions.md), for "what is new this request". */
export const headingsOf = (text) => String(text ?? '').split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim())

/** One-line title from the request: first line, secrets redacted (the file is committed), capped. */
export function requestTitle(text, redact = (s) => s, max = 72) {
  const line = redact(String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '').replace(/\s+/g, ' ')
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line
}

const listOf = (xs, n = 8) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', '))
const quoted = (xs) => xs.map((x) => `"${x}"`).join(', ')

/**
 * The workspace's own session.md block at the end of a request that changed files. `check`: the last
 * verification command after the last edit ({ cmd, exit }) or null; `added`: new headings per memory file.
 */
export function autoBlock({ stamp, cls, title, files, check, added = {} }) {
  const head = `## ${stamp} · ${cls ? `${cls}: ` : ''}${title || 'changes'}`
  const lines = [head, '- Auto-logged by the workspace at the end of the request (facts only; Claude wrote no block for it).']
  lines.push(`- Files changed: ${listOf(files)}`)
  lines.push(check ? `- Last check after the last edit: \`${check.cmd.length > 80 ? check.cmd.slice(0, 79) + '…' : check.cmd}\` → exit ${check.exit}` : '- Last check after the last edit: none run')
  const rec = [added.decisions?.length && `decisions.md ${quoted(added.decisions)}`, added.context?.length && `context.md ${quoted(added.context)}`].filter(Boolean)
  lines.push(`- Recorded: ${rec.length ? rec.join('; ') : 'nothing new in decisions.md or context.md'}`)
  lines.push('- Next step: not recorded; check the request and the files above.')
  return lines.join('\n')
}

/** Ask once, at the end of a designed change, for the decisions to be written down. */
export function shouldNudge({ cls, edited, designed, recorded, nudged }) {
  return !nudged && !recorded && edited && (cls === 'architecture' || (cls === 'feature' && designed))
}

export const NUDGE_TEXT = '[md-memory] This request changed code after a design step, but nothing was added to .memory/decisions.md ' +
  'or .memory/context.md. Before you finish: add each decision a later session must not undo to decisions.md (a "## " title, ' +
  'a <!-- paths: glob, glob --> line naming the files it governs, then Decision / Why / Rejected), and any durable fact about a ' +
  'module to context.md the same way. If nothing here needs recording, say so in one line. Then finish your reply as before.'

/** `git status --porcelain -uall` → Map(path → status line); renames are keyed by the new path. */
export function porcelainMap(text) {
  const m = new Map()
  for (const line of String(text ?? '').split('\n')) {
    if (line.length < 4) continue
    const path = line.slice(3).split(' -> ').pop().replace(/^"|"$/g, '')
    m.set(path, line)
  }
  return m
}

/**
 * Files this request changed: the ones the file tools edited, plus the ones git shows as changed now but not
 * (or differently) at the request's start, so Bash edits count too. Memory, Explain and .claude files excluded.
 */
export function changedFiles(edited, before, after) {
  const out = [...edited]
  const b = porcelainMap(before)
  for (const [p, line] of porcelainMap(after)) if (b.get(p) !== line && !out.includes(p)) out.push(p)
  return out.filter((p) => !/^\.(memory|explain|claude)\//.test(p))
}

/** The command that counts as the last check: its first line only (a heredoc body that mentions a test is not one). */
export const checkLine = (cmd) => String(cmd ?? '').split('\n')[0].trim()
