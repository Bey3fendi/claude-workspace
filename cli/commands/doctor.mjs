// doctor: verifies the workspace from evidence (registry files, CLI JSON, claude-mem's own
// status command, a loopback health probe). Exit 1 on any FAIL. The one write it performs is
// mandated by policy: if claude-mem telemetry is ENABLED or undecided it runs `telemetry disable`.
import { join } from 'node:path'
import { detectPlatform, findDuplicates, findRouterConflicts } from '../lib/detect.mjs'
import { claudeVersion, listPlugins, projectInstall } from '../lib/claude.mjs'
import { loadManifest } from '../lib/manifest.mjs'
import { missingDenies } from '../lib/settings.mjs'
import { hasBlock } from '../lib/gitignore.mjs'
import { enforceTelemetry, findOnPath, workerHealth } from '../lib/claude-mem.mjs'
import { cmpVersion, readJsonFile, readMaybe } from '../lib/util.mjs'

export async function doctor(ctx, rep) {
  const checks = []
  const add = (id, status, message) => {
    checks.push({ id, status, message })
    const line = `${id}: ${message}`
    if (status === 'fail') rep.fail(line); else if (status === 'warn') rep.warn(line); else if (status === 'ok') rep.ok(line); else rep.info(line)
  }

  // platform / toolchain
  const plat = detectPlatform(ctx.env)
  add('platform', plat.ok ? 'ok' : 'fail', plat.ok ? plat.name : plat.message)
  add('node', cmpVersion(process.versions.node, ctx.lock.node.min) >= 0 ? 'ok' : 'fail', process.versions.node)
  const cv = claudeVersion(ctx)
  if (!cv) { add('claude-code', 'fail', `not runnable (${ctx.claudeBin})`); return finish(rep, checks) }
  add('claude-code', cmpVersion(cv, ctx.lock.claudeCode.min) < 0 ? 'fail' : ctx.lock.claudeCode.tested.includes(cv) ? 'ok' : 'warn',
    `${cv}${ctx.lock.claudeCode.tested.includes(cv) ? '' : ` (tested: ${ctx.lock.claudeCode.tested.join(', ')})`}`)

  const m = loadManifest(ctx)
  add('manifest', m ? 'ok' : 'fail', m ? `installed ${m.installedAt} (v${m.workspaceVersion})` : 'workspace is not installed in this project (run `claude-workspace install`)')

  // marketplace + pinned plugins
  const settings = safeJson(ctx.p('.claude/settings.json'))
  const name = ctx.marketplaceName
  const decl = settings?.extraKnownMarketplaces?.[name]
  add('marketplace', decl ? 'ok' : 'fail', decl ? `${name} declared (${JSON.stringify(decl.source)})` : `${name} not declared in .claude/settings.json`)
  for (const p of ctx.lock.plugins) {
    const id = `${p.name}@${name}`
    const rec = projectInstall(ctx, id)
    const want = typeof p.source === 'object' ? p.source.sha : null
    if (!p.enabled) { add(`plugin ${id}`, 'info', rec ? 'installed (optional)' : 'optional, not enabled'); continue }
    if (!rec) { add(`plugin ${id}`, 'fail', 'not installed for this project'); continue }
    if (want && rec.gitCommitSha !== want) { add(`plugin ${id}`, 'fail', `pin mismatch: ${rec.gitCommitSha ?? 'unknown'} != ${want} (run repair)`); continue }
    if (settings?.enabledPlugins?.[id] !== true) { add(`plugin ${id}`, 'fail', 'installed but not enabled in .claude/settings.json'); continue }
    add(`plugin ${id}`, 'ok', want ? `pinned @ ${want.slice(0, 12)}` : `local (${rec.version ?? 'unversioned'})`)
  }

  let installed = []
  try { installed = listPlugins(ctx) } catch (e) { add('plugin-list', 'warn', e.message) }
  const dups = findDuplicates(ctx, installed)
  add('duplicates', dups.length ? 'fail' : 'ok', dups.length ? dups.map((d) => `${d.id} (${d.scope})`).join(', ') + ' also load here' : 'none')

  const miss = settings ? missingDenies(settings, ctx.denies) : ctx.denies
  add('skill-deny-rules', miss.length ? 'warn' : 'ok', miss.length ? `${miss.length} rule(s) missing (run repair)` : `${ctx.denies.length} present`)

  const cav = safeJson(ctx.p('.caveman.json'))
  add('caveman-mode', cav?.defaultMode === 'lite' ? 'ok' : 'warn', cav ? `defaultMode=${cav.defaultMode}` : '.caveman.json missing')
  add('gitignore', hasBlock(readMaybe(ctx.p('.gitignore'))?.toString('utf8')) ? 'ok' : 'warn', 'managed block for .claude/workspace/')

  // claude-mem
  const cm = installed.find((e) => e.id === ctx.lock.claudeMem.pluginId)
  if (!cm) {
    add('claude-mem', m?.claudeMem?.skipped ? 'warn' : 'fail', 'not installed (memory is a mandatory capability; run install --yes)')
  } else {
    add('claude-mem', cm.version === ctx.lock.claudeMem.version ? 'ok' : 'warn',
      cm.version === ctx.lock.claudeMem.version ? `${cm.version} (${cm.scope})` : `${cm.version} installed, lock pins ${ctx.lock.claudeMem.version}`)
    const km = safeJson(join(ctx.configDir, 'plugins', 'known_marketplaces.json'))
    const cmMkt = ctx.lock.claudeMem.pluginId.split('@')[1]
    if (km?.[cmMkt]?.autoUpdate) add('claude-mem-autoupdate', 'warn', `marketplace ${cmMkt} has auto-update on (set by its installer): claude-mem can move past the pin; doctor re-verifies telemetry each run`)
    const launcher = findOnPath(ctx, 'claude-mem', [join(ctx.home, '.local', 'bin')])
    add('claude-mem-launcher', launcher ? 'ok' : 'fail', launcher ?? 'claude-mem launcher not found (hooks fail silently without it; run repair)')
    const bun = findOnPath(ctx, 'bun', [join(ctx.home, '.bun', 'bin')])
    add('claude-mem-bun', bun ? 'ok' : 'fail', bun ?? 'Bun not found (run repair)')
    const h = await workerHealth(ctx)
    add('claude-mem-worker', h.up ? 'ok' : 'info', h.up ? `127.0.0.1:${h.port} healthy (v${h.version})` : `not running on 127.0.0.1:${h.port} (starts with a session)`)
  }

  // telemetry gate: applies whenever claude-mem is present on this machine
  if (cm || readMaybe(join(ctx.home, '.claude-mem', 'telemetry.json'))) {
    const t = enforceTelemetry(ctx, { fix: !ctx.opts.noFix })
    for (const a of t.actions) rep.change(`claude-mem telemetry: ${a}`)
    add('claude-mem-telemetry', t.ok ? 'ok' : 'fail', t.ok ? t.message : `OFF cannot be guaranteed: ${t.message}`)
  } else {
    add('claude-mem-telemetry', 'info', 'claude-mem not present; nothing to enforce')
  }

  for (const w of findRouterConflicts(ctx, installed)) add('router-conflict', 'warn', w)
  return finish(rep, checks)
}

function finish(rep, checks) {
  const failed = checks.filter((c) => c.status === 'fail').length
  rep.info(failed ? `doctor: ${failed} check(s) failed` : 'doctor: all required checks passed')
  return { ok: failed === 0, checks }
}

function safeJson(p) { try { return readJsonFile(p, { missing: null }) } catch { return null } }
