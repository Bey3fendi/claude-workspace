import { join } from 'node:path'
import { createDashboard, DEFAULT_PORT } from '../../observability/server.mjs'
import { workerHealth } from '../lib/claude-mem.mjs'
import { UserError } from '../lib/util.mjs'

export const eventsDirOf = (ctx) => ctx.env.CW_EVENTS_DIR || join(ctx.stateDir, 'events')

export async function dashboard(ctx, rep) {
  const port = ctx.opts.port != null ? Number(ctx.opts.port) : DEFAULT_PORT
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UserError(`invalid --port ${ctx.opts.port}`)
  if (port >= 37700 && port <= 37799) throw new UserError('ports 37700-37799 are reserved for the claude-mem worker')
  const d = createDashboard({ eventsDir: eventsDirOf(ctx), configDir: ctx.configDir, health: async () => ({ claudeMem: await workerHealth(ctx) }) })
  let h
  try { h = await d.listen(port) } catch (e) {
    if (e.code === 'EADDRINUSE') throw new UserError(`port ${port} is in use; pick another with --port`)
    throw e
  }
  rep.ok(`dashboard on ${h.url} (127.0.0.1 only, read-only). Ctrl-C to stop.`)
  rep.info(`events: ${eventsDirOf(ctx)}`)
  await new Promise((resolve) => { process.once('SIGINT', resolve); process.once('SIGTERM', resolve) })
  await h.close()
  return { ok: true }
}
