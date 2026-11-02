#!/usr/bin/env node
// Offline re-grade of saved outcome runs (no model calls, no cost):
//   node tests/live/outcomes/regrade.mjs <workdir> [--out DIR]
// For each runs/<run>/ it applies diff.patch to a clean copy of the fixture, re-runs the graders and
// re-grades the saved stream.jsonl with the current lib.mjs and outcomes.json. Use after fixing a
// grader or a check, instead of paying for new runs.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { timeline, grade, summarizeOutcomes } from './lib.mjs'
import { git, changedFiles, runGraders, parseStream } from './fixture.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(HERE, '..', 'activation', 'fixture-project')
const WORK = resolve(process.argv[2] ?? '')
const outArg = process.argv.indexOf('--out')
const OUT = resolve(outArg > 0 ? process.argv[outArg + 1] : join(WORK, 'report'))
if (!existsSync(join(WORK, 'runs'))) { process.stderr.write('usage: regrade.mjs <workdir with runs/>\n'); process.exit(2) }
const spec = JSON.parse(readFileSync(join(HERE, 'outcomes.json'), 'utf8'))
const byId = Object.fromEntries(spec.prompts.map((p) => [p.id, p]))

const results = []
for (const name of readdirSync(join(WORK, 'runs')).sort()) {
  const rdir = join(WORK, 'runs', name)
  const old = JSON.parse(readFileSync(join(rdir, 'result.json'), 'utf8'))
  const p = byId[old.id]
  if (old.error || !p) { results.push(old); continue }
  const tmp = mkdtempSync(join(tmpdir(), 'cw-regrade-'))
  const dir = join(tmp, 'shop-cart')
  try {
    cpSync(FIXTURE, dir, { recursive: true })
    git(dir, 'init', '-q'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'fixture')
    const patch = join(rdir, 'diff.patch')
    if (readFileSync(patch, 'utf8').trim()) git(dir, 'apply', '--whitespace=nowarn', patch)
    const final = { changed: changedFiles(dir), graders: runGraders(dir, p, spec.graders) }
    const steps = timeline(parseStream(readFileSync(join(rdir, 'stream.jsonl'), 'utf8')))
    const r = { ...old, final, skills: [...new Set(steps.filter((s) => s.kind === 'skill').map((s) => s.skill))], graded: grade(p, steps, final), regraded: true }
    writeFileSync(join(rdir, 'result.json'), JSON.stringify(r, null, 2))
    results.push(r)
    const fails = Object.entries(r.graded.checks).filter(([, v]) => !v.pass).map(([k, v]) => `${k}${v.soft ? '(soft)' : ''}`)
    process.stderr.write(`[regrade] ${r.graded.pass ? 'PASS' : 'FAIL'} ${r.condition.padEnd(10)} ${r.id.padEnd(11)}${fails.length ? ` failed: ${fails.join(', ')}` : ''}\n`)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

const summary = summarizeOutcomes(results)
const conds = [...new Set(results.map((r) => r.condition))].sort()
const L = ['# Workflow outcomes (re-graded offline)', '', `Source: ${WORK} · ${results.length} run(s) · graded with the current lib.mjs / outcomes.json`, '',
  `| Prompt / check | ${conds.join(' | ')} |`, `|---|${conds.map(() => '---').join('|')}|`]
for (const k of [...new Set(conds.flatMap((c) => Object.keys(summary[c]?.checks ?? {})))].sort()) {
  L.push(`| ${k}${Object.values(summary).some((s) => s.checks[k]?.soft) ? ' (soft)' : ''} | ${conds.map((c) => { const s = summary[c]?.checks[k]; return s ? `${s.pass}/${s.n}` : '—' }).join(' | ')} |`)
}
L.push(`| **runs passing all hard checks** | ${conds.map((c) => `**${summary[c]?.pass ?? 0}/${summary[c]?.runs ?? 0}**`).join(' | ')} |`, '', '## Runs', '')
for (const r of results) L.push(`- ${r.condition} · ${r.id}: ${r.graded ? `${r.graded.pass ? 'PASS' : 'FAIL'} · skills ${r.skills.join(', ') || 'none'} · ${Object.entries(r.graded.checks).map(([k, v]) => `${k} ${v.pass ? '✓' : '✗'} (${v.why})`).join('; ')}` : `ERROR ${r.error}`}`)
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'regraded-outcomes.md'), L.join('\n') + '\n')
writeFileSync(join(OUT, 'regraded-outcomes.json'), JSON.stringify({ source: WORK, summary, results }, null, 2) + '\n')
process.stderr.write(`[regrade] report: ${join(OUT, 'regraded-outcomes.md')}\n`)
