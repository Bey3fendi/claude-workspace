// rollback: print the exact steps back to the previous recorded workspace version. It does not run another
// version's code itself: the pins live in that version's lock, so its own `repair` is what restores them.
import { loadManifest } from '../lib/manifest.mjs'
import { rollbackPlan } from '../lib/history.mjs'

export async function rollback(ctx, rep) {
  const plan = rollbackPlan(loadManifest(ctx), { projectRoot: ctx.projectRoot })
  if (!plan.ok) { rep.warn(`rollback: ${plan.message}`); return { ok: false, error: plan.message } }
  rep.info(`rollback: ${plan.message}`)
  for (const [id, s] of Object.entries(plan.previous.plugins ?? {})) rep.info(`  ${id}: ${s ? `${s.version ?? '?'}${s.sha ? ` @ ${s.sha.slice(0, 12)}` : ''}` : 'not installed'}`)
  rep.info('run:')
  for (const s of plan.steps) rep.info(`  ${s}`)
  return { ok: true, plan }
}
