#!/usr/bin/env node
// Activation + skill-listing baseline runner (live, costs real requests). Linux/WSL/macOS.
//   node tests/live/activation/run.mjs [--full] [--runs 1] [--conditions with] [--concurrency 2]
//        [--budget 0.40] [--only id,id] [--out docs/baselines] [--workdir DIR]
// Cost control (each run is a full session, ~60k context tokens, counted against your usage limit):
//   default = smoke: one prompt per class, 1 run, condition `with` only (7 runs). The no-contract
//   reference is already measured (0/51, docs/baselines/2026-11-02-activation-investigation.md);
//   add `--conditions nocontract,with` only when it must be re-measured. `--full` = all prompts.
//   The pool stops dispatching at the first usage-limit error. The report shows the total cost.
// Conditions:
//   before      Phase 1 state: workspace installed, workspace-core mod disabled (flag settings).
//   nocontract  workspace-core enabled, Phase 3 contracts off (CW_CONTRACTS=0).
//   with        workspace-core enabled incl. contracts (its events cross-checked against the probe).
//   bare        listing reference: empty project, no workspace plugins, claude-mem disabled.
// Runs are read-only (Edit/Write/Bash disallowed) and capped by --max-budget-usd each.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { analyzeProbe, listingFromTranscript, aggregate, renderMarkdown } from './lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []))
const RUNS = Number(args.runs ?? 1)
const CONDS = String(args.conditions ?? 'with').split(',')
const CONC = Number(args.concurrency ?? 2)
// --max-budget-usd is shown to the model (a "USD budget" reminder) and made it skip skills "because the
// budget is small": opt-in only. Default guard: read-only tools + the 300 s per-run timeout.
const BUDGET = args.budget ? String(args.budget) : null
const OUT = resolve(REPO, args.out ?? 'docs/baselines')
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const CONFIG = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const suite = JSON.parse(readFileSync(join(HERE, 'suite.json'), 'utf8'))
const smoke = suite.prompts.filter((p, i, all) => all.findIndex((q) => q.class === p.class) === i)
const prompts = args.only ? suite.prompts.filter((p) => String(args.only).split(',').includes(p.id)) : args.full ? suite.prompts : smoke
let aborted = null // set at the first usage-limit error: no further runs are dispatched
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-baseline-${stamp}`))

const sh = (cmd, a, opts = {}) => { const r = spawnSync(cmd, a, { encoding: 'utf8', input: '', ...opts }); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')}: ${r.stderr || r.stdout}`); return r.stdout }
const log = (m) => process.stderr.write(`[baseline] ${m}\n`)

// ---------------------------------------------------------------- setup
mkdirSync(WORK, { recursive: true })
const project = join(WORK, 'shop-cart')
const bareProject = join(WORK, 'bare')
if (CONDS.some((c) => c !== 'bare') && !existsSync(project)) {
  cpSync(join(HERE, 'fixture-project'), project, { recursive: true })
  const g = ['-c', 'user.name=cw-baseline', '-c', 'user.email=cw-baseline@example.invalid']
  sh('git', [...g, 'init', '-q'], { cwd: project }); sh('git', [...g, 'add', '-A'], { cwd: project }); sh('git', [...g, 'commit', '-qm', 'fixture'], { cwd: project })
  log(`installing workspace into ${project}`)
  const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', project, '--json'], { encoding: 'utf8', input: '' })
  const res = JSON.parse(r.stdout.trim().split('\n').pop())
  if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
}
if (CONDS.includes('bare')) mkdirSync(bareProject, { recursive: true })
const claudeVersion = sh(CLAUDE, ['--version']).trim()

const CONDITION = {
  before: { cwd: project, settings: { enabledPlugins: { 'workspace-core@cw-workspace': false } }, note: 'Phase 1 install; workspace-core disabled via --settings' },
  notrim: { cwd: project, settings: null, env: { CW_LISTING_TRIM: '0' }, note: 'workspace-core enabled, Phase 3 listing trim off (CW_LISTING_TRIM=0)' },
  nocontract: { cwd: project, settings: null, env: { CW_CONTRACTS: '0' }, note: 'workspace-core enabled, Phase 3 contracts off (CW_CONTRACTS=0)' },
  with: { cwd: project, settings: null, note: 'workspace-core enabled incl. Phase 3 workflow contracts (events cross-checked against cw-probe)' },
  bare: { cwd: bareProject, settings: { enabledPlugins: { 'claude-mem@thedotmack': false } }, note: 'listing reference: empty dir, no workspace plugins, claude-mem disabled (1 trivial prompt)' },
}

// ---------------------------------------------------------------- jobs (interleaved to spread time effects)
const jobs = []
for (let i = 0; i < RUNS; i++) for (const p of prompts) for (const c of CONDS.filter((c) => c !== 'bare')) jobs.push({ c, p, i })
if (CONDS.includes('bare')) jobs.push({ c: 'bare', p: { id: 'bare-1', class: 'trivial', prompt: 'Reply with the single word OK.' }, i: 0 })

function runOne({ c, p, i }) {
  const dir = join(WORK, 'runs', `${c}-${p.id}-${i}`)
  mkdirSync(join(dir, 'core'), { recursive: true })
  const a = ['-p', p.prompt, '--plugin-dir', join(HERE, 'probe'),
    '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', '--disallowedTools', 'Edit', 'Write', 'NotebookEdit', 'Bash',
    '--output-format', 'json']
  if (BUDGET) a.push('--max-budget-usd', BUDGET)
  if (CONDITION[c].settings) a.push('--settings', JSON.stringify(CONDITION[c].settings))
  const env = { ...process.env, ...(CONDITION[c].env ?? {}), CW_PROBE_DIR: dir, CW_EVENTS_DIR: join(dir, 'core') }
  return new Promise((done) => {
    const t0 = Date.now()
    const ch = spawn(CLAUDE, a, { cwd: CONDITION[c].cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    ch.stdout.on('data', (d) => { out += d }); ch.stderr.on('data', (d) => { out += d })
    const timer = setTimeout(() => ch.kill('SIGTERM'), 300_000)
    ch.on('close', (code) => {
      clearTimeout(timer)
      writeFileSync(join(dir, 'output.txt'), out)
      const res = { condition: c, promptId: p.id, class: p.class, iteration: i, exitCode: code, ms: Date.now() - t0, ok: false }
      const last = out.trim().split('\n').reverse().find((l) => l.startsWith('{'))
      try { const j = JSON.parse(last); res.costUsd = j.total_cost_usd ?? null; res.apiError = j.is_error ? String(j.result ?? '').slice(0, 160) : undefined } catch {}
      if (/hit your [\w-]* ?limit|usage limit|rate[- ]limit/i.test(res.apiError ?? (res.costUsd == null ? out : ''))) {
        aborted ??= `usage limit reached at ${c}/${p.id}: ${(res.apiError ?? out).trim().slice(0, 120)}`
      }
      try {
        const rows = readFileSync(join(dir, 'probe.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
        res.run = analyzeProbe(rows)
        // an API error (e.g. a usage limit) still produces a step; only an answered request counts
        res.ok = res.run.steps > 0 && res.run.reason === 'answer'
        if (!res.ok) res.error = res.run.steps > 0 ? `request ended: ${res.run.reason}` : 'no model request observed'
        const root = realpathSync(CONDITION[c].cwd)
        const tp = join(CONFIG, 'projects', root.replace(/[^A-Za-z0-9]/g, '-'), `${res.run.sid}.jsonl`)
        res.listing = existsSync(tp) ? listingFromTranscript(readFileSync(tp, 'utf8')) : null
        if (c !== 'before' && c !== 'bare') res.core = coreActivations(join(dir, 'core'))
      } catch (e) { res.error = `probe: ${e.message.slice(0, 120)}` }
      writeFileSync(join(dir, 'result.json'), JSON.stringify(res, null, 2))
      log(`${res.ok ? 'ok ' : 'ERR'} ${c.padEnd(6)} ${p.id.padEnd(9)} #${i} ${Math.round(res.ms / 1000)}s skills=[${res.run?.activated.join(', ') ?? ''}]${res.error ? ` ${res.error}` : ''}`)
      done(res)
    })
  })
}

/** Skills that workspace-core itself recorded for the run (cross-check of the Phase 2 pipeline). */
function coreActivations(dir) {
  const rows = []
  const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) walk(p); else if (n.name.endsWith('.jsonl')) for (const l of readFileSync(p, 'utf8').split('\n')) if (l.trim()) rows.push(JSON.parse(l)) } }
  try { walk(dir) } catch { return null }
  if (!rows.length) return { activated: [], events: 0 }
  // the transcript keeps the engine's full listing; the model-facing (trimmed) size comes from the mod
  const listing = rows.find((r) => r.ev === 'listing' && r.agentId == null)
  return { activated: [...new Set(rows.filter((r) => r.ev === 'skill.prompt').map((r) => r.skill))], events: rows.length, listingModelChars: listing ? listing.after : null }
}

// ---------------------------------------------------------------- run pool
log(`${jobs.length} runs, concurrency ${CONC}, budget ${BUDGET ? `$${BUDGET}/run (visible to the model)` : 'none (300 s timeout)'}, work dir ${WORK}`)
const results = []
let next = 0
await Promise.all(Array.from({ length: CONC }, async () => { while (!aborted && next < jobs.length) results.push(await runOne(jobs[next++])) }))
if (aborted) log(`STOPPED: ${aborted}; ${jobs.length - next} run(s) not started`)
const costUsd = results.reduce((s, r) => s + (r.costUsd ?? 0), 0)
log(`cost: $${costUsd.toFixed(2)} over ${results.length} run(s)`)

// "before" must really have the mod off: no workspace-core events may exist for those runs
const leaked = results.filter((r) => r.condition === 'before' && existsSync(join(WORK, 'runs', `before-${r.promptId}-${r.iteration}`, 'core')) && readdirSync(join(WORK, 'runs', `before-${r.promptId}-${r.iteration}`, 'core')).length)
if (leaked.length) log(`WARNING: workspace-core wrote events in ${leaked.length} 'before' run(s): condition switch did not hold`)

const report = aggregate(results, suite)
report.conditionCheck = { beforeModOff: leaked.length === 0 }
const meta = {
  date: new Date().toISOString().slice(0, 10), claudeVersion, runsPerPrompt: RUNS, mode: args.full ? 'full' : args.only ? 'only' : 'smoke',
  costUsd: Number(costUsd.toFixed(2)), aborted, notStarted: jobs.length - next,
  conditionNotes: Object.fromEntries(CONDS.map((c) => [c, CONDITION[c].note])),
}
if (!CONDS.includes('nocontract') && !CONDS.includes('before')) meta.conditionNotes.reference = 'not re-run: no-contract reference is 0/51 answered runs (docs/baselines/2026-11-02-activation-investigation.md)'
mkdirSync(OUT, { recursive: true })
const base = join(OUT, `${meta.date}-activation`)
writeFileSync(`${base}.json`, JSON.stringify({ meta, suite: { version: suite.version, prompts: prompts.map((p) => p.id) }, report, results }, null, 2) + '\n')
writeFileSync(`${base}.md`, renderMarkdown(report, { ...suite, prompts }, meta) + `\nCondition check: workspace-core off in 'before' runs: ${leaked.length === 0 ? 'yes' : `NO (${leaked.length} leaked)`}\n` +
  `\nCost: $${meta.costUsd} over ${results.length} run(s) (${meta.mode})${aborted ? ` · STOPPED early: ${aborted}; ${meta.notStarted} run(s) not started` : ''}\n`)
log(`report: ${base}.md`)
