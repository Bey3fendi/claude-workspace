// Subagent model/effort cap. Superpowers dispatches its final whole-branch reviewer "on the most
// capable available model", which resolves to Fable here, and a subagent may ask for xhigh/max effort.
// Every subagent model request is held to at most Opus 5.5 at high effort. The main loop is never
// touched (its model and effort are the user's choice). CW_SUBAGENT_CAP=0 turns the cap off.
export const CAP_MODEL = 'claude-opus-5-5'
export const CAP_EFFORT = 'high'
const ABOVE_MODEL = /fable/i
const ABOVE_EFFORT = new Set(['xhigh', 'max'])

// Returns the rewrite for one request, or null when it is already within the cap.
// A numeric effort is left alone: its scale is not a level this cap can compare.
export function capRequest({ model, effort }) {
  const m = typeof model === 'string' && ABOVE_MODEL.test(model) ? CAP_MODEL : model
  const ef = typeof effort === 'string' && ABOVE_EFFORT.has(effort) ? CAP_EFFORT : effort
  if (m === model && ef === effort) return null
  return { model: m, effort: ef, from: { model, effort: effort ?? null } }
}
