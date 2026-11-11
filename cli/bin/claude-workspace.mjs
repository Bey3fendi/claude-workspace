#!/usr/bin/env node
import { createContext } from '../lib/context.mjs'
import { Reporter } from '../lib/report.mjs'
import { UserError } from '../lib/util.mjs'
import { install } from '../commands/install.mjs'
import { doctor } from '../commands/doctor.mjs'
import { uninstall } from '../commands/uninstall.mjs'
import { usage } from '../commands/usage.mjs'
import { canary } from '../commands/canary.mjs'
import { rollback } from '../commands/rollback.mjs'
import { removeClaudeMem } from '../commands/remove-claude-mem.mjs'

const HELP = `claude-workspace <command> [options]

Commands
  install     Install the pinned workspace into a project (idempotent)
  doctor      Verify the installation from evidence (never writes)
  repair      Re-apply everything install does; refreshes the marketplace, updates workspace-core,
              fixes pin mismatches and missing memory files (with --marketplace: re-point = update/rollback)
  uninstall   Remove what the workspace added; untouched files are restored byte-for-byte
  usage       Show the engine-verified Workspace Usage evidence for the last session (or --session)
  canary      Read-only: compare pinned upstream versions with the latest releases (network)
  rollback    Show the exact steps back to the previous recorded workspace version
  remove-claude-mem  Remove the old claude-mem memory for this user (asks first; keeps ~/.claude-mem)

Options
  --project <dir>        Project directory (default: current directory)
  --marketplace <src>    Marketplace source: owner/repo#tag, git/https URL or path (default: this checkout)
  --yes, -y              Answer yes to confirmations (remove-claude-mem)
  --allow-dirty          Proceed although touched files have uncommitted changes (backups are still taken)
  --claude-md=local      Put the CLAUDE.md import in CLAUDE.local.md (not committed) instead of CLAUDE.md
  --no-claude-md         Do not touch CLAUDE.md (the workspace file is still written; import it yourself)
  --session <id>         usage: session id (or a prefix) instead of the latest
  --json                 Print one JSON result document
  --version, --help
`

function mdTarget(v) {
  if (!['project', 'local'].includes(v)) throw new UserError(`--claude-md must be project or local (got ${v})`)
  return v
}

export function parseArgs(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--claude-md=')) { o.claudeMd = mdTarget(a.slice('--claude-md='.length)); continue }
    const val = () => { const v = argv[++i]; if (v == null || v.startsWith('--')) throw new UserError(`${a} needs a value`); return v }
    switch (a) {
      case '--project': o.project = val(); break
      case '--marketplace': o.marketplace = val(); break
      case '--yes': case '-y': o.yes = true; break
      // --no-claude-mem, --remove-claude-mem, --no-fix: accepted and ignored since 0.8.0 (claude-mem is gone), so older scripts keep working
      case '--no-claude-mem': o.claudeMem = false; break
      case '--allow-dirty': o.allowDirty = true; break
      case '--no-claude-md': o.claudeMd = false; break
      case '--claude-md': o.claudeMd = mdTarget(val()); break
      case '--remove-claude-mem': o.removeClaudeMem = true; break
      case '--no-fix': o.noFix = true; break
      case '--session': o.session = val(); break
      case '--json': o.json = true; break
      case '--help': case '-h': o.help = true; break
      case '--version': case '-v': o.version = true; break
      default:
        if (a.startsWith('-')) throw new UserError(`unknown option ${a}`)
        o._.push(a)
    }
  }
  return o
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let o
  try { o = parseArgs(argv) } catch (e) { process.stderr.write(`error: ${e.message}\n`); return 2 }
  if (o.help || !o._[0]) { process.stdout.write(HELP); return o.help ? 0 : 2 }
  if (o.version) { const { loadLock } = await import('../lib/context.mjs'); process.stdout.write(loadLock().workspaceVersion + '\n'); return 0 }
  const cmd = o._[0]
  const rep = new Reporter({ json: o.json })
  let result
  try {
    const ctx = createContext(o, env)
    if (cmd === 'install' || cmd === 'repair') {
      result = await install(ctx, rep, { repair: cmd === 'repair' })
      rep.step('doctor')
      const d = await doctor(ctx, rep)
      result = { ...result, ok: result.ok && d.ok, doctor: d.checks }
    } else if (cmd === 'doctor') result = await doctor(ctx, rep)
    else if (cmd === 'uninstall') result = await uninstall(ctx, rep)
    else if (cmd === 'usage') result = await usage(ctx, rep)
    else if (cmd === 'canary') result = await canary(ctx, rep)
    else if (cmd === 'rollback') result = await rollback(ctx, rep)
    else if (cmd === 'remove-claude-mem') result = await removeClaudeMem(ctx, rep)
    else throw new UserError(`unknown command ${cmd}`)
  } catch (e) {
    if (!(e instanceof UserError)) throw e
    rep.fail(e.message)
    result = { ok: false, error: e.message }
  }
  if (o.json) process.stdout.write(JSON.stringify({ command: cmd, ...rep.summary(), ...result }) + '\n')
  return result.ok ? 0 : 1
}

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('claude-workspace.mjs') || process.argv[1]?.endsWith('claude-workspace')
if (isMain) main().then((c) => { process.exitCode = c }, (e) => { process.stderr.write(`internal error: ${e.stack || e}\n`); process.exitCode = 70 })
