// install (and repair): idempotent. A second run with nothing to do reports zero changes and
// leaves every project file byte-identical.
import { preflight, findDuplicates, findRouterConflicts, dirtyTouchedFiles } from '../lib/detect.mjs'
import { listPlugins, marketplaceAdd, pluginInstall, pluginUninstall, pluginEnable, projectInstall } from '../lib/claude.mjs'
import { loadManifest, newManifest, snapshot, finalize, saveManifest } from '../lib/manifest.mjs'
import { addDenies } from '../lib/settings.mjs'
import { upsertBlock } from '../lib/gitignore.mjs'
import { installClaudeMem, enforceTelemetry, findOnPath } from '../lib/claude-mem.mjs'
import { confirm } from '../lib/report.mjs'
import { readJsonFile, readMaybe, writeAtomic, writeJsonIfChanged, hashFile, toJson, UserError } from '../lib/util.mjs'
import { join } from 'node:path'
import { run } from '../lib/run.mjs'

export async function install(ctx, rep, { repair = false } = {}) {
  const o = ctx.opts
  const pre = preflight(ctx)
  rep.info(`platform ${pre.platform}, Node ${process.versions.node}, Claude Code ${pre.claudeVersion}${pre.tested ? '' : ' (not in the tested list; continuing)'}`)
  rep.info(`project ${ctx.projectRoot}`)

  const installed = listPlugins(ctx)
  const dups = findDuplicates(ctx, installed)
  if (dups.length) {
    throw new UserError('duplicate plugins would load twice in this project:\n' + dups.map((d) =>
      `    ${d.id} (${d.scope}${d.enabled ? '' : ', disabled'}) -> remove it: claude plugin uninstall ${d.id} --scope ${d.scope}`).join('\n'))
  }
  for (const w of findRouterConflicts(ctx, installed)) rep.warn(w)

  let m = loadManifest(ctx)
  const dirty = dirtyTouchedFiles(ctx).filter((f) => !(m?.files?.[f] && hashFile(ctx.p(f)) === m.files[f].postHash))
  if (dirty.length && !o.allowDirty) {
    throw new UserError(`uncommitted changes in files the workspace would modify: ${dirty.join(', ')}\n    commit or stash them, or re-run with --allow-dirty (a byte-exact backup is still taken)`)
  }
  m ??= newManifest(ctx)
  snapshot(ctx, m)

  // ---- marketplace (Claude Code writes extraKnownMarketplaces itself)
  const name = ctx.marketplaceName
  const source = o.marketplace || m.marketplace.source || ctx.repoRoot
  let settings = readJsonFile(ctx.p('.claude/settings.json'))
  const declared = settings.extraKnownMarketplaces?.[name]
  if (!declared) {
    const r = marketplaceAdd(ctx, source)
    if (!r.ok) throw new UserError(`claude plugin marketplace add failed: ${r.message}`)
    rep.change(`marketplace ${name} declared in .claude/settings.json (source: ${source})`)
  } else if (o.marketplace && m.marketplace.source && o.marketplace !== m.marketplace.source) {
    throw new UserError(`marketplace ${name} is already declared from ${m.marketplace.source}; run uninstall first to switch sources`)
  }
  if (!o.marketplace && source === ctx.repoRoot && !m.marketplace.source)
    rep.warn(`marketplace source is this checkout's absolute path (${source}); for a team-shared .claude/settings.json use --marketplace <owner>/<repo>#<tag>`)
  m.marketplace.source = source

  // ---- plugins, pinned
  for (const p of ctx.lock.plugins.filter((p) => p.enabled)) {
    const id = `${p.name}@${name}`
    const want = typeof p.source === 'object' ? p.source.sha : null
    let rec = projectInstall(ctx, id)
    if (rec && want && rec.gitCommitSha !== want) {
      if (!repair) { rep.warn(`${id} is installed at ${rec.gitCommitSha?.slice(0, 12) ?? 'unknown'} but the lock pins ${want.slice(0, 12)}; run \`claude-workspace repair\``); continue }
      const u = pluginUninstall(ctx, id)
      if (!u.ok) throw new UserError(`could not remove mismatched ${id}: ${u.message}`)
      rep.change(`removed ${id} (pin mismatch)`)
      rec = null
    }
    if (!rec) {
      const r = pluginInstall(ctx, id)
      if (!r.ok) throw new UserError(`claude plugin install ${id} failed: ${r.message}`)
      rec = projectInstall(ctx, id)
      if (!rec) throw new UserError(`${id} did not appear in Claude Code's plugin registry after install`)
      if (want && rec.gitCommitSha !== want) throw new UserError(`${id} installed at ${rec.gitCommitSha} but the lock pins ${want}; refusing to continue`)
      rep.change(`installed ${id}${want ? ` @ ${want.slice(0, 12)}` : ''} (project scope)`)
    }
    settings = readJsonFile(ctx.p('.claude/settings.json'))
    if (settings.enabledPlugins?.[id] !== true) {
      const r = pluginEnable(ctx, id)
      if (!r.ok) throw new UserError(`claude plugin enable ${id} failed: ${r.message}`)
      rep.change(`enabled ${id}`)
    }
  }
  m.plugins = ctx.pluginIds

  // ---- skill deny rules (invocation overlap policy)
  settings = readJsonFile(ctx.p('.claude/settings.json'))
  const { settings: merged, added } = addDenies(settings, ctx.denies)
  if (added.length) {
    writeJsonIfChanged(ctx.p('.claude/settings.json'), merged)
    rep.change(`added ${added.length} permissions.deny skill rule(s)`)
  }
  m.addedDenies = [...new Set([...m.addedDenies, ...added])]

  // ---- Caveman lite (never overwrite a user's own choice)
  const cavemanWant = ctx.lock.overlays.caveman.content
  const cav = readJsonFile(ctx.p('.caveman.json'), { missing: null })
  if (cav == null) {
    writeAtomic(ctx.p('.caveman.json'), toJson(cavemanWant))
    rep.change('wrote .caveman.json (defaultMode: lite)')
  } else if (cav.defaultMode !== cavemanWant.defaultMode) {
    rep.warn(`.caveman.json already sets defaultMode=${JSON.stringify(cav.defaultMode)}; left unchanged (workspace default is lite)`)
  }

  // ---- committed workspace marker
  const marker = {
    managedBy: 'claude-workspace',
    workspaceVersion: ctx.lock.workspaceVersion,
    marketplace: name,
    plugins: ctx.pluginIds,
    claudeMem: `${ctx.lock.claudeMem.npmPackage}@${ctx.lock.claudeMem.version} (user scope, telemetry OFF)`,
  }
  if (writeJsonIfChanged(ctx.p('.claude/workspace.json'), marker)) rep.change('wrote .claude/workspace.json')

  // ---- .gitignore managed block
  const gi = readMaybe(ctx.p('.gitignore'))?.toString('utf8') ?? ''
  const gi2 = upsertBlock(gi)
  if (gi2 !== gi) { writeAtomic(ctx.p('.gitignore'), gi2); rep.change('added managed block to .gitignore') }

  // ---- claude-mem (user scope, consented)
  let telemetryOk = true
  if (o.claudeMem === false) {
    rep.warn('claude-mem skipped (--no-claude-mem); memory is a mandatory capability, doctor will report it')
    if (!m.claudeMem.installedByWorkspace) m.claudeMem.skipped = true
  } else {
    const cmId = ctx.lock.claudeMem.pluginId
    let cm = installed.find((e) => e.id === cmId)
    if (!cm) {
      const ok = await confirm(disclosure(ctx), { yes: o.yes, env: ctx.env })
      if (!ok) {
        rep.warn(`claude-mem not installed: consent required (re-run with --yes, or interactively). Disclosure:\n${indent(disclosure(ctx))}`)
        m.claudeMem.skipped = true
      } else {
        rep.step(`running pinned claude-mem installer (npx ${ctx.lock.claudeMem.npmPackage}@${ctx.lock.claudeMem.version}); output is captured, not shown`)
        const r = installClaudeMem(ctx)
        if (!r.ok) throw new UserError(`claude-mem installer failed (exit ${r.code}); full output: ${r.logFile}`)
        rep.change(`claude-mem ${r.version ?? ctx.lock.claudeMem.version} installed (user scope); installer log ${r.logFile}${r.agentLines ? `; ${r.agentLines} agent-directed line(s) in upstream output were suppressed` : ''}`)
        m.claudeMem = { installedByWorkspace: true, skipped: false, version: r.version ?? ctx.lock.claudeMem.version }
        cm = true
      }
    } else {
      m.claudeMem.skipped = false
      if (cm.version !== ctx.lock.claudeMem.version) rep.warn(`claude-mem ${cm.version} is installed; workspace pins ${ctx.lock.claudeMem.version} (left as is)`)
      if (repair) repairClaudeMemRuntime(ctx, rep)
    }
    if (cm) {
      const t = enforceTelemetry(ctx, { fix: true })
      for (const a of t.actions) rep.change(`claude-mem telemetry: ${a}`)
      if (t.ok) rep.ok(`claude-mem telemetry ${t.message}`)
      else { rep.fail(`claude-mem telemetry OFF not guaranteed: ${t.message}`); telemetryOk = false }
    }
  }

  finalize(ctx, m)
  saveManifest(ctx, m)
  rep.info(rep.changes.length ? `${rep.changes.length} change(s)` : 'already up to date: 0 changes')
  return { ok: telemetryOk, changeCount: rep.changes.length }
}

function repairClaudeMemRuntime(ctx, rep) {
  const launcher = findOnPath(ctx, 'claude-mem', [join(ctx.home, '.local', 'bin')])
  const bun = findOnPath(ctx, 'bun', [join(ctx.home, '.bun', 'bin')])
  if (launcher && bun) return
  const r = run(ctx.npxBin, ['-y', `${ctx.lock.claudeMem.npmPackage}@${ctx.lock.claudeMem.version}`, 'repair'], { cwd: ctx.home, env: ctx.env, timeoutMs: 900_000 })
  const log = join(ctx.stateDir, 'logs', `claude-mem-repair-${Date.now()}.log`)
  writeAtomic(log, `exit=${r.code}\n${r.stdout}\n${r.stderr}`, 0o600)
  if (r.code !== 0) rep.fail(`claude-mem repair failed (exit ${r.code}); log ${log}`)
  else rep.change(`claude-mem runtime repaired (launcher/Bun were missing); log ${log}`)
}

export function disclosure(ctx) {
  const v = `${ctx.lock.claudeMem.npmPackage}@${ctx.lock.claudeMem.version}`
  return [
    `Install claude-mem with its official pinned installer (npx ${v})? This is USER-LEVEL, not project-local:`,
    `  - enables ${ctx.lock.claudeMem.pluginId} in ~/.claude/settings.json and registers its marketplace`,
    '  - puts the claude-mem launcher in ~/.local/bin; installs Bun (adds a PATH line to ~/.bashrc) and uv',
    '  - its worker listens on 127.0.0.1 only; cloud sync stays off (provider: claude)',
    '  - telemetry is then turned OFF with `claude-mem telemetry disable` (a user-level setting: it applies to every project using claude-mem)',
  ].join('\n')
}

const indent = (s) => s.split('\n').map((l) => `    ${l}`).join('\n')
