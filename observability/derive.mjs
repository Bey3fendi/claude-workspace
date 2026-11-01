// Per-session usage evidence from recorded engine events (no transcript, no model self-reports
// except the parsed "Workspace Usage" claims, which are always labeled self-reported).
import { replay } from '../plugins/workspace-core/lib/usage.mjs'

export function usageForSession({ sid, projectKey = null, events }) {
  const start = events.find((e) => e.ev === 'session.start')
  const end = events.findLast((e) => e.ev === 'session.end')
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
  for (const e of events) if (e.ev === 'turn.complete' && e.usage) for (const k of Object.keys(usage)) usage[k] += e.usage[k] ?? 0
  const steps = events.filter((e) => e.ev === 'turn.step' && e.agentId == null)
  return {
    sid, projectKey,
    root: start?.root ?? start?.cwd ?? null,
    interactive: start?.interactive ?? null,
    startedAt: events[0]?.t ?? null,
    endReason: end?.reason ?? null,
    models: [...new Set(steps.map((s) => s.model))],
    requests: replay(events).map(({ footer, ...r }) => ({ ...r, footer })),
    usage,
  }
}

/** Plain-text rendering for `claude-workspace usage`. */
export function renderUsage(v) {
  const L = [`session ${v.sid}${v.root ? ` · ${v.root}` : ''}${v.interactive == null ? '' : v.interactive ? ' · interactive' : ' · headless'}`]
  if (v.models.length) L.push(`models: ${v.models.join(', ')}`)
  if (!v.requests.length) L.push('no requests recorded')
  for (const r of v.requests) L.push(`#${r.n} ${r.footer ?? 'no skill activity, no Workspace Usage section'}`)
  L.push(`tokens: in ${v.usage.in}, out ${v.usage.out}, cache read ${v.usage.cacheRead}, cache write ${v.usage.cacheWrite}`)
  return L.join('\n')
}
