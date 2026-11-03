// Context pressure (Phase 6, built in): when the conversation's context is large, ask Claude to
// recommend /clear or /compact at the next natural stopping point, with a cold-start handoff note.
// Size = input + cache-read + cache-creation tokens of the main loop's latest model request, as the
// engine reports it (turn.step usage); no transcript parsing. Pure functions; register.mjs owns state.

export const DEFAULT_THRESHOLD = 300_000

/** Context tokens of one request's usage (ModelUsage), or 0 when unknown. */
export function contextTokens(u) {
  if (!u) return 0
  const n = (x) => (Number.isFinite(x) && x > 0 ? x : 0)
  return n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens)
}

/** Threshold from CW_CONTEXT_PRESSURE_TOKENS (or the user-level hook's CONTEXT_PRESSURE_TOKENS); bad values fall back. */
export function thresholdFrom(...values) {
  for (const v of values) if (typeof v === 'string' && /^\d+$/.test(v.trim()) && Number(v) > 0) return Number(v)
  return DEFAULT_THRESHOLD
}

/** A user-level hook that already does this (e.g. ~/.claude/hooks/context-pressure.sh): avoid a second note. */
export function hasExternalPressureHook(hooks) {
  const groups = Array.isArray(hooks?.UserPromptSubmit) ? hooks.UserPromptSubmit : []
  return groups.some((g) => (g?.hooks ?? []).some((h) => /context-pressure/i.test(String(h?.command ?? ''))))
}

export function pressureNote(tokens) {
  const k = Math.round(tokens / 1000)
  return `[workspace: context pressure] This conversation is at about ${k}K tokens of context. Only at a natural stopping point ` +
    '(a verified unit of work has just finished; never mid-task, and not just because of this note) end your reply with: ' +
    '(1) **CLEAR** or **COMPACT** plus a one-line reason. Default to CLEAR (cheaper and sharper than a long summary; claude-mem ' +
    're-injects recent memories after /clear) unless something cannot be written down (a live reasoning chain, unsaved pasted ' +
    'material); then COMPACT. (2) Tell the user to run /clear or /compact and then paste the handoff note back as their next message. ' +
    '(3) A handoff note in a code block, written so a Claude with zero memory of this chat can pick it up cold: goal; what is done ' +
    '(verified); key decisions and why; what is ruled out; the next step; relevant file paths. If you are mid-task, ignore this note for now.'
}

/** Decide for one human prompt. */
export function decidePressure({ tokens, threshold = DEFAULT_THRESHOLD, disabled = false, external = false }) {
  if (disabled || external || !(tokens > threshold)) return null
  return { tokens, note: pressureNote(tokens) }
}
