// doctor: verifies the workspace from evidence (registry files, CLI JSON, the project's memory files).
// Exit 1 on any FAIL. It never writes anything.
import { detectPlatform, findDuplicates, findRouterConflicts } from '../lib/detect.mjs'
import { claudeVersion, listPlugins, projectInstall } from '../lib/claude.mjs'
import { loadManifest } from '../lib/manifest.mjs'
import { missingDenies } from '../lib/settings.mjs'
import { hasBlock, upsertBlock } from '../lib/gitignore.mjs'
import { OWNED, TARGETS, importState, karpathyPin, lengthLimit, readVendored, workspaceMd } from '../lib/claude-md.mjs'
import { CLAUDE_MEM_ID, claudeMemInstalls } from '../lib/claude-mem.mjs'
import { FILES as MEMORY_FILES, MEMORY_ALLOWS } from '../../plugins/workspace-core/lib/md-memory.mjs'
import { EXPLAIN_ALLOWS } from '../../plugins/workspace-core/lib/explain.mjs'
import { cmpVersion, readJsonFile, readMaybe } from '../lib/util.mjs'

export async function doctor(ctx, rep) {
  const checks = []
  let isInstalled = true // false once the manifest is missing: every "run repair" hint becomes "run install"
  const add = (id, status, message) => {
    if (!isInstalled) message = message.replace(/\(run repair\b/, '(run install')
    checks.push({ id, status, message })
    const line = `${id}: ${message}`
    if (status === 'fail') rep.fail(line); else if (status === 'warn') rep.warn(line); else if (status === 'ok') rep.ok(line); else rep.info(line)
  }

  // platform / toolchain
  const plat = detectPlatform(ctx.env)
  add('platform', plat.ok ? 'ok' : 'fail', plat.ok ? plat.name : plat.message)
  const nodeOk = cmpVersion(process.versions.node, ctx.lock.node.min) >= 0
  add('node', nodeOk ? 'ok' : 'fail', nodeOk ? process.versions.node : `${process.versions.node} (${ctx.lock.node.min}+ required; install and repair refuse to run)`)
  const cv = claudeVersion(ctx)
  if (!cv) { add('claude-code', 'fail', `not runnable (${ctx.claudeBin})`); return finish(rep, checks) }
  add('claude-code', cmpVersion(cv, ctx.lock.claudeCode.min) < 0 ? 'fail' : ctx.lock.claudeCode.tested.includes(cv) ? 'ok' : 'warn',
    `${cv}${ctx.lock.claudeCode.tested.includes(cv) ? '' : ` (tested: ${ctx.lock.claudeCode.tested.join(', ')})`}`)

  const m = loadManifest(ctx)
  isInstalled = !!m
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

  const giText = readMaybe(ctx.p('.gitignore'))?.toString('utf8')
  add('gitignore', !hasBlock(giText) ? 'warn' : upsertBlock(giText) === giText ? 'ok' : 'warn', !hasBlock(giText) ? 'managed block missing (run repair)'
    : upsertBlock(giText) === giText ? 'managed block: .claude/workspace/* (CLAUDE.workspace.md committed), .claude/settings.local.json, .explain/' : 'managed block is from an older version (run repair)')

  // memory: md-memory (built into workspace-core); its files live in the project
  const memMissing = Object.values(MEMORY_FILES).filter((rel) => readMaybe(ctx.p(rel)) == null)
  const sessionLines = (readMaybe(ctx.p(MEMORY_FILES.session))?.toString('utf8') ?? '').split('\n').length - 1
  add('memory', memMissing.length ? 'fail' : 'ok', memMissing.length
    ? `missing ${memMissing.join(', ')} (run repair)`
    : `md-memory: .memory/ (session.md ${sessionLines} line(s))${ctx.env.CW_MEMORY === '0' ? '; CW_MEMORY=0 turns it off in this shell' : ''}`)
  const local = safeJson(ctx.p('.claude/settings.local.json'))
  const allowMiss = MEMORY_ALLOWS.filter((r) => !(local?.permissions?.allow ?? []).includes(r))
  add('memory-allow-rules', allowMiss.length ? 'warn' : 'ok', allowMiss.length
    ? `${allowMiss.join(', ')} missing: Claude will ask before each memory write (run repair)`
    : `${MEMORY_ALLOWS.length} present`)
  const explainMiss = EXPLAIN_ALLOWS.filter((r) => !(local?.permissions?.allow ?? []).includes(r))
  add('explain', explainMiss.length ? 'warn' : 'ok', explainMiss.length
    ? `${explainMiss.join(', ')} missing: Claude will ask before writing each /explain file (run repair)`
    : `/explain ready (local files in .explain/)${ctx.env.CW_EXPLAIN === '0' ? '; CW_EXPLAIN=0 turns it off in this shell' : ''}`)

  // CLAUDE.md integration: the owned file, the import block in the target, its size, the vendored pin
  const pin = karpathyPin(ctx.lock)
  if (pin) {
    let v = null
    try { v = readVendored(ctx.repoRoot, pin) } catch (e) { add('karpathy-vendored', 'fail', `${pin.file}: ${e.message}`) }
    if (v) add('karpathy-vendored', v.ok ? 'ok' : 'fail', v.ok ? `${pin.file} matches the lock (${pin.commit.slice(0, 12)})` : `${pin.file} sha256 ${v.actual.slice(0, 12)}… differs from the lock`)
  }
  if (m) {
    const ownedNow = readMaybe(ctx.p(OWNED))?.toString('utf8') ?? null
    const marker = safeJson(ctx.p('.claude/workspace.json'))
    let want = null
    try { want = workspaceMd(ctx, { responseStyle: marker?.claudeMd?.responseStyle !== false }) } catch {}
    add('claude-md-file', ownedNow == null ? 'fail' : ownedNow === want ? 'ok' : 'warn', ownedNow == null ? `${OWNED} missing (run repair)`
      : ownedNow === want ? `${OWNED} matches the template` : `drift: ${OWNED.split('/').pop()} differs from template (run repair)`)
    if (ownedNow != null) {
      const n = ownedNow.split('\n').length - 1, limit = lengthLimit({ karpathy: !!pin })
      add('claude-md-length', n > limit ? 'warn' : 'ok', `${n} line(s) loaded every session${n > limit ? ` (over ${limit})` : ''}`)
    }
    const target = marker?.claudeMd ? marker.claudeMd.target : TARGETS.project
    if (!target) add('claude-md-import', 'warn', `skipped (--no-claude-md): add @${OWNED} to your CLAUDE.md yourself`)
    else {
      const st = importState(readMaybe(ctx.p(target))?.toString('utf8') ?? '')
      const msg = { ok: `${target} imports ${OWNED}`, missing: `missing in ${target} (run repair)`, duplicate: `duplicate blocks in ${target} (run repair)`,
        edited: `import line in ${target} was edited (run repair)`, malformed: `malformed markers in ${target} at line ${st.problem?.line} (fix them by hand)` }[st.state]
      add('claude-md-import', st.state === 'ok' ? 'ok' : st.state === 'malformed' ? 'fail' : 'warn', msg)
    }
  }

  // claude-mem: no longer used. Leftovers are reported; two memory systems must not run in one project.
  const cms = claudeMemInstalls(installed)
  if (cms.length) {
    const here = settings?.enabledPlugins?.[CLAUDE_MEM_ID]
    if (here === false) add('claude-mem', 'warn', `still installed (${cms.map((c) => c.scope).join(', ')}), disabled in this project; remove it for all projects with \`claude-workspace remove-claude-mem\` (keeps ~/.claude-mem data)`)
    else add('claude-mem', 'fail', `installed (${cms.map((c) => c.scope).join(', ')}) and active in this project: two memory systems would run (run repair to disable it here, or \`claude-workspace remove-claude-mem\`)`)
  } else add('claude-mem', 'ok', 'not installed (memory is md-memory)')

  for (const w of findRouterConflicts(ctx, installed)) add('router-conflict', 'warn', w)
  return finish(rep, checks, !m)
}

function finish(rep, checks, notInstalled = false) {
  const failed = checks.filter((c) => c.status === 'fail').length
  rep.info(notInstalled ? `doctor: ${failed} check(s) failed: the workspace is not installed here; run \`claude-workspace install\` (most of these follow from that)`
    : failed ? `doctor: ${failed} check(s) failed` : 'doctor: all required checks passed')
  return { ok: failed === 0, checks }
}

function safeJson(p) { try { return readJsonFile(p, { missing: null }) } catch { return null } }
