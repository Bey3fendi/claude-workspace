// Phase 4 enforcement: the root-cause gate (plan §6, Phase 3 gate hand-off).
// In a debug-class request, the first edit to a non-test source file is held until the model's visible
// text in this request states a root cause. Advice alone gave 1/3 (docs/baselines/2026-11-02-phase3-gate.md).
// Pure functions; register.mjs owns the per-request state. No model calls.

export const GATE_LIMIT = 2 // denies per request; after that the edit goes through (no loops, no lock-out)

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const TEST_PATH = /(^|[\\/])(tests?|__tests__|specs?|e2e)[\\/]|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py)$|(^|[\\/])test_[^\\/]+\.py$/i
const NON_CODE = /\.(md|mdx|txt|rst|adoc)$/i

/** The file a tool call writes, or null when it writes none we gate. Shell writes use the same patterns as the outcome grader. */
export function editTarget(e) {
  if (EDIT_TOOLS.has(e?.tool)) return e.file_path ?? e.notebook_path ?? null
  if (e?.tool !== 'Bash' || typeof e.command !== 'string') return null
  const c = e.command
  const m = c.match(/(?:[^<>&]>>?|\btee(?:\s+-a)?)\s*['"]?([^\s'";|&<>]+\.[A-Za-z0-9]+)/) ??
    c.match(/\bsed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+([^\s;|&]+)/)
  if (!m || /^\/dev\//.test(m[1])) return null
  return m[1]
}

/** Edits the gate holds: source files only. Tests (writing a reproducing test first is good debugging) and docs pass. */
export const gatedFile = (f) => typeof f === 'string' && f.length > 0 && !TEST_PATH.test(f) && !NON_CODE.test(f)

const LOCATION = /[\w./\\-]+\.[A-Za-z]{1,5}:\d+|\bline \d+\b|\bin `?[\w.]+\(?\)?`? (?:at|on) line\b/i
const CAUSAL = /\bbecause\b|\bcaused by\b|\bdue to\b|\bthe (?:bug|issue|problem|defect) is\b|\bcomes from\b|\bstems from\b/i

/** Has the visible text stated a root cause? Either says so explicitly, or names a location with a causal claim. */
export function statesRootCause(text) {
  const t = String(text ?? '')
  if (/\broot[- ]cause\b\s*(?:is|was|:|—|-|=)/i.test(t)) return true
  return LOCATION.test(t) && CAUSAL.test(t)
}

export const denyText = (file) =>
  `[workspace gate: root cause first] This is a debugging request. Before editing ${String(file).split(/[\\/]/).pop()}, ` +
  'state the root cause in your reply: "Root cause: <file:line> — <why it produces the failure>". Then make the minimal fix. ' +
  'Editing or adding tests is not held. (If this is not a bug fix, say so in one line and edit again.)'

/**
 * Decide one tool call. state: { class, text, denies, released }.
 * Returns { action: 'pass' } or { action: 'deny', file, reason }, and never denies more than GATE_LIMIT times per request.
 */
export function decide(state, e) {
  if (!state || state.class !== 'debug' || state.released || e?.agentId !== undefined) return { action: 'pass' }
  const file = editTarget(e)
  if (!gatedFile(file)) return { action: 'pass' }
  if (statesRootCause(state.text)) return { action: 'pass', reason: 'root cause stated' }
  if (state.denies >= GATE_LIMIT) return { action: 'pass', reason: 'gate limit reached' }
  return { action: 'deny', file, reason: 'no root cause stated' }
}
