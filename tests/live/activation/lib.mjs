// Pure analysis for the activation baseline. Inputs are probe rows (cw-probe JSONL) and the
// transcript's skill_listing attachment. No model self-reports are used anywhere.

/** One run's evidence from probe rows. */
export function analyzeProbe(rows) {
  const main = rows.filter((r) => r.agentId == null)
  const activated = [...new Set(rows.filter((r) => r.ev === 'skill.prompt').map((r) => r.skill))]
  const calls = rows.filter((r) => r.ev === 'skill.call')
  const denied = [...new Set(calls.filter((c) => c.denied || c.isError).map((c) => c.skill))].filter((s) => !activated.includes(s))
  const steps = main.filter((r) => r.ev === 'turn.step')
  const done = main.filter((r) => r.ev === 'turn.complete')
  const usage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }
  for (const d of rows.filter((r) => r.ev === 'turn.complete' && r.usage)) for (const k of Object.keys(usage)) usage[k] += d.usage[k] ?? 0
  return {
    sid: rows.find((r) => r.sid)?.sid ?? null,
    activated, denied,
    models: [...new Set(steps.map((s) => s.model))],
    efforts: [...new Set(steps.map((s) => s.effort).filter(Boolean))],
    steps: steps.length,
    reason: done.at(-1)?.reason ?? null,
    usage,
  }
}

/** Listing evidence from the first skill_listing attachment of a transcript (JSONL text). */
export function listingFromTranscript(text) {
  for (const line of String(text).split('\n')) {
    if (!line.includes('"skill_listing"')) continue
    let d; try { d = JSON.parse(line) } catch { continue }
    const a = d.attachment
    if (a?.type !== 'skill_listing') continue
    const entries = a.content.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
    const nameOnly = entries.filter((l) => !l.includes(': '))
    return { skillCount: a.skillCount ?? entries.length, chars: a.content.length, withDescription: entries.length - nameOnly.length, nameOnly }
  }
  return null
}

/** Wilson score interval (95%). */
export function wilson(k, n, z = 1.96) {
  if (!n) return { p: null, lo: null, hi: null }
  const p = k / n, d = 1 + z * z / n
  const c = (p + z * z / (2 * n)) / d
  const h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
  return { p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) }
}

/** Newcombe 95% CI for the difference of two proportions (b - a), from Wilson intervals. */
export function diffCI(ka, na, kb, nb) {
  const A = wilson(ka, na), B = wilson(kb, nb)
  if (A.p == null || B.p == null) return { d: null, lo: null, hi: null }
  const d = B.p - A.p
  return {
    d,
    lo: d - Math.sqrt((B.p - B.lo) ** 2 + (A.hi - A.p) ** 2),
    hi: d + Math.sqrt((B.hi - B.p) ** 2 + (A.p - A.lo) ** 2),
  }
}

/** A run result is a hit when any expected skill was activated. Trivial class: hit = no process skill. */
export function scoreRun(run, cls) {
  const expect = cls.expectAny ?? []
  if (cls.unscored) return { hit: false, overActivation: [], unscored: true }
  if (!expect.length) return { hit: !run.activated.some((s) => s.startsWith('superpowers:')), overActivation: run.activated.filter((s) => s.startsWith('superpowers:')) }
  return { hit: run.activated.some((s) => expect.includes(s)), overActivation: [] }
}

export const MANDATORY_SKILLS = [
  'superpowers:using-superpowers', 'superpowers:brainstorming', 'superpowers:systematic-debugging', 'superpowers:test-driven-development',
  'superpowers:writing-plans', 'superpowers:verification-before-completion', 'superpowers:requesting-code-review', 'superpowers:receiving-code-review',
  'andrej-karpathy-skills:karpathy-guidelines', 'claude-mem:mem-search',
]

/** Aggregate runs: [{condition, promptId, class, ok, run, listing}] -> report object. */
export function aggregate(results, suite) {
  const conds = [...new Set(results.map((r) => r.condition))]
  const classes = Object.keys(suite.classes)
  const report = { conditions: {}, comparison: null, listing: {} }
  for (const c of conds) {
    const rs = results.filter((r) => r.condition === c && r.ok)
    const byClass = {}
    for (const k of classes) {
      const xs = rs.filter((r) => r.class === k)
      const hits = xs.filter((r) => scoreRun(r.run, suite.classes[k]).hit).length
      const skills = {}
      for (const r of xs) for (const s of r.run.activated) skills[s] = (skills[s] ?? 0) + 1
      byClass[k] = { n: xs.length, hits, rate: wilson(hits, xs.length), skills, overActivation: xs.flatMap((r) => scoreRun(r.run, suite.classes[k]).overActivation), denied: xs.flatMap((r) => r.run.denied) }
    }
    const scored = rs.filter((r) => (suite.classes[r.class].expectAny ?? []).length)
    const hits = scored.filter((r) => scoreRun(r.run, suite.classes[r.class]).hit).length
    const mean = (f) => (rs.length ? rs.reduce((s, r) => s + f(r), 0) / rs.length : null)
    const listings = rs.map((r) => r.listing).filter(Boolean)
    report.conditions[c] = {
      runs: results.filter((r) => r.condition === c).length, ok: rs.length, failedRuns: results.filter((r) => r.condition === c && !r.ok).map((r) => ({ id: r.promptId, error: r.error })),
      overall: { n: scored.length, hits, rate: wilson(hits, scored.length) },
      byClass,
      tokens: { in: mean((r) => r.run.usage.in), out: mean((r) => r.run.usage.out), cacheRead: mean((r) => r.run.usage.cacheRead), cacheWrite: mean((r) => r.run.usage.cacheWrite), steps: mean((r) => r.run.steps),
        contextPerStep: mean((r) => (r.run.usage.in + r.run.usage.cacheRead + r.run.usage.cacheWrite) / Math.max(1, r.run.steps)) },
      models: [...new Set(rs.flatMap((r) => r.run.models))],
      agreement: rs.some((r) => r.core) ? {
        runs: rs.filter((r) => r.core).length,
        matching: rs.filter((r) => r.core && sameSet(r.core.activated, r.run.activated)).length,
      } : null,
    }
    report.listing[c] = summarizeListings(listings)
  }
  const ref = conds.includes('nocontract') ? 'nocontract' : 'before'
  if (conds.includes(ref) && conds.includes('with')) {
    const a = report.conditions[ref].overall, b = report.conditions.with.overall
    const ta = report.conditions[ref].tokens, tb = report.conditions.with.tokens
    report.comparison = {
      reference: ref,
      activationDiff: diffCI(a.hits, a.n, b.hits, b.n),
      contextPerStepDelta: tb.contextPerStep != null && ta.contextPerStep != null ? tb.contextPerStep - ta.contextPerStep : null,
      listingCharsDelta: (report.listing.with.chars?.median ?? 0) - (report.listing[ref].chars?.median ?? 0),
    }
  }
  return report
}

function summarizeListings(ls) {
  if (!ls.length) return { sessions: 0 }
  const chars = ls.map((l) => l.chars).sort((x, y) => x - y)
  const nameOnly = [...new Set(ls.flatMap((l) => l.nameOnly))].sort()
  return {
    sessions: ls.length,
    skillCount: [...new Set(ls.map((l) => l.skillCount))],
    chars: { min: chars[0], median: chars[Math.floor(chars.length / 2)], max: chars.at(-1) },
    nameOnly,
    mandatoryNameOnly: nameOnly.filter((n) => MANDATORY_SKILLS.includes(n)),
    workspaceNameOnly: nameOnly.filter((n) => /^(superpowers|caveman|ponytail|andrej-karpathy-skills|claude-mem):/.test(n)),
  }
}

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x))

const pct = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`)
const ci = (r) => (r.p == null ? '—' : `${pct(r.p)} [${pct(r.lo)}–${pct(r.hi)}]`)

export function renderMarkdown(report, suite, meta) {
  const L = []
  L.push(`# Activation and skill-listing baseline (${meta.date})`, '')
  L.push(`Claude Code ${meta.claudeVersion} · ${meta.runsPerPrompt} run(s) per prompt · ${suite.prompts.length} prompts · conditions: ${Object.keys(report.conditions).join(', ')}`)
  L.push('Evidence: the independent `cw-probe` mod (`skill.prompt`, `turn.step`, `turn.complete`) and the transcript `skill_listing` attachment. No model self-reports are used.', '')
  L.push('Conditions:')
  for (const [k, v] of Object.entries(meta.conditionNotes)) L.push(`- **${k}**: ${v}`)
  L.push('', '## Activation (hit = at least one expected skill activated; trivial = no process skill)', '')
  const conds = Object.keys(report.conditions).filter((c) => c !== 'bare')
  L.push(`| Class | ${conds.map((c) => `${c} hit rate [95% CI]`).join(' | ')} | Skills activated (${conds.join(' / ')}) |`)
  L.push(`|---|${conds.map(() => '---').join('|')}|---|`)
  for (const k of Object.keys(suite.classes)) {
    const cells = conds.map((c) => { const b = report.conditions[c].byClass[k]; return suite.classes[k].unscored ? `unscored (n=${b.n})` : `${b.hits}/${b.n} · ${ci(b.rate)}` })
    const sk = conds.map((c) => Object.entries(report.conditions[c].byClass[k].skills).map(([s, n]) => `${s.replace(/^superpowers:/, 'sp:')}×${n}`).join(', ') || '—').join(' / ')
    L.push(`| ${k} | ${cells.join(' | ')} | ${sk} |`)
  }
  L.push(`| **overall (scored classes)** | ${conds.map((c) => { const o = report.conditions[c].overall; return `**${o.hits}/${o.n} · ${ci(o.rate)}**` }).join(' | ')} | |`, '')
  if (report.comparison) {
    const d = report.comparison.activationDiff
    L.push(`## ${report.comparison.reference} vs with`, '')
    L.push(`- Activation difference (with − ${report.comparison.reference}):${d.d == null ? '—' : `${(d.d * 100).toFixed(1)} pts, 95% CI [${(d.lo * 100).toFixed(1)}, ${(d.hi * 100).toFixed(1)}]`}`)
    L.push(`- Mean context per model request delta (input + cache read + cache write, divided by requests): ${report.comparison.contextPerStepDelta == null ? '—' : Math.round(report.comparison.contextPerStepDelta)} tokens`)
    L.push(`- Skill-listing median size delta: ${report.comparison.listingCharsDelta} chars`, '')
  }
  L.push('## Skill listing (overflow)', '')
  L.push('| Condition | Sessions | Skills | Listing chars (min/median/max) | Name-only (description dropped) | Workspace skills name-only | Mandatory name-only |')
  L.push('|---|---|---|---|---|---|---|')
  for (const [c, l] of Object.entries(report.listing)) {
    if (!l.sessions) { L.push(`| ${c} | 0 | — | — | — | — | — |`); continue }
    L.push(`| ${c} | ${l.sessions} | ${l.skillCount.join(', ')} | ${l.chars.min}/${l.chars.median}/${l.chars.max} | ${l.nameOnly.length}: ${l.nameOnly.join(', ') || '—'} | ${l.workspaceNameOnly.length} | **${l.mandatoryNameOnly.length}** |`)
  }
  L.push('', '## Tokens and models', '')
  for (const [c, v] of Object.entries(report.conditions)) {
    L.push(`- **${c}**: ${v.ok}/${v.runs} runs ok; mean tokens in ${Math.round(v.tokens.in ?? 0)}, out ${Math.round(v.tokens.out ?? 0)}, cache read ${Math.round(v.tokens.cacheRead ?? 0)}, cache write ${Math.round(v.tokens.cacheWrite ?? 0)}; mean requests ${(v.tokens.steps ?? 0).toFixed(1)}; mean context per request ${Math.round(v.tokens.contextPerStep ?? 0)}; models ${v.models.join(', ')}${v.agreement ? `; workspace-core vs probe agreement ${v.agreement.matching}/${v.agreement.runs}` : ''}${v.failedRuns.length ? `; failed runs: ${v.failedRuns.map((f) => `${f.id} (${f.error})`).join('; ')}` : ''}`)
  }
  L.push('')
  return L.join('\n')
}
