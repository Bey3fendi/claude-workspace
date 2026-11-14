// Ponytail, driven by the workspace (0.16.0): no /ponytail-* command needed.
// Ponytail's own hooks inject its rules once, at session start; in long sessions they fade (AgentBridge 2026-11:
// its closing line was in 16 of 97 answers). The workspace repeats the core rule per request, routes reviews and
// audits to Ponytail's skills, and asks once for the closing line when a request edited code without it.
// Pure functions; register.mjs owns the state. Ponytail being active is taken only from its injected text.

const LEVELS = new Set(['lite', 'full', 'ultra'])

/** The level Ponytail announced in text it injected ("PONYTAIL MODE ACTIVE — level: full"), or null. */
export function injectedLevel(content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '')
  const m = text.match(/PONYTAIL MODE ACTIVE\s*[—-]+\s*level:\s*([a-z]+)/i)
  return m ? m[1].toLowerCase() : null
}

/** A user prompt that switches Ponytail (its own commands): the new level, 'off', or null for no change. */
export function promptLevel(text) {
  const t = String(text ?? '').trim().toLowerCase()
  if (/^(stop ponytail|normal mode)[.!?\s]*$/.test(t)) return 'off'
  const m = t.match(/^[/@$]ponytail\s+(lite|full|ultra|off)\b/)
  return m ? m[1] : null
}

export const activeLevel = (level) => (LEVELS.has(level) ? level : null)

/** The per-request reminder (model-only context). */
export const reminderText = (level) =>
  `[workspace · ponytail ${level}] Smallest complete change: reuse what the codebase has, add nothing unrequested. ` +
  'End your reply with one line: what you skipped or did not check, and any risk the user must know.'

/** Classes whose requests change code: the reminder rides with their contract. */
export const CODE_CLASSES = new Set(['feature', 'debug', 'tests', 'architecture', 'review-feedback'])

// The closing line Ponytail asks for, looked for in the last lines of the answer.
const CLOSING = /\b(skipp(ed|ing)|not (yet )?(checked|run|tested|verified)|did(n'?t| not) (check|run|test|verify|cover)|unchecked|untested|unverified|risks?|caveat)\b/i

export function hasClosingLine(answer) {
  const lines = String(answer ?? '').trim().split('\n').filter((l) => l.trim()).slice(-6)
  return lines.some((l) => CLOSING.test(l))
}

export const CLOSE_TEXT =
  '[workspace · ponytail] Add the one closing line Ponytail asks for: what you skipped or did not check, and any risk ' +
  'the user must know (or "nothing skipped"). Reply with that line only; do not repeat the answer.'
