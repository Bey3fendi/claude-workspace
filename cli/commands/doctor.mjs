// doctor: verifies the workspace from evidence (registry files, CLI JSON, the project's memory files).
// Exit 1 on any FAIL. It never writes anything.
import { detectPlatform, findDuplicates, findRouterConflicts } from '../lib/detect.mjs'
import { claudeVersion, listPlugins, projectInstall } from '../lib/claude.mjs'
import { loadManifest } from '../lib/manifest.mjs'
import { missingDenies } from '../lib/settings.mjs'
import { hasBlock } from '../lib/gitignore.mjs'
import { CLAUDE_MEM_ID, claudeMemInstalls } from '../lib/claude-mem.mjs'
import { FILES as MEMORY_FILES, MEMORY_ALLOWS } from '../../plugins/workspace-core/lib/md-memory.mjs'
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

  // claude-mem: no longer used. Leftovers are reported; two memory systems must not run in one project.
  const cms = claudeMemInstalls(installed)
  if (cms.length) {
    const here = settings?.enabledPlugins?.[CLAUDE_MEM_ID]
    if (here === false) add('claude-mem', 'warn', `still installed (${cms.map((c) => c.scope).join(', ')}), disabled in this project; remove it for all projects with \`claude-workspace remove-claude-mem\` (keeps ~/.claude-mem data)`)
    else add('claude-mem', 'fail', `installed (${cms.map((c) => c.scope).join(', ')}) and active in this project: two memory systems would run (run repair to disable it here, or \`claude-workspace remove-claude-mem\`)`)
  } else add('claude-mem', 'ok', 'not installed (memory is md-memory)')

  for (const w of findRouterConflicts(ctx, installed)) add('router-conflict', 'warn', w)
  return finish(rep, checks)
}

function finish(rep, checks) {
  const failed = checks.filter((c) => c.status === 'fail').length
  rep.info(failed ? `doctor: ${failed} check(s) failed` : 'doctor: all required checks passed')
  return { ok: failed === 0, checks }
}

function safeJson(p) { try { return readJsonFile(p, { missing: null }) } catch { return null } }
