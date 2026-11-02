// Workflow-outcome grading (plan §6). Pure. Inputs are engine records only:
//   - the stream-json event list of a `claude -p --output-format stream-json --verbose` run
//   - the fixture's final state (changed files with line counts, grader command results)
// The model's own claims are never used as evidence.

/** Flatten stream-json events into an ordered timeline of steps. */
export function timeline(events) {
  const steps = []
  const byId = new Map()
  for (const ev of events) {
    const content = ev?.message?.content
    if (!Array.isArray(content)) continue
    for (const c of content) {
      if (ev.type === 'assistant' && c.type === 'text') steps.push({ kind: 'text', text: c.text })
      else if (ev.type === 'assistant' && c.type === 'tool_use') {
        const s = toolStep(c)
        byId.set(c.id, s)
        steps.push(s)
      } else if (ev.type === 'user' && c.type === 'tool_result') {
        const s = byId.get(c.tool_use_id)
        if (s) { s.isError = c.is_error === true; s.output = flat(c.content).slice(0, 4000) }
      }
    }
  }
  return steps
}

const flat = (x) => (typeof x === 'string' ? x : Array.isArray(x) ? x.map((y) => (typeof y === 'string' ? y : y?.text ?? '')).join('\n') : '')

function toolStep(c) {
  const i = c.input ?? {}
  if (c.name === 'Skill') return { kind: 'skill', skill: i.skill ?? i.command ?? null }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(c.name)) return { kind: 'edit', file: rel(i.file_path ?? i.notebook_path) }
  if (c.name === 'Bash') {
    const command = String(i.command ?? '')
    // acceptEdits lets shell writes inside the project through (`cat >> test/x`, `sed -i`, `tee`): count them as edits
    const w = command.match(/(?:>>?|\btee(?:\s+-a)?)\s*['"]?((?:\.\/)?(?:src|test)\/[^\s'";|&]+)/) ?? command.match(/\bsed\s+-i\S*\s+(?:'[^']*'|"[^"]*"|\S+)\s+((?:\.\/)?(?:src|test)\/[^\s;|&]+)/)
    if (w) return { kind: 'edit', file: w[1].replace(/^\.\//, ''), via: 'bash', command, isTest: /\b(node --test|npm (run )?test)\b/.test(command) }
    return { kind: 'bash', command, isTest: /\b(node --test|npm (run )?test)\b/.test(command) }
  }
  return { kind: 'tool', name: c.name }
}

// paths are reported relative to the fixture root: everything from the first src/ or test/ segment
const rel = (p) => { const s = String(p ?? ''); const m = s.match(/(?:^|\/)((?:src|test)\/.*)$/); return m ? m[1] : s.split('/').pop() }

const isSrc = (f) => /^src\//.test(f)
const isTest = (f) => /^test\//.test(f)
/** A test run whose output shows a failure (node:test prints "# fail N" with N > 0, or "not ok"). */
export const runFailed = (s) => s.kind === 'bash' && s.isTest && (s.isError || /# fail [1-9]|\bnot ok\b/.test(s.output ?? ''))

/**
 * Grade one run. `spec` comes from outcomes.json; `final` = { changed: {file: lines}, graders: {name: bool} }.
 * Returns { checks: {name: {pass, why}}, pass } where pass = every non-soft check passed.
 */
export function grade(spec, steps, final) {
  const checks = {}
  const firstIdx = (pred) => steps.findIndex(pred)
  const firstSrcEdit = firstIdx((s) => s.kind === 'edit' && isSrc(s.file))
  const before = (i) => (i < 0 ? steps : steps.slice(0, i))
  const set = (name, pass, why, soft = false) => { checks[name] = { pass, why, ...(soft ? { soft } : {}) } }

  for (const c of spec.checks) {
    switch (c.type) {
      case 'rootCauseBeforeFix': {
        if (firstSrcEdit < 0) { set(c.type, false, 'no src edit (no fix made)'); break }
        const said = before(firstSrcEdit).some((s) => s.kind === 'text' && new RegExp(c.pattern, 'i').test(s.text))
        set(c.type, said, said ? 'root cause stated before the first src edit' : 'no root-cause statement before the first src edit')
        break
      }
      case 'reproducedFirst': {
        const ran = before(firstSrcEdit).some((s) => s.kind === 'bash' && s.isTest)
        set(c.type, ran, ran ? 'a test run preceded the fix' : 'no test run before the fix', true)
        break
      }
      case 'designBeforeEdit': {
        if (firstSrcEdit < 0) { set(c.type, true, 'no src edits this turn (stopped at design/questions)'); break }
        const design = before(firstSrcEdit).some((s) => s.kind === 'skill' && c.skills.includes(s.skill))
        set(c.type, design, design ? 'design skill activated before the first src edit' : 'src edited without a prior design step')
        break
      }
      case 'testFirst': {
        const t = firstIdx((s) => s.kind === 'edit' && isTest(s.file))
        if (t < 0) { set(c.type, false, 'no test edit'); break }
        if (firstSrcEdit >= 0 && firstSrcEdit < t) { set(c.type, false, 'src edited before the test'); break }
        const red = steps.slice(t, firstSrcEdit < 0 ? steps.length : firstSrcEdit).some(runFailed)
        set(c.type, red, red ? 'test written first and seen failing before src edit' : 'test written first, but no failing run before the src edit')
        break
      }
      case 'testsRunAfterWrite': {
        let last = -1
        steps.forEach((s, i) => { if (s.kind === 'edit' && isTest(s.file)) last = i })
        if (last < 0) { set(c.type, false, 'no test edit'); break }
        const ran = steps.slice(last + 1).some((s) => s.kind === 'bash' && s.isTest)
        set(c.type, ran, ran ? 'tests run after the last test edit' : 'tests not run after writing them')
        break
      }
      case 'diffWithin': {
        const files = Object.keys(final.changed)
        const outside = files.filter((f) => !c.files.some((g) => (g.endsWith('/') ? f.startsWith(g) : f === g)))
        const lines = Object.values(final.changed).reduce((a, b) => a + b, 0)
        const ok = !outside.length && (c.maxLines == null || lines <= c.maxLines)
        set(c.type, ok, outside.length ? `changed outside scope: ${outside.join(', ')}` : c.maxLines != null && lines > c.maxLines ? `${lines} lines changed > ${c.maxLines}` : `${files.length ? files.join(', ') : 'no files'} · ${lines} lines`)
        break
      }
      case 'grader': {
        const ok = final.graders[c.name] === true
        set(`grader:${c.name}`, ok, ok ? `${c.name} passed` : `${c.name} failed`, !!c.soft)
        break
      }
      default: set(c.type, false, 'unknown check type')
    }
  }
  return { checks, pass: Object.values(checks).every((x) => x.pass || x.soft) }
}

/** Aggregate graded runs: per prompt and per check, per condition. */
export function summarizeOutcomes(results) {
  const out = {}
  for (const r of results.filter((x) => x.graded)) {
    const c = (out[r.condition] ??= { runs: 0, pass: 0, checks: {} })
    c.runs++; if (r.graded.pass) c.pass++
    for (const [k, v] of Object.entries(r.graded.checks)) {
      const s = (c.checks[`${r.id}/${k}`] ??= { n: 0, pass: 0, soft: !!v.soft })
      s.n++; if (v.pass) s.pass++
    }
  }
  return out
}
