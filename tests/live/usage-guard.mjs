// Usage guard shared by the live runners. `claude -p --output-format stream-json --verbose` emits
// rate_limit_event rows with the account's live utilization per window (0..1). The runners stop
// dispatching new runs once any window reaches the threshold (--max-usage, default 0.9: the user's limit). Runs already
// in flight finish, so the final figure can exceed the threshold by up to (concurrency - 1) runs.

/** Latest utilization per window seen in a run's stream output, e.g. { five_hour: 0.31, seven_day: 0.28 }. */
export function usageFrom(text) {
  let last = null
  for (const line of String(text).split('\n')) {
    if (!line.includes('"rate_limit_event"')) continue
    try { const e = JSON.parse(line); if (e.type === 'rate_limit_event') last = e.rate_limit_info } catch {}
  }
  const w = last?.unifiedWindows
  if (!w) return null
  return Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v?.utilization]).filter(([, v]) => typeof v === 'number'))
}

/** The first window at or over the threshold, or null. */
export function overLimit(usage, max) {
  if (!usage) return null
  const hit = Object.entries(usage).find(([, v]) => v >= max)
  return hit ? `${hit[0]} usage ${Math.round(hit[1] * 100)}% ≥ ${Math.round(max * 100)}%` : null
}

export const fmtUsage = (u) => (u ? Object.entries(u).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ') : 'n/a')
