// `claude-workspace usage [--session <id>]`: per-request Workspace Usage evidence for a session of
// this project, from the mod's local JSONL. On demand only; no server, no model calls.
import { basename, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createReader } from '../../observability/reader.mjs'
import { usageForSession, renderUsage } from '../../observability/derive.mjs'
import { projectKey } from '../../plugins/workspace-core/lib/events.mjs'
import { UserError } from '../lib/util.mjs'

/**
 * Ponytail's own task ledger (its band writes one CSV row per task, under ~/.config/ponytail/band/<project>.csv):
 * this session's rows, read-only. null when there is none.
 */
export function ponytailLedger(ctx, root, sid) {
  const f = join(ctx.env.XDG_CONFIG_HOME || join(ctx.home, '.config'), 'ponytail', 'band', `${basename(String(root)).replace(/[^\w.-]/g, '_')}.csv`)
  if (!existsSync(f)) return null
  const [head, ...rows] = readFileSync(f, 'utf8').trim().split('\n')
  const cols = head.split(',')
  const at = (r, k) => r[cols.indexOf(k)] ?? ''
  const mine = rows.map((l) => l.match(/("[^"]*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, ''))).filter((r) => at(r, 'key').split('-')[0] === String(sid).slice(0, 8)) // Ponytail keys rows by the session id's first 8 characters
  if (!mine.length) return null
  return mine.map((r) => `${at(r, 'turns')} turns, reuse ${at(r, 'reuse_pct') || '-'}%, ${at(r, 'reused') || 0} reused, ${at(r, 'new') || 0} new, tests ${at(r, 'tests') || '-'} (level ${at(r, 'level')})`).join('; ')
}

export const eventsDirOf = (ctx) => ctx.env.CW_EVENTS_DIR || join(ctx.stateDir, 'events')

export async function usage(ctx, rep, out = process.stdout) {
  const key = projectKey(ctx.projectRoot)
  const all = [...createReader(eventsDirOf(ctx)).sessions().values()]
  const mine = all.filter((s) => s.projectKey === key)
  let s
  if (ctx.opts.session) {
    s = all.find((x) => x.sid === ctx.opts.session || x.sid.startsWith(ctx.opts.session))
    if (!s) throw new UserError(`no recorded session ${ctx.opts.session}`)
  } else {
    s = mine.sort((a, b) => b.lastMtime - a.lastMtime)[0]
    if (!s) throw new UserError(`no recorded sessions for ${ctx.projectRoot} (events: ${eventsDirOf(ctx)})`)
  }
  const view = usageForSession({ sid: s.sid, projectKey: s.projectKey, events: s.events })
  view.ponytailLedger = ponytailLedger(ctx, view.root ?? ctx.projectRoot, s.sid)
  if (!ctx.opts.json) out.write(renderUsage(view) + '\n')
  return { ok: true, session: view }
}
