// uninstall: removes exactly what the workspace added. A touched file that nobody edited since
// install is restored byte-for-byte from its backup (or deleted if it did not exist before).
// A file edited since install gets key-level removal of our entries only.
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { pluginUninstall, marketplaceRemove } from '../lib/claude.mjs'
import { loadManifest } from '../lib/manifest.mjs'
import { removeDenies, removeMarketplaceKeys } from '../lib/settings.mjs'
import { removeBlock } from '../lib/gitignore.mjs'
import { uninstallClaudeMem } from '../lib/claude-mem.mjs'
import { confirm } from '../lib/report.mjs'
import { WORKSPACE_DIR } from '../lib/context.mjs'
import { hashFile, readMaybe, readJsonFile, writeAtomic, writeJsonIfChanged, rmrf, removeEmptyDirs, UserError } from '../lib/util.mjs'
import { rmSync } from 'node:fs'

export async function uninstall(ctx, rep) {
  const m = loadManifest(ctx)
  if (!m) throw new UserError(`no workspace manifest in ${ctx.projectRoot} (${WORKSPACE_DIR}/manifest.json); nothing to uninstall`)

  // Decide per file BEFORE Claude Code's own uninstall edits settings.json.
  const untouched = Object.fromEntries(Object.entries(m.files).map(([rel, f]) => [rel, hashFile(ctx.p(rel)) === f.postHash]))

  for (const id of m.plugins) {
    const r = pluginUninstall(ctx, id)
    if (r.ok) rep.change(`uninstalled ${id}`)
    else if (r.result?.failureCode !== 'not_installed') rep.warn(`claude plugin uninstall ${id}: ${r.message}`)
  }
  const mr = marketplaceRemove(ctx, m.marketplace.name)
  if (mr.ok) rep.change(`removed marketplace ${m.marketplace.name} (project scope)`)
  else rep.info(`marketplace ${m.marketplace.name}: ${mr.message}`)

  let exact = true
  for (const [rel, f] of Object.entries(m.files)) {
    const abs = ctx.p(rel)
    if (untouched[rel]) {
      if (f.existedBefore) {
        const b = readMaybe(ctx.p(f.backup))
        if (b == null) throw new UserError(`backup missing for ${rel} (${f.backup}); leaving ${WORKSPACE_DIR} in place`)
        if (hashFile(abs) !== f.preHash) { writeAtomic(abs, b); rep.change(`restored ${rel} (byte-exact)`) }
      } else if (readMaybe(abs) != null) { rmSync(abs); rep.change(`removed ${rel}`) }
      continue
    }
    exact = false
    keyLevel(ctx, rep, rel, f, m)
  }

  if (ctx.opts.removeClaudeMem) {
    const ok = await confirm('Run `claude-mem uninstall`? It is user-level and removes claude-mem for ALL projects.', { yes: ctx.opts.yes, env: ctx.env })
    if (ok) {
      const r = uninstallClaudeMem(ctx)
      const log = join(ctx.stateDir, 'logs', `claude-mem-uninstall-${Date.now()}.log`)
      writeAtomic(log, `exit=${r.code}\n${r.stdout}\n${r.stderr}`, 0o600)
      if (r.code === 0) rep.change(`claude-mem uninstalled (user scope); log ${log}`)
      else rep.fail(`claude-mem uninstall failed (exit ${r.code}); log ${log}`)
    } else rep.warn('claude-mem left installed (confirmation required)')
  } else {
    rep.info(`claude-mem left installed: it is user-level and may serve other projects (remove with --remove-claude-mem)`)
  }

  rmrf(ctx.p(WORKSPACE_DIR))
  if (!m.claudeDirExisted) removeEmptyDirs(ctx.p('.claude'), ctx.projectRoot)
  rep.info(exact ? 'all touched files returned to their pre-install bytes' : 'some files were edited after install: only workspace entries were removed from them')
  return { ok: rep.failures.length === 0, exact }
}

function keyLevel(ctx, rep, rel, f, m) {
  const abs = ctx.p(rel)
  const cur = readMaybe(abs)
  if (cur == null) return
  if (rel === '.claude/settings.json') {
    let s = readJsonFile(abs)
    s = removeMarketplaceKeys(removeDenies(s, m.addedDenies), m.marketplace.name)
    if (!f.existedBefore && !Object.keys(s).length) { rmSync(abs); rep.change(`removed ${rel}`) }
    else if (writeJsonIfChanged(abs, s)) rep.change(`removed workspace keys from ${rel} (file was edited after install; other content kept)`)
  } else if (rel === '.gitignore') {
    const t = removeBlock(cur.toString('utf8'))
    if (!f.existedBefore && !t.trim()) { rmSync(abs); rep.change(`removed ${rel}`) }
    else if (t !== cur.toString('utf8')) { writeAtomic(abs, t); rep.change(`removed managed block from ${rel}`) }
  } else if (rel === '.caveman.json') {
    let v = null
    try { v = JSON.parse(cur.toString('utf8')) } catch {}
    if (!f.existedBefore && isDeepStrictEqual(v, ctx.lock.overlays.caveman.content)) { rmSync(abs); rep.change(`removed ${rel}`) }
    else rep.warn(`${rel} was edited after install; left in place`)
  } else if (rel === '.claude/workspace.json') {
    if (!f.existedBefore) { rmSync(abs); rep.change(`removed ${rel}`) }
  }
}
