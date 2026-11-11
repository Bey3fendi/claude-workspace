// Explain (slim): on demand, the developer gets a short explanation of a change, grounded in facts
// captured by code. workspace-core builds the change record (git diff, commands that ran with their exit
// codes, skills, new decisions); the model writes .explain/units/<id>.md from it; the validator below
// checks the file mechanically. No gates: a failed check is reported once and in the footer, never blocks.
// Pure logic; the mod (hooks/register.mjs) does the I/O.
export const EXPLAIN_DIR = '.explain'
export const EXPLAIN_ALLOWS = [`Edit(${EXPLAIN_DIR}/**)`]
export const UNIT_RE = /(?:^|[\\/])\.explain[\\/]units[\\/](u-\d{4,})\.md$/
export const SECTIONS = ['## What changed', '## Why', '## How it works now', '## Not done / not tested', '## Verify yourself', '## Start reading at']
export const BANNED = ['robust', 'seamless', 'seamlessly', 'leverage', 'leverages', 'leveraging', 'comprehensive', 'various', 'enhance', 'enhanced', 'enhances', 'streamline', 'streamlined', 'it should be noted', 'in order to', 'as mentioned']
export const DEFAULT_WORDS = 300
const MAX_COMMANDS = 20
const VERIFY_RE = /\b(test|tests|jest|vitest|mocha|pytest|ctest|tox|cargo (test|build|check|clippy)|go (test|build|vet)|tsc|eslint|ruff|mypy|flake8|make|gradle|mvn|dotnet (test|build)|node --test|npm (run )?(test|build|lint|check)|pnpm (run )?(test|build|lint)|yarn (test|build|lint)|bun test|claude plugin (test|validate))\b/
// Commands that only look around; left out of the record so it stays short.
const QUIET_RE = /^\s*(ls|cat|head|tail|pwd|echo|grep|rg|find|wc|sed -n|git (status|log|diff|show|branch|rev-parse))\b/

export const isVerification = (cmd) => VERIFY_RE.test(cmd)
/** A pipe outside quotes (not `||`); with `set -o pipefail` the exit code is honest again. */
export const isPiped = (cmd) => !/pipefail/.test(cmd) && /(^|[^|])\|(?!\|)/.test(cmd.replace(/'[^']*'|"[^"]*"/g, ''))
export const exitFrom = (r) => {
  if (r?.deny !== undefined) return null
  if (r?.isError !== true) return 0
  const m = /Exit code (\d+)/.exec(r?.text ?? '')
  return m ? Number(m[1]) : 1
}
export const isCommit = (cmd) => /\bgit\b[^|;&]*\bcommit\b/.test(cmd) && !/--dry-run/.test(cmd)

/** The target in the skill's text: the line `Target: <args>` (empty: the uncommitted changes). */
export function parseTarget(text) {
  const m = /^Target:[ \t]*(.*)$/m.exec(text ?? '')
  const t = (m?.[1] ?? '').trim()
  if (!t || t === '$ARGUMENTS') return null
  return /^[\w./~^@{}-]{1,80}$/.test(t) ? t : { invalid: t }
}

/** `git diff --numstat` → [{ path, added, removed }] (binary files: null counts). Renames keep the new path. */
export function parseNumstat(text) {
  const out = []
  for (const line of (text ?? '').split('\n')) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line)
    if (!m) continue
    let path = m[3]
    const r = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path) ?? null
    if (r) path = `${r[1]}${r[3]}${r[4]}`.replace(/\/\//g, '/')
    else if (path.includes(' => ')) path = path.split(' => ')[1]
    out.push({ path, added: m[1] === '-' ? null : Number(m[1]), removed: m[2] === '-' ? null : Number(m[2]) })
  }
  return out
}

/** `git diff -U0` → { path: [[start, end], ...] } on the new side (pure deletions are left out). */
export function parseHunks(text) {
  const out = {}
  let cur = null
  for (const line of (text ?? '').split('\n')) {
    const f = /^\+\+\+ (?:b\/)?(.+)$/.exec(line)
    if (f) { cur = f[1] === '/dev/null' ? null : f[1]; if (cur) out[cur] ??= []; continue }
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (h && cur) {
      const start = Number(h[1]), n = h[2] === undefined ? 1 : Number(h[2])
      if (n > 0) out[cur].push([start, start + n - 1])
    }
  }
  return out
}

/** New `## ` headings in decisions.md's diff (added lines). */
export const newDecisions = (diffText) => (diffText ?? '').split('\n').filter((l) => /^\+## /.test(l)).map((l) => l.slice(4).trim())

export function nextUnitId(names) {
  let max = 0
  for (const n of names ?? []) { const m = /^u-(\d+)\.(md|json)$/.exec(n); if (m) max = Math.max(max, Number(m[1])) }
  return `u-${String(max + 1).padStart(4, '0')}`
}

const trimCmd = (c) => (c.length > 200 ? c.slice(0, 197) + '...' : c)

/** The change record: facts only, every field from code. */
export function buildRecord({ unit, target, requests, numstat, hunks, untracked, commands, lastEditAt, skills, decisions, closedAt }) {
  const files = numstat.map((f) => ({ ...f, hunks: hunks[f.path] ?? [] }))
  for (const u of untracked ?? []) if (!files.some((f) => f.path === u.path)) files.push({ path: u.path, added: u.lines, removed: 0, hunks: u.lines > 0 ? [[1, u.lines]] : [], new: true })
  const cmds = (commands ?? []).filter((c) => !QUIET_RE.test(c.cmd)).slice(-MAX_COMMANDS).map((c) => ({ cmd: trimCmd(c.cmd), exit: c.exit, at: new Date(c.at).toISOString(), ...(isPiped(c.cmd) ? { piped: true } : {}), ...(c.agent ? { subagent: true } : {}) }))
  // A piped command's exit code is its last stage's (`npm test | tail` exits 0 when tests fail): such a run
  // is named with that caveat, never as plain proof.
  const verifiedBy = target ? null : [...(commands ?? [])].reverse().find((c) => c.exit === 0 && isVerification(c.cmd) && (!lastEditAt || c.at > lastEditAt))
  const verifiedText = verifiedBy && (isPiped(verifiedBy.cmd) ? `${trimCmd(verifiedBy.cmd)} (piped: exit 0 is the last stage's, not the test's)` : trimCmd(verifiedBy.cmd))
  return {
    unit, closedAt, closedBy: 'manual',
    target: target ?? 'uncommitted changes',
    request: (requests ?? []).slice(-3),
    files, commands: cmds,
    verifiedAfterLastEdit: target ? 'n/a (a commit)' : verifiedText || false,
    skills: [...new Set(skills ?? [])],
    decisions: decisions ?? [],
  }
}

// ---- validator --------------------------------------------------------------------------------------
const stripFences = (md) => md.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '')
const stripDetails = (md) => md.replace(/<details>[\s\S]*?<\/details>/g, '')
const words = (s) => (s.match(/[A-Za-z0-9][\w'’./:-]*/g) ?? []).length
const sentences = (s) => s.replace(/`[^`]*`/g, 'x').split(/(?<=[.!?])\s+(?=[A-Z0-9`*"(])/).map((x) => x.trim()).filter(Boolean)
const norm = (c) => c.replace(/\s+/g, ' ').trim()

const CITE_RE = /([\w@~.+-]+(?:\/[\w@~.+-]+)*\.[\w]+):(\d+)(?:-(\d+))?/g
/** Paths cited as path:line outside code blocks (the mod checks which of them exist). */
export const citedPaths = (md) => [...new Set([...stripFences(md ?? '').matchAll(CITE_RE)].map((m) => m[1]).filter((p) => !/^https?$/.test(p)))]

function inShort(md) {
  const m = /\*\*In short:\*\*([\s\S]*?)(?:\n\s*\n|\n## |$)/.exec(md)
  return m ? m[1].trim() : null
}

/**
 * Check an explanation against its change record. `exists(path)` answers whether a cited file that is not
 * part of the change exists (marked "(context)"). Returns { passed: [rule], failed: [{ rule, detail }] }.
 */
export function validate(md, record, { maxWords = DEFAULT_WORDS, exists = () => true } = {}) {
  const passed = [], failed = []
  const check = (rule, problems) => (problems.length ? failed.push({ rule, detail: problems.slice(0, 5).join('; ') }) : passed.push(rule))
  const prose = stripFences(md)

  // structure: In short first, then the sections in order
  {
    const p = []
    const s = inShort(md)
    if (s == null) p.push('missing "**In short:**"')
    else {
      if (sentences(s).length > 3) p.push(`"In short" has ${sentences(s).length} sentences (max 3)`)
      if (words(s) > 60) p.push(`"In short" has ${words(s)} words (max 60)`)
    }
    let at = s == null ? 0 : md.indexOf('**In short:**')
    for (const h of SECTIONS) {
      const i = md.indexOf(`\n${h}`, at)
      if (i < 0) p.push(md.includes(`\n${h}`) ? `"${h}" out of order` : `missing "${h}"`)
      else at = i
    }
    check('structure', p)
  }

  // grounding (files): every path:line cited is in the change and overlaps a changed range, or is marked (context)
  {
    const p = []
    const byPath = new Map(record.files.map((f) => [f.path, f]))
    for (const line of prose.split('\n')) {
      for (const m of line.matchAll(CITE_RE)) {
        const [cite, path, a, b] = m
        if (/^https?$/.test(path)) continue
        const lo = Number(a), hi = Number(b ?? a)
        const f = byPath.get(path) ?? [...byPath.values()].find((x) => x.path.endsWith(`/${path}`))
        const context = /\(context\)/.test(line)
        if (f) {
          if (context) continue
          if (!f.hunks.some(([s, e]) => lo <= e + 3 && hi >= s - 3)) p.push(`${cite} is outside the changed lines of ${f.path}`)
        } else if (!context) p.push(`${cite} is not part of this change (mark it "(context)" if it is background)`)
        else if (!exists(path)) p.push(`${cite} does not exist`)
      }
    }
    check('grounding-files', p)
  }

  // grounding (commands): every "ran `cmd`" appears in the record, with the same exit code when one is stated
  {
    const p = []
    for (const m of prose.matchAll(/\bran `([^`]+)`(?:\s*\(exit (\d+)\))?/g)) {
      const want = norm(m[1])
      const hit = record.commands.filter((c) => norm(c.cmd) === want || norm(c.cmd).includes(want))
      if (!hit.length) p.push(`\`${m[1]}\` is not in the recorded commands`)
      else if (m[2] !== undefined && !hit.some((c) => c.exit === Number(m[2]))) p.push(`\`${m[1]}\` exited ${hit.map((c) => c.exit).join('/')}, not ${m[2]}`)
    }
    check('grounding-commands', p)
  }

  // coverage: every changed file is named somewhere (the Details section counts)
  check('coverage', record.files.filter((f) => !md.includes(f.path)).map((f) => `${f.path} is never mentioned`))

  // honesty: "Not done / not tested" has content; no pass/tested claims without a successful recorded command
  {
    const p = []
    const nd = /\n## Not done \/ not tested[ \t]*\n([\s\S]*?)(?=\n## |$)/.exec(md)
    if (nd && !nd[1].trim()) p.push('"Not done / not tested" is empty (write "nothing known" if so)')
    const claims = /\b(all (tests )?pass|tests? pass(es|ed)?|passing|tested|verified)\b/i.exec(stripDetails(prose).replace(/\n## Not done \/ not tested[\s\S]*?(?=\n## |$)/, ''))
    if (claims && !record.commands.some((c) => c.exit === 0)) p.push(`says "${claims[0]}" but no command succeeded in the record`)
    check('honesty', p)
  }

  // readability: banned phrases, sentences over 35 words (outside code)
  {
    const p = []
    const text = prose.replace(/`[^`]*`/g, 'x').toLowerCase()
    for (const b of BANNED) if (new RegExp(`\\b${b}\\b`).test(text)) p.push(`"${b}"`)
    for (const l of prose.split('\n')) {
      if (/^\s*(#|\||<)/.test(l)) continue
      for (const s of sentences(l)) if (words(s) > 35) p.push(`a ${words(s)}-word sentence: "${s.slice(0, 50)}..."`)
    }
    check('readability', p)
  }

  // diagrams: at most one
  {
    const n = (md.match(/^```mermaid/gm) ?? []).length
    check('diagrams', n > 1 ? [`${n} diagrams (max 1)`] : [])
  }

  // length: words outside <details> and code
  {
    const n = words(stripFences(stripDetails(md)).replace(/<!--[\s\S]*?-->/g, ''))
    check('length', n > maxWords ? [`${n} words outside <details> (max ${maxWords})`] : [])
  }
  return { passed, failed }
}

export const wordsFrom = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 100 && n <= 2000 ? n : DEFAULT_WORDS }

export function feedbackText(unit, res, final) {
  const list = res.failed.map((f) => `- ${f.rule}: ${f.detail}`).join('\n')
  return final
    ? `[workspace: explain] ${unit} still fails ${res.failed.length} check(s); it is kept as is and the footer says so:\n${list}`
    : `[workspace: explain] ${unit} fails ${res.failed.length} of ${res.failed.length + res.passed.length} mechanical checks. Fix them in the file (one pass), then show the developer the "In short" section and the file path:\n${list}`
}

/** The text appended to the skill's prompt: the record, and where to write. */
export const DIFF_CAP = 12000
/** The diff for the prompt (old and new lines, so the model never needs to run git), capped. */
export function diffExcerpt(diff, cap = DIFF_CAP) {
  const d = (diff ?? '').trim()
  if (!d) return ''
  if (d.length <= cap) return d
  const cut = d.lastIndexOf('\n', cap)
  return `${d.slice(0, cut > 0 ? cut : cap)}\n... (diff truncated at ${cap} characters: read the changed files for the rest)`
}

export function recordText(rec, relRecord, diff = '') {
  if (!rec.files.length) return `\n\n## Change record\nNo changes found for ${rec.target}. Tell the developer there is nothing to explain; write no file.`
  const d = diffExcerpt(diff)
  const fence = d.includes('```') ? '~~~~' : '```'
  return `\n\n## Change record (captured by workspace-core: explain only these facts)\nUnit: ${rec.unit} · write the explanation to \`${EXPLAIN_DIR}/units/${rec.unit}.md\` · record saved at \`${relRecord}\`\n\`\`\`json\n${JSON.stringify(rec, null, 1)}\n\`\`\`` +
    (d ? `\n\n## Diff (git, 3 lines of context; new files are not in it: read them)\n${fence}diff\n${d}\n${fence}` : '')
}
