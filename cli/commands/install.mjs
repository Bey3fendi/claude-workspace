// install (and repair): idempotent. A second run with nothing to do reports zero changes and
// leaves every project file byte-identical.
import { rmSync } from 'node:fs'
import { preflight, findDuplicates, findRouterConflicts, dirtyTouchedFiles } from '../lib/detect.mjs'
import { listPlugins, marketplaceAdd, marketplaceRemove, marketplaceUpdate, otherProjectsUsing, pluginInstall, pluginUninstall, pluginEnable, pluginUpdate, projectInstall } from '../lib/claude.mjs'
import { pinState, pushHistory, localPluginVersion } from '../lib/history.mjs'
import { loadManifest, newManifest, snapshot, finalize, saveManifest } from '../lib/manifest.mjs'
import { addDenies, removeDenies, addRules } from '../lib/settings.mjs'
import { upsertBlock } from '../lib/gitignore.mjs'
import { OWNED, TARGETS, addImport, importState, removeImport, targetOf, workspaceMd } from '../lib/claude-md.mjs'
import { CLAUDE_MEM_ID, claudeMemInstalls } from '../lib/claude-mem.mjs'
import { FILES as MEMORY_FILES, TEMPLATES as MEMORY_TEMPLATES, MEMORY_ALLOWS } from '../../plugins/workspace-core/lib/md-memory.mjs'
import { EXPLAIN_ALLOWS } from '../../plugins/workspace-core/lib/explain.mjs'
import { readJsonFile, readMaybe, writeAtomic, writeJsonIfChanged, hashFile, UserError } from '../lib/util.mjs'

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
  // CLAUDE.md target: the flag, else what the previous install chose, else CLAUDE.md. Checked before any write:
  // broken markers in the user's file stop the install with nothing changed.
  let prevMarker = null
  try { prevMarker = readJsonFile(ctx.p('.claude/workspace.json'), { missing: null }) } catch {}
  const mdTarget = o.claudeMd !== undefined ? targetOf(o) : prevMarker?.claudeMd ? prevMarker.claudeMd.target ?? null : TARGETS.project
  if (mdTarget) {
    const st = importState(readMaybe(ctx.p(mdTarget))?.toString('utf8') ?? '')
    if (st.state === 'malformed') throw new UserError(`${mdTarget} line ${st.problem.line}: ${st.problem.problem}. Fix or remove the claude-workspace markers there, then re-run (nothing was changed)`)
  }
  // Settings files must parse before anything is written (a refusal leaves no backup behind).
  for (const f of ['.claude/settings.json', '.claude/settings.local.json']) readJsonFile(ctx.p(f))
  const dirty = dirtyTouchedFiles(ctx, mdTarget ? [mdTarget] : []).filter((f) => !(m?.files?.[f] && hashFile(ctx.p(f)) === m.files[f].postHash))
  if (dirty.length && !o.allowDirty) {
    throw new UserError(`uncommitted changes in files the workspace would modify: ${dirty.join(', ')}\n    commit or stash them, or re-run with --allow-dirty (a byte-exact backup is still taken)`)
  }
  m ??= newManifest(ctx)
  snapshot(ctx, m, mdTarget ? [mdTarget] : [])

  // ---- marketplace (Claude Code writes extraKnownMarketplaces itself)
  const name = ctx.marketplaceName
  const source = o.marketplace || m.marketplace.source || ctx.repoRoot
  // Rollback history: capture the installed state BEFORE the marketplace is touched (re-pointing removes the
  // marketplace, which uninstalls its plugins, so a later snapshot would see nothing installed).
  const prevSource = m.marketplace.source
  const before = pinState(ctx, ctx.lock.plugins.filter((p) => p.enabled).map((p) => `${p.name}@${name}`), projectInstall)
  let settings = readJsonFile(ctx.p('.claude/settings.json'))
  const declared = settings.extraKnownMarketplaces?.[name]
  if (!declared) {
    const r = marketplaceAdd(ctx, source)
    if (!r.ok) throw new UserError(`claude plugin marketplace add failed: ${r.message}`)
    rep.change(`marketplace ${name} declared in .claude/settings.json (source: ${source})`)
  } else if (o.marketplace && m.marketplace.source && o.marketplace !== m.marketplace.source) {
    if (!repair) throw new UserError(`marketplace ${name} is already declared from ${m.marketplace.source}; use \`repair --marketplace ${o.marketplace}\` to switch (update/rollback), or uninstall first`)
    // Phase 6 update/rollback: re-point the marketplace at another ref (e.g. owner/repo#v0.8.0); pins below follow this CLI's lock.
    // The marketplace is one per-user registry entry, and removing it uninstalls its plugins in every
    // project. Record the other projects first and reinstall theirs after the re-add.
    const others = otherProjectsUsing(ctx, name)
    const rm = marketplaceRemove(ctx, name)
    if (!rm.ok) throw new UserError(`could not re-point marketplace ${name}: ${rm.message}`)
    const add = marketplaceAdd(ctx, o.marketplace)
    if (!add.ok) throw new UserError(`claude plugin marketplace add ${o.marketplace} failed: ${add.message} (the previous source was ${m.marketplace.source})`)
    rep.change(`marketplace ${name} re-pointed: ${m.marketplace.source} -> ${o.marketplace}`)
    for (const [path, ids] of others) {
      const failed = ids.filter((id) => ctx.pluginIds.includes(id) && !pluginInstall({ ...ctx, projectRoot: path }, id).ok)
      if (failed.length) rep.warn(`${path}: could not reinstall ${failed.join(', ')} after the re-point; run \`claude-workspace repair\` there`)
      else rep.change(`${path}: reinstalled its workspace plugins from the new source (it shares marketplace ${name}); run \`claude-workspace repair\` there to record the new versions`)
    }
  } else if (repair) {
    // Refresh the marketplace catalog from its source so updated entries (new pins, new workspace-core) are seen.
    const u = marketplaceUpdate(ctx, name)
    if (!u.ok) rep.warn(`marketplace ${name} could not be refreshed (${u.message}); continuing with the cached catalog`)
  }
  if (!o.marketplace && source === ctx.repoRoot && !m.marketplace.source)
    rep.warn(`marketplace source is this checkout's absolute path (${source}); for a team-shared .claude/settings.json use --marketplace <owner>/<repo>#<tag>`)
  m.marketplace.source = source

  // ---- plugins, pinned
  for (const p of ctx.lock.plugins.filter((p) => p.enabled)) {
    const id = `${p.name}@${name}`
    const want = typeof p.source === 'object' ? p.source.sha : null
    let rec = projectInstall(ctx, id)
    // Local plugins (workspace-core) have no commit pin: compare versions with this checkout's plugin.json.
    const wantVersion = want ? null : localPluginVersion(ctx, p)
    if (rec && wantVersion && rec.version !== wantVersion) {
      if (!repair) rep.warn(`${id} is installed at ${rec.version} but this workspace ships ${wantVersion}; run \`claude-workspace repair\``)
      else {
        let u = pluginUpdate(ctx, id)
        rec = projectInstall(ctx, id)
        if (!u.ok || rec?.version !== wantVersion) { // fall back to a clean reinstall
          const un = pluginUninstall(ctx, id)
          if (!un.ok) throw new UserError(`could not update ${id}: ${u.message}; uninstall failed: ${un.message}`)
          rec = null
        } else rep.change(`updated ${id} to ${wantVersion}`)
      }
    }
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
  // ---- plugins an earlier version installed but this lock no longer has (e.g. caveman before 0.9.0)
  for (const id of (m.plugins ?? []).filter((x) => !ctx.pluginIds.includes(x))) {
    if (!projectInstall(ctx, id)) continue
    const u = pluginUninstall(ctx, id)
    if (u.ok) rep.change(`uninstalled ${id} (no longer part of the workspace)`)
    else rep.warn(`could not uninstall ${id}, which is no longer part of the workspace: ${u.message}`)
  }
  m.plugins = ctx.pluginIds
  // Phase 6: record what changed so `rollback` can say exactly what to return to.
  const after = pinState(ctx, ctx.pluginIds, projectInstall)
  if (pushHistory(m, { at: new Date().toISOString(), source: prevSource, workspaceVersion: m.workspaceVersion, plugins: before },
    { source, workspaceVersion: ctx.lock.workspaceVersion, plugins: after })) rep.info('recorded the previous versions in the manifest (see `claude-workspace rollback`)')
  m.workspaceVersion = ctx.lock.workspaceVersion

  // ---- skill deny rules (invocation overlap policy)
  settings = readJsonFile(ctx.p('.claude/settings.json'))
  // Rules this workspace added earlier but the current policy no longer has (e.g. the claude-mem rules before 0.8.0).
  const stale = m.addedDenies.filter((r) => !ctx.denies.includes(r))
  if (stale.length) {
    writeJsonIfChanged(ctx.p('.claude/settings.json'), removeDenies(settings, stale))
    rep.change(`removed ${stale.length} permissions.deny rule(s) the policy no longer has`)
    m.addedDenies = m.addedDenies.filter((r) => !stale.includes(r))
    settings = readJsonFile(ctx.p('.claude/settings.json'))
  }
  const { settings: merged, added } = addDenies(settings, ctx.denies)
  if (added.length) {
    writeJsonIfChanged(ctx.p('.claude/settings.json'), merged)
    rep.change(`added ${added.length} permissions.deny skill rule(s)`)
  }
  m.addedDenies = [...new Set([...m.addedDenies, ...added])]

  // ---- md-memory and Explain allow rules: Claude writes .memory/ notes and .explain/ files without a prompt each time. They go in
  // the per-user settings.local.json: Claude Code ignores allow rules in the shared, committed settings.json.
  const allow = addRules(readJsonFile(ctx.p('.claude/settings.local.json')), 'allow', [...MEMORY_ALLOWS, ...EXPLAIN_ALLOWS])
  if (allow.added.length) {
    writeJsonIfChanged(ctx.p('.claude/settings.local.json'), allow.settings)
    rep.change(`added ${allow.added.length} permissions.allow rule(s) for .memory/ and .explain/ to .claude/settings.local.json`)
  }
  m.addedAllows = [...new Set([...(m.addedAllows ?? []), ...allow.added])]

  // ---- Caveman is no longer part of the workspace (0.9.0). The .caveman.json an older install wrote is
  // returned to its pre-install state if nobody edited it since; an edited one is the user's and stays.
  const cavRec = m.files['.caveman.json']
  if (cavRec) {
    const abs = ctx.p('.caveman.json')
    if (hashFile(abs) === cavRec.postHash) {
      if (cavRec.existedBefore) {
        const b = readMaybe(ctx.p(cavRec.backup))
        if (b != null && hashFile(abs) !== cavRec.preHash) { writeAtomic(abs, b); rep.change('restored .caveman.json (Caveman removed from the workspace)') }
      } else if (readMaybe(abs) != null) { rmSync(abs); rep.change('removed .caveman.json (Caveman removed from the workspace)') }
    } else if (readMaybe(abs) != null) rep.info('.caveman.json was edited after install; left in place (Caveman is no longer part of the workspace)')
    delete m.files['.caveman.json']
  }

  // ---- CLAUDE.md: the owned file (always rewritten from the template) and the import block in the target
  let owned
  try { owned = workspaceMd(ctx) } catch (e) { throw new UserError(e.message) }
  if ((readMaybe(ctx.p(OWNED))?.toString('utf8') ?? null) !== owned) { writeAtomic(ctx.p(OWNED), owned); rep.change(`wrote ${OWNED}`) }
  // an import left in the other target by an earlier install with a different --claude-md
  for (const t of Object.values(TARGETS).filter((t) => t !== mdTarget && m.files[t])) {
    const cur = readMaybe(ctx.p(t))?.toString('utf8')
    if (cur != null && importState(cur).state !== 'missing') {
      const t2 = removeImport(cur)
      if (!t2.trim() && !m.files[t].existedBefore) rmSync(ctx.p(t)); else writeAtomic(ctx.p(t), t2)
      rep.change(`removed workspace import from ${t}`)
    }
  }
  if (mdTarget) {
    const cur = readMaybe(ctx.p(mdTarget))?.toString('utf8') ?? null
    const { text, action } = addImport(cur)
    if (action) {
      writeAtomic(ctx.p(mdTarget), text)
      rep.change({ created: `created ${mdTarget} with workspace import`, appended: `added workspace import to ${mdTarget}`,
        restored: `restored workspace import in ${mdTarget}`, deduplicated: `removed duplicate workspace import from ${mdTarget}` }[action])
    }
  } else rep.info('skipped CLAUDE.md (--no-claude-md)')

  // ---- committed workspace marker
  const marker = {
    managedBy: 'claude-workspace',
    workspaceVersion: ctx.lock.workspaceVersion,
    marketplace: name,
    plugins: ctx.pluginIds,
    memory: 'md-memory (.memory/, built into workspace-core)',
    claudeMd: { target: mdTarget, created: mdTarget ? !m.files[mdTarget]?.existedBefore : false },
  }
  if (writeJsonIfChanged(ctx.p('.claude/workspace.json'), marker)) rep.change('wrote .claude/workspace.json')

  // ---- .gitignore managed block
  const gi = readMaybe(ctx.p('.gitignore'))?.toString('utf8') ?? ''
  const gi2 = upsertBlock(gi)
  if (gi2 !== gi) { writeAtomic(ctx.p('.gitignore'), gi2); rep.change('added managed block to .gitignore') }

  // ---- md-memory files (project memory, meant to be committed). Created only when missing, never overwritten.
  m.memoryFiles ??= {}
  for (const [k, rel] of Object.entries(MEMORY_FILES)) {
    if (readMaybe(ctx.p(rel)) != null) continue
    writeAtomic(ctx.p(rel), MEMORY_TEMPLATES[k])
    m.memoryFiles[rel] = { createdHash: hashFile(ctx.p(rel)) }
    rep.change(`wrote ${rel} (template)`)
  }

  // ---- claude-mem is no longer used (0.8.0). While it is still installed for this user, disable it in
  // this project so two memory systems never run together. User level stays untouched (`remove-claude-mem`).
  m.disabledPlugins ??= []
  if (claudeMemInstalls(installed).length) {
    settings = readJsonFile(ctx.p('.claude/settings.json'))
    const cur = settings.enabledPlugins?.[CLAUDE_MEM_ID]
    if (cur === undefined) {
      writeJsonIfChanged(ctx.p('.claude/settings.json'), { ...settings, enabledPlugins: { ...(settings.enabledPlugins ?? {}), [CLAUDE_MEM_ID]: false } })
      if (!m.disabledPlugins.includes(CLAUDE_MEM_ID)) m.disabledPlugins.push(CLAUDE_MEM_ID)
      rep.change(`disabled ${CLAUDE_MEM_ID} in this project (memory is md-memory now; remove it for good with \`claude-workspace remove-claude-mem\`)`)
    } else if (cur === true) {
      rep.warn(`${CLAUDE_MEM_ID} is explicitly enabled in .claude/settings.json: two memory systems will run (left as is)`)
    }
  }

  finalize(ctx, m)
  saveManifest(ctx, m)
  rep.info(rep.changes.length ? `${rep.changes.length} change(s)` : 'already up to date: 0 changes')
  return { ok: true, changeCount: rep.changes.length }
}

