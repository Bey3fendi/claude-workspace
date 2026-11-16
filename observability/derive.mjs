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
    ponytail: ponytailSummary(events),
    hookErrors: hookErrors(events),
  }
}

/** The session's `hook.error` rows (1.0 M1): which workspace-core hook failed, where, and how. */
export function hookErrors(events) {
  return events.filter((e) => e.ev === 'hook.error').map((e) => ({ t: e.t ?? null, hook: e.hook ?? null, part: e.part ?? null, kind: e.kind ?? null, message: e.message ?? '' }))
}

/**
 * Is Ponytail working? From engine events only: its rules injected (by its own hooks), the level it announced, the
 * rule repeated by the workspace, and whether answers that changed code carried its closing line.
 */
export function ponytailSummary(events) {
  const injected = events.filter((e) => e.ev === 'injection' && e.markers?.ponytail).length
  const pt = events.filter((e) => e.ev === 'ponytail')
  if (!injected && !pt.length) return null
  const closing = pt.filter((e) => e.action === 'closing')
  return {
    injected,
    level: pt.filter((e) => e.action === 'level' || e.level).at(-1)?.level ?? null,
    reminded: pt.filter((e) => e.action === 'remind').length,
    closing: { present: closing.filter((e) => e.present).length, total: closing.length },
    asked: pt.filter((e) => e.action === 'close-asked').length,
    tracked: pt.length > 0, // ponytail events exist since 0.16.0
  }
}

/** Plain-text rendering for `claude-workspace usage`. */
export function renderUsage(v) {
  const L = [`session ${v.sid}${v.root ? ` · ${v.root}` : ''}${v.interactive == null ? '' : v.interactive ? ' · interactive' : ' · headless'}`]
  if (v.models.length) L.push(`models: ${v.models.join(', ')}`)
  if (!v.requests.length) L.push('no requests recorded')
  for (const r of v.requests) L.push(`#${r.n} ${r.footer ?? 'no skill activity, no Workspace Usage section'}`)
  if (v.ponytail) {
    const p = v.ponytail
    L.push(`ponytail: rules injected ${p.injected}× by its hooks${p.level ? ` · level ${p.level}` : ''}` +
      (p.reminded ? ` · rule repeated ${p.reminded}×` : '') +
      (p.closing.total ? ` · closing line in ${p.closing.present}/${p.closing.total} answers that changed code` : p.tracked ? ' · no answer changed code yet' : ' · closing line not tracked (recorded before 0.16.0)') +
      (p.asked ? ` · asked for it ${p.asked}×` : ''))
  }
  if (v.ponytailLedger) L.push(`ponytail ledger: ${v.ponytailLedger}`)
  if (v.hookErrors?.length) {
    L.push(`hook errors: ${v.hookErrors.length} (workspace-core failed open: the request went on without that hook)`)
    for (const x of v.hookErrors) L.push(`  ${x.hook}${x.part ? ` (${x.part})` : ''}: ${x.kind}${x.message ? `: ${x.message}` : ''}`)
  }
  L.push(`tokens: in ${v.usage.in}, out ${v.usage.out}, cache read ${v.usage.cacheRead}, cache write ${v.usage.cacheWrite}`)
  return L.join('\n')
}
