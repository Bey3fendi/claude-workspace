// `claude-workspace usage [--session <id>]`: per-request Workspace Usage evidence for a session of
// this project, from the mod's local JSONL. On demand only; no server, no model calls.
import { join } from 'node:path'
import { createReader } from '../../observability/reader.mjs'
import { usageForSession, renderUsage } from '../../observability/derive.mjs'
import { projectKey } from '../../plugins/workspace-core/lib/events.mjs'
import { UserError } from '../lib/util.mjs'

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
  if (!ctx.opts.json) out.write(renderUsage(view) + '\n')
  return { ok: true, session: view }
}
