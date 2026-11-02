#!/usr/bin/env node
// Workflow-outcome runner (plan §6; live, costs real requests). Linux/WSL/macOS.
//   node tests/live/outcomes/run.mjs [--conditions nocontract,with] [--runs 1] [--concurrency 2]
//        [--only id,id] [--workdir DIR] [--out DIR]
// Each run is write-enabled but scoped: acceptEdits + Read/Grep/Glob/Edit/Write/Skill + test commands
// only, in a fixture copy that has the workspace installed and is reset with git between runs.
// claude-mem is disabled for these runs so memories of earlier fixture sessions cannot leak answers.
// Cost: ~$0.25-0.50 per run; the pool stops at the first usage-limit error; the report shows the cost.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { timeline, grade, summarizeOutcomes } from './lib.mjs'
import { git, changedFiles, runGraders, parseStream } from './fixture.mjs'
import { usageFrom, overLimit, fmtUsage } from '../usage-guard.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')
const FIXTURE = join(REPO, 'tests', 'live', 'activation', 'fixture-project')
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []))
const CONDS = String(args.conditions ?? 'nocontract,with').split(',')
const RUNS = Number(args.runs ?? 1)
const CONC = Number(args.concurrency ?? 2)
const CLAUDE = process.env.CW_CLAUDE_BIN || 'claude'
const MAX_USAGE = Number(args['max-usage'] ?? 0.9) // stop when any usage window (5-hour, 7-day) reaches this
const spec = JSON.parse(readFileSync(join(HERE, 'outcomes.json'), 'utf8'))
const prompts = args.only ? spec.prompts.filter((p) => String(args.only).split(',').includes(p.id)) : spec.prompts
const WORK = resolve(args.workdir ?? join(tmpdir(), `cw-outcomes-${new Date().toISOString().replace(/[:.]/g, '-')}`))
const OUT = resolve(args.out ?? join(WORK, 'report'))
const log = (m) => process.stderr.write(`[outcomes] ${m}\n`)

const CONDITION = {
  nocontract: { env: { CW_CONTRACTS: '0' }, note: 'workspace-core on, Phase 3 contracts off' },
  with: { env: {}, note: 'workspace-core on incl. Phase 3 contracts and Phase 4 gates' },
  nogate: { env: { CW_GATES: '0' }, note: 'contracts on, Phase 4 gates off' },
}

// ---------------------------------------------------------------- one installed fixture per worker slot
const slots = []
for (let k = 0; k < CONC; k++) {
  const dir = join(WORK, `slot-${k}`, 'shop-cart')
  if (!existsSync(dir)) {
    cpSync(FIXTURE, dir, { recursive: true })
    git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
    log(`installing workspace into ${dir}`)
    const r = spawnSync(process.execPath, [join(REPO, 'cli', 'bin', 'claude-workspace.mjs'), 'install', '--yes', '--project', dir, '--json'], { encoding: 'utf8', input: '' })
    const res = JSON.parse(r.stdout.trim().split('\n').pop())
    if (!res.ok) throw new Error(`workspace install failed: ${res.error || res.failures.join('; ')}`)
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'workspace install') // reset target keeps the install
  }
  slots.push(dir)
}
const reset = (dir) => { git(dir, 'reset', '-q', '--hard'); git(dir, 'clean', '-qfd') }

let aborted = null
function runOne({ c, p, i }, dir) {
  reset(dir)
  const rdir = join(WORK, 'runs', `${c}-${p.id}-${i}`)
  mkdirSync(rdir, { recursive: true })
  const a = ['-p', p.prompt, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Skill', 'Read', 'Grep', 'Glob', 'Edit', 'Write', 'Bash(node --test:*)', 'Bash(npm test:*)', 'Bash(npm run test:*)',
    '--settings', JSON.stringify({ enabledPlugins: { 'claude-mem@thedotmack': false } })]
  const env = { ...process.env, ...CONDITION[c].env, CW_EVENTS_DIR: join(rdir, 'core') }
  return new Promise((done) => {
    const t0 = Date.now()
    const ch = spawn(CLAUDE, a, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    ch.stdout.on('data', (d) => { out += d }); ch.stderr.on('data', (d) => { out += d })
    const timer = setTimeout(() => ch.kill('SIGTERM'), 300_000)
    ch.on('close', (code) => {
      clearTimeout(timer)
      writeFileSync(join(rdir, 'stream.jsonl'), out)
      const events = parseStream(out)
      const fin = events.findLast((e) => e.type === 'result')
      const res = { condition: c, id: p.id, class: p.class, iteration: i, exitCode: code, ms: Date.now() - t0, costUsd: fin?.total_cost_usd ?? null }
      if (!fin || fin.is_error || fin.subtype !== 'success') {
        res.error = String(fin?.result ?? fin?.subtype ?? 'no result event').slice(0, 160)
        if (/hit your [\w-]* ?limit|usage limit|rate[- ]limit/i.test(res.error + (fin ? '' : out.slice(-500)))) aborted ??= `usage limit at ${c}/${p.id}`
      }
      res.usage = usageFrom(out)
      const over = overLimit(res.usage, MAX_USAGE)
      if (over) aborted ??= `${over} after ${c}/${p.id} (--max-usage)`
      if (!res.error) {
        const steps = timeline(events)
        const final = { changed: changedFiles(dir), graders: runGraders(dir, p, spec.graders) }
        res.skills = [...new Set(steps.filter((s) => s.kind === 'skill').map((s) => s.skill))]
        res.final = final
        res.graded = grade(p, steps, final)
        writeFileSync(join(rdir, 'diff.patch'), git(dir, 'diff', 'HEAD'))
      }
      writeFileSync(join(rdir, 'result.json'), JSON.stringify(res, null, 2))
      const fails = res.graded ? Object.entries(res.graded.checks).filter(([, v]) => !v.pass).map(([k, v]) => `${k}${v.soft ? '(soft)' : ''}`) : []
      log(`${res.graded ? (res.graded.pass ? 'PASS' : 'FAIL') : 'ERR '} ${c.padEnd(10)} ${p.id.padEnd(11)} #${i} ${Math.round(res.ms / 1000)}s $${(res.costUsd ?? 0).toFixed(2)} skills=[${(res.skills ?? []).join(', ')}] usage=${fmtUsage(res.usage)}${fails.length ? ` failed: ${fails.join(', ')}` : ''}${res.error ? ` ${res.error}` : ''}`)
      done(res)
    })
  })
}

// ---------------------------------------------------------------- pool (each worker owns one fixture slot)
const jobs = []
for (let i = 0; i < RUNS; i++) for (const p of prompts) for (const c of CONDS) jobs.push({ c, p, i })
log(`${jobs.length} runs, concurrency ${CONC}, work dir ${WORK}`)
const results = []
let next = 0
await Promise.all(slots.map(async (dir) => { while (!aborted && next < jobs.length) results.push(await runOne(jobs[next++], dir)) }))
for (const d of slots) reset(d)
if (aborted) log(`STOPPED: ${aborted}; ${jobs.length - next} run(s) not started`)
const costUsd = results.reduce((s, r) => s + (r.costUsd ?? 0), 0)

// ---------------------------------------------------------------- report
const summary = summarizeOutcomes(results)
const date = new Date().toISOString().slice(0, 10)
const L = [`# Workflow outcomes (${date})`, '',
  `${jobs.length} run(s) planned, ${results.length} done · conditions: ${CONDS.map((c) => `${c} (${CONDITION[c].note})`).join('; ')}`,
  'Graded from stream-json engine events and the fixture\'s final git state (plan §6). Soft checks are reported but do not fail a run.', '',
  `| Prompt / check | ${CONDS.join(' | ')} |`, `|---|${CONDS.map(() => '---').join('|')}|`]
const keys = [...new Set(CONDS.flatMap((c) => Object.keys(summary[c]?.checks ?? {})))]
for (const k of keys) L.push(`| ${k}${Object.values(summary).some((s) => s.checks[k]?.soft) ? ' (soft)' : ''} | ${CONDS.map((c) => { const s = summary[c]?.checks[k]; return s ? `${s.pass}/${s.n}` : '—' }).join(' | ')} |`)
L.push(`| **runs passing all hard checks** | ${CONDS.map((c) => `**${summary[c]?.pass ?? 0}/${summary[c]?.runs ?? 0}**`).join(' | ')} |`, '')
L.push('## Runs', '')
for (const r of results) L.push(`- ${r.condition} · ${r.id}: ${r.graded ? `${r.graded.pass ? 'PASS' : 'FAIL'} · skills ${r.skills.join(', ') || 'none'} · ${Object.entries(r.graded.checks).map(([k, v]) => `${k} ${v.pass ? '✓' : '✗'} (${v.why})`).join('; ')}` : `ERROR ${r.error}`}`)
L.push('', `Cost: $${costUsd.toFixed(2)} over ${results.length} run(s)${aborted ? ` · STOPPED early: ${aborted}; ${jobs.length - next} not started` : ''}`, '')
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, `${date}-outcomes.md`), L.join('\n'))
writeFileSync(join(OUT, `${date}-outcomes.json`), JSON.stringify({ date, conditions: CONDS, summary, costUsd, aborted, results }, null, 2) + '\n')
log(`cost: $${costUsd.toFixed(2)} · report: ${join(OUT, `${date}-outcomes.md`)}`)
if (aborted) process.exitCode = 3
