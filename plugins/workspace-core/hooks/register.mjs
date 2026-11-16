// workspace-core (Phase 2R): minimal usage evidence + Workspace Usage report.
//   - Records only the signals in plan §4.1 (skill loads/outcomes, injected-context markers,
//     request boundaries, model/effort per request, router view) to local JSONL.
//   - Adds one short system-prompt section asking for a "Workspace Usage" section on substantive tasks.
//   - Shows an engine-verified footer beneath the main-loop answer (turn.complete {text}); it is
//     never sent to the model. It compares the model's claims with observed skill events.
// Validator rules: literal event names, function-literal hooks, `$` spelled at each call site.
import { createSink, flush } from '../lib/sink.mjs'
import { errorRow, markerCounts, redact, short } from '../lib/events.mjs'
import { USAGE_INSTRUCTION, checksLine, createTracker, parseUsageSection } from '../lib/usage.mjs'
import { classify, contractText, isFollowUp, restoreText } from '../lib/contracts.mjs'
import { deniedSkills, trimListing } from '../lib/listing.mjs'
import { codeFile, decide, denyText, editTarget, gatedFile, statesRootCause } from '../lib/gates.mjs'
import { checksConfig, editCheckText, fillFile, outputTail, shouldStopCheck, stopBlockText } from '../lib/checks.mjs'
import { CLOSE_TEXT, CODE_CLASSES, activeLevel, hasClosingLine, injectedLevel, promptLevel, reminderText } from '../lib/ponytail.mjs'
import { contextTokens, decidePressure, hasExternalPressureHook, thresholdFrom } from '../lib/pressure.mjs'
import { executionNote } from '../lib/execution.mjs'
import { capRequest } from '../lib/subagent-cap.mjs'
import { checkCommand, safetyText } from '../lib/safety.mjs'
import { EXPLAIN_DIR, UNIT_RE, buildRecord, checkAfter, checkableEdit, citedPaths, exitFrom, feedbackText, isCommit, isVerification, newDecisions, nextUnitId, parseHunks, parseNumstat, parseTarget, recordText, validate, wordsFrom } from '../lib/explain.mjs'
import { OWNED, KARPATHY_HEADING, importsWorkspace } from '../lib/claude-md.mjs'
import { FILES, NUDGE_TEXT, appendBlock, staleSections, staleText, autoBlock, changedFiles, checkLine, headingsOf, injectText, matchSections, porcelainMap, preEditText, requestTitle, shouldNudge, maxLinesFrom, maxCharsFrom, parseSections, relPath, sessionStartText, snapshotBlock, stampOf, trimSession } from '../lib/md-memory.mjs'
import { changedPaths, mayWrite, snapshotMap } from '../lib/bash-edits.mjs'

const sink = createSink()
const tracker = createTracker()
const st = { model: null, effort: null, skills: 0, requests: 0 }
// Phase 4: per-request state for the root-cause gate. Reset on each human prompt; text is the
// model's visible main-loop text in this request (kept in memory only, never written to disk).
// Context pressure: the main loop's latest request size (tokens), and a note pending for the footer.
let ctx = { tokens: 0, pending: null }
// md-memory: context/decisions section ids each agent has seen this session ('main' or the subagent's id;
// reset at every SessionStart). A subagent starts without the main loop's context, so it gets the notes again.
let mem = { injected: new Map() }
const seenBy = (agent) => { const k = agent ?? 'main'; if (!mem.injected.has(k)) mem.injected.set(k, new Set()); return mem.injected.get(k) }
const MEMORY_TOOLS = new Set(['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const readText = async ($, p) => { try { return await $.fs.read(p) } catch { return '' } }
// Explain (lib/explain.mjs): facts for the next change record, kept in memory only. `since` is where the
// current unit's commands start; `attempts` counts validator runs per unit (feedback is given at most twice).
let ex = { commands: [], since: 0, lastEditAt: 0, requests: [], skills: [], attempts: new Map() }
const EXPLAIN_EXCLUDES = ['--', '.', `:(exclude)${EXPLAIN_DIR}`, ':(exclude).memory', ':(exclude).claude']
const SOURCE_EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Automatic memory, per request: files changed (project-relative), memory files Claude edited, where this request's
// commands start, the memory headings at its start, and whether it was logged / nudged already.
// Ponytail per request: reminded (the core rule was attached), edited (a source-code file was changed), closeAsked.
const freshPt = () => ({ reminded: false, edited: false, closeAsked: false })
const freshMem = (o = {}) => ({ edited: [], wrote: { session: false, decisions: false, context: false }, cmdStart: ex.commands.length, heads: { decisions: [], context: [] }, contextAt: null, staleAsked: false, sessionAt: null, gitAt: null, title: '', logged: false, nudged: false, ...o })
let req = { class: null, reason: null, text: '', last: '', denies: 0, released: false, gates: true, contracts: true, skills: [], mem: freshMem(), pt: freshPt() }
// Ponytail (lib/ponytail.mjs): its level as last announced in its own injected text, or set by the user's
// /ponytail <level> or "stop ponytail". null = not seen this session (not installed, or not injected yet).
let pt = { level: null }
// CW_OFF=1: workspace-core is inert for this session (demos, product runs): nothing is added to the conversation,
// nothing is held, the skill listing is not trimmed, no footer. The local event log still records (session.start
// carries off: true); the subagent cap stays. Read once per process.
let OFF = null
async function isOff($) {
  if (OFF === null) { try { OFF = (await $.env.get('CW_OFF')) === '1' } catch { OFF = false } }
  return OFF
}

// 1.0 M1 error policy (rule R4: fail open and loud). Every hook carries a `.catch` that records a `hook.error` row and
// returns `next(e)`: the engine's `next` there is replay-safe, so a failure before the hook's own `next()` runs the
// chain beneath once, and a failure after it returns what that call settled to (nothing runs twice). A part a hook
// guards itself (a try/catch around one feature) records the same row with `part`. The footer counts them.
// The engine asks one `.catch` per event for this module's hooks on it, so the three tool.call hooks record
// `tool.call` with the tool's name as the part.
const hookFailed = (hook, err, part) => { tracker.hookError(hook); return sink.record('hook.error', errorRow(hook, err, part)) }
// Test seam for the engine tests (tests/hook-errors.test.ts): CW_TEST_FAULT=<hook>:<before|after>[,...] (or *:<at>)
// throws in that hook before or after its `next()`. Read once per process; unset, it costs one env read.
let FAULT = null
async function fault($, hook, at) {
  if (FAULT === null) { try { FAULT = (await $.env.get('CW_TEST_FAULT')) ?? '' } catch { FAULT = '' } }
  if (FAULT && FAULT.split(',').some((f) => f === `${hook}:${at}` || f === `*:${at}`)) throw new Error(`injected fault (${hook}, ${at} next)`)
}
async function setupSink($) {
  sink.setup({
    home: await $.env.get('HOME'), xdg: await $.env.get('XDG_STATE_HOME'), override: await $.env.get('CW_EVENTS_DIR'),
    root: await $.session.root(), sid: await $.session.id(),
  })
}
// The check commands line (1.0 M1.5): shown under the footer once per session, and again only when the commands change.
let checksShown = null

// Ponytail's closing line, asked for once per request (classic.Stop), when the request changed source code and the
// answer has none. CW_PONYTAIL=0 turns the workspace's Ponytail driving off; CW_PONYTAIL_CLOSE=0 only this ask.
async function ponytailClose($, e) {
  const level = activeLevel(pt.level)
  if (!level || e?.stop_hook_active || !req.pt.edited || req.pt.closeAsked || hasClosingLine(req.last)) return null
  if ((await $.env.get('CW_PONYTAIL')) === '0' || (await $.env.get('CW_PONYTAIL_CLOSE')) === '0') return null
  req.pt.closeAsked = true
  tracker.ponytail({ asked: true })
  await flush(sink, sink.record('ponytail', { action: 'close-asked', level }), (p, b) => $.fs.write(p, b))
  return CLOSE_TEXT
}

// session.md caps: lines (CW_MEMORY_MAX_LINES, legacy MD_MEMORY_MAX_LINES) and characters (CW_MEMORY_MAX_CHARS).
async function sessionCaps($) {
  return [maxLinesFrom((await $.env.get('CW_MEMORY_MAX_LINES')) ?? (await $.env.get('MD_MEMORY_MAX_LINES'))), maxCharsFrom(await $.env.get('CW_MEMORY_MAX_CHARS'))]
}
const statusText = () =>
  `cw ${st.model ? st.model.replace(/^claude-/, '') : '?'}${st.effort ? `/${st.effort}` : ''} · skills ${st.skills} · req ${st.requests}`

// Explain: when the developer runs /explain, capture the change record by code and hand it to the skill.
// /ci (skills/ci): fixing a CI failure is a debugging request. A slash command skips prompt.submit's classifier,
// so the request starts here: the debug contract (systematic-debugging), Ponytail's rule when it is active, and
// the root-cause gate on source edits. (Called from the skill.prompt hook.)
async function ciPrompt($, e, r) {
  if (typeof r?.text !== 'string' || e.agentId !== undefined || (await isOff($))) return r
  const gates = (await $.env.get('CW_GATES')) !== '0'
  const contracts = (await $.env.get('CW_CONTRACTS')) !== '0'
  req = { class: 'debug', reason: 'ci', text: '', last: '', denies: 0, released: false, gates, contracts, skills: [e.skill], pt: freshPt(),
    // the memory snapshots prompt.submit took for this same prompt stay (the stale-notes check and the autolog compare against them)
    mem: freshMem({ cmdStart: req.mem.cmdStart, heads: req.mem.heads, contextAt: req.mem.contextAt, sessionAt: req.mem.sessionAt, gitAt: req.mem.gitAt, title: 'CI check and fix (/ci)' }) }
  const level = (await $.env.get('CW_PONYTAIL')) === '0' ? null : activeLevel(pt.level)
  const add = []
  if (contracts) add.push(contractText('debug', { ponytail: !!level, reason: 'ci' }))
  if (level) {
    add.push(reminderText(level))
    req.pt.reminded = true
    tracker.ponytail({ reminded: 'contract', level })
    await flush(sink, sink.record('ponytail', { action: 'remind', via: 'contract', level }), (p, b) => $.fs.write(p, b))
  }
  await flush(sink, sink.record('classify', { class: 'debug', reason: 'ci', contract: contracts }), (p, b) => $.fs.write(p, b))
  return add.length ? { ...r, text: `${r.text}\n\n${add.join('\n\n')}` } : r
}

// (Called from the skill.prompt hook: one unmatched hook per event.)
async function explainPrompt($, e, r) {
  if (e.pluginName !== 'workspace-core' || !/(^|:)explain$/.test(e.skill ?? '') || typeof r?.text !== 'string') return r
  if ((await $.env.get('CW_EXPLAIN')) === '0') return { ...r, text: `${r.text}\n\nExplain is turned off (CW_EXPLAIN=0). Tell the developer; write no file.` }
  const root = await $.session.root().catch(() => null)
  const target = parseTarget(r.text)
  if (!root || target?.invalid) return { ...r, text: `${r.text}\n\nCannot explain ${target?.invalid ? `"${target.invalid}" (not a commit name)` : 'here (no project root)'}. Tell the developer; write no file.` }
  const git = async (argv) => { try { const x = await $.process.run(['git', '-c', 'core.quotePath=false', ...argv], { cwd: root }); return x.exitCode === 0 ? x.stdout : null } catch { return null } }
  let base
  if (target) base = ['show', '--format=', '-M', target]
  else base = (await git(['rev-parse', '--verify', '-q', 'HEAD'])) !== null ? ['diff', '-M', 'HEAD'] : ['diff', '-M', '--cached']
  const numstat = await git([...base, '--numstat', ...EXPLAIN_EXCLUDES])
  if (numstat === null) return { ...r, text: `${r.text}\n\ngit could not read ${target ?? 'the changes'}. Tell the developer; write no file.` }
  const hunks = parseHunks(await git([...base, '-U0', ...EXPLAIN_EXCLUDES]))
  const diff = (await git([...base, '-U3', ...EXPLAIN_EXCLUDES])) ?? ''
  const decisions = newDecisions(await git([...base, '-U0', '--', '.memory/decisions.md']))
  const untracked = []
  if (!target) {
    const names = ((await git(['ls-files', '--others', '--exclude-standard', ...EXPLAIN_EXCLUDES])) ?? '').split('\n').filter(Boolean).slice(0, 50)
    for (const n of names) untracked.push({ path: n, lines: (await readText($, `${root}/${n}`)).split('\n').filter((l, i, a) => i < a.length - 1 || l).length })
  }
  let names = []
  try { names = (await $.fs.list(`${root}/${EXPLAIN_DIR}/records`)).map((x) => x.name) } catch {}
  const unit = nextUnitId(names)
  const rec = buildRecord({ unit, target, requests: ex.requests, numstat: parseNumstat(numstat), hunks, untracked, commands: ex.commands.slice(ex.since), lastEditAt: ex.lastEditAt, skills: ex.skills, decisions, closedAt: new Date().toISOString() })
  const rel = `${EXPLAIN_DIR}/records/${unit}.json`
  if (rec.files.length) {
    await $.fs.write(`${root}/${rel}`, JSON.stringify(rec, null, 2) + '\n')
    ex.since = ex.commands.length; ex.requests = []; ex.skills = []; ex.attempts.set(unit, 0)
    tracker.explain({ unit, files: rec.files.length })
  }
  await flush(sink, sink.record('explain', { action: 'record', unit: rec.files.length ? unit : null, target: rec.target, files: rec.files.length, commands: rec.commands.length, verified: rec.verifiedAfterLastEdit !== false }), (p, b) => $.fs.write(p, b))
  return { ...r, text: r.text + recordText(rec, rel, diff) }
}

// Explain: check a written explanation against its record (mechanical). Feedback rides on the tool result,
// at most twice per unit; nothing is ever blocked. Other source edits mark the time of the last edit.
// (Called from the root-cause gate's tool.call hook with the call's result.)
async function explainCheck($, e, r) {
  if (!SOURCE_EDIT_TOOLS.has(e.tool)) return r
  const path = e.file_path ?? e.notebook_path
  if (typeof path !== 'string' || r?.deny !== undefined || r?.isError === true) return r
  const m = UNIT_RE.exec(path)
  if (!m) { if (!/[\\/]\.(explain|memory|claude)[\\/]/.test(path)) ex.lastEditAt = Date.now(); return r }
  if ((await $.env.get('CW_EXPLAIN')) === '0') return r
  const root = await $.session.root().catch(() => null)
  const unit = m[1]
  let rec = null
  try { rec = JSON.parse(await $.fs.read(`${root}/${EXPLAIN_DIR}/records/${unit}.json`)) } catch { return r }
  const md = await readText($, path)
  const there = new Set()
  for (const p of citedPaths(md)) { try { if (await $.fs.exists(`${root}/${p}`)) there.add(p) } catch {} }
  const res = validate(md, rec, { maxWords: wordsFrom(await $.env.get('CW_EXPLAIN_WORDS')), exists: (p) => there.has(p) })
  const n = ex.attempts.get(unit) ?? 0
  ex.attempts.set(unit, n + 1)
  tracker.explain({ unit, passed: res.passed.length, total: res.passed.length + res.failed.length, failedRules: res.failed.map((f) => f.rule) })
  await flush(sink, sink.record('explain', { action: 'validate', unit, attempt: n + 1, passed: res.passed, failed: res.failed.map((f) => f.rule) }), (p, b) => $.fs.write(p, b))
  if (!res.failed.length || n >= 2) return r
  return { ...r, context: [...(r?.context ?? []), feedbackText(unit, res, n === 1)] }
}

// md-memory pre-edit hold: the first edit of a file whose context/decisions notes this agent has not seen is
// not applied; the notes come back as the reason and the retry goes through (CW_MEMORY_PREEDIT=0 turns it off).
// Reading the file first delivers the same notes without a hold (classic.PostToolUse below).
async function memoryHold($, e) {
  if (!SOURCE_EDIT_TOOLS.has(e.tool)) return null
  if ((await $.env.get('CW_MEMORY')) === '0' || (await $.env.get('CW_MEMORY_PREEDIT')) === '0') return null
  const root = await $.session.root().catch(() => null)
  const rel = relPath(root, e.file_path ?? e.notebook_path)
  if (!rel) return null
  const all = [
    ...parseSections(await readText($, `${root}/${FILES.context}`), 'context.md'),
    ...parseSections(await readText($, `${root}/${FILES.decisions}`), 'decisions.md'),
  ]
  const seen = seenBy(e.agentId)
  const hits = matchSections(all, rel, seen)
  if (!hits.length) return null
  for (const h of hits) seen.add(h.id)
  await flush(sink, sink.record('memory', { action: 'pre-edit', sections: hits.length, tool: e.tool, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
  return { deny: preEditText(rel, hits) }
}

// `git status` for the automatic memory (null when git is unavailable: then only file-tool edits count).
async function gitStatus($, root) {
  try { const x = await $.process.run(['git', '-c', 'core.quotePath=false', 'status', '--porcelain', '-uall'], { cwd: root }); return x.exitCode === 0 ? x.stdout : null } catch { return null }
}

// Bash edits (lib/bash-edits.mjs): git status, then the blob hash of every dirty file (at most 500).
async function dirtySnapshot($, root) {
  const st = await gitStatus($, root)
  if (st === null) return null
  const entries = [...porcelainMap(st)].filter(([p]) => !/^\.(memory|explain|claude)\//.test(p))
  const live = entries.filter(([, line]) => !/^(D.|.D)/.test(line)).map(([p]) => p).slice(0, 500)
  let hashes = []
  if (live.length) {
    try { const h = await $.process.run(['git', 'hash-object', '--', ...live], { cwd: root }); if (h.exitCode === 0) hashes = h.stdout.trim().split('\n') } catch {}
  }
  return snapshotMap(entries, live, hashes)
}
async function bashEdits($, e, root, before) {
  const after = await dirtySnapshot($, root)
  if (!after) return
  const files = changedPaths(before, after)
  if (!files.length) return
  for (const rel of files) {
    const f = `${root}/${rel}`
    if (e.agentId === undefined && gatedFile(f)) { req.pt.edited = true; req.pt.bashEdit = true }
    if (checkableEdit(f)) req.codeEditAt = Date.now()
    if (!req.mem.edited.includes(rel)) req.mem.edited.push(rel)
    if (!pendingChecks.includes(rel)) pendingChecks.push(rel)
  }
  ex.lastEditAt = Date.now()
  await flush(sink, sink.record('bash-edit', { files: files.length, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
}

// Opt-in check hooks (lib/checks.mjs): the commands from .claude/workspace.json, read once per process.
// CW_CHECKS=0 turns both off. A command runs with `sh -c` in the project root; $ calls do not count
// against the hook's 10 s budget, so a test suite may take up to the timeout.
let CHECKS = null
const pendingChecks = [] // files changed through Bash, edit-checked at that command's PostToolUse
async function checksFor($, root) {
  let off = false
  try { off = (await $.env.get('CW_CHECKS')) === '0' } catch {}
  if (off || !root) return { stop: null, edit: null }
  CHECKS ??= checksConfig(await readText($, `${root}/.claude/workspace.json`))
  return CHECKS
}
async function runCheck($, root, cmd, timeoutMs) {
  try {
    const x = await $.process.run(['sh', '-c', cmd], { cwd: root, timeoutMs })
    return { exit: x.exitCode, tail: outputTail(x.stdout, x.stderr) }
  } catch (err) { return { exit: null, status: /time/i.test(String(err?.message ?? err)) ? 'timeout' : 'error' } }
}
// Stop check: once per unchecked code edit, when no passing check ran after it; a failure is the Stop hook's block.
async function stopCheck($, root) {
  const { stop } = await checksFor($, root)
  if (!shouldStopCheck({ cmd: stop, codeEditAt: req.codeEditAt, checkedAt: req.stopCheckAt ?? 0, blocks: req.stopBlocks ?? 0, commands: ex.commands })) return null
  req.stopCheckAt = Date.now()
  const x = await runCheck($, root, stop, 600_000)
  const info = x.exit === null ? { status: x.status } : x.exit === 0 ? { status: 'passed' } : { status: 'failed', exit: x.exit }
  tracker.stopCheck(info)
  await flush(sink, sink.record('stop-check', info), (p, b) => $.fs.write(p, b))
  if (x.exit === null) return null
  req.checkNoted = true // the footer reports the stop check instead of the "no test ran" note
  if (x.exit === 0) { ex.commands = [...ex.commands, { cmd: stop, exit: 0, at: Date.now(), agent: false }]; return null }
  req.stopBlocks = (req.stopBlocks ?? 0) + 1
  req.stopExit = x.exit
  return stopBlockText(stop, x.exit, x.tail)
}
// Edit check: after a code edit (Edit tools, or files a Bash command changed), run on each file (at most 5 per call).
async function editCheck($, e) {
  const files = SOURCE_EDIT_TOOLS.has(e?.tool_name) ? [e.tool_input?.file_path ?? e.tool_input?.notebook_path]
    : e?.tool_name === 'Bash' ? pendingChecks.splice(0) : []
  if (!files.length) return []
  const root = await $.session.root().catch(() => null)
  const { edit } = await checksFor($, root)
  if (!edit || !root) return []
  const rels = [...new Set(files.map((f) => relPath(root, f)).filter((f) => f && codeFile(f) &&!/^\.(memory|explain|claude)\//.test(f)))].slice(0, 5)
  const cmds = edit.includes('{file}') ? rels.map((rel) => [rel, fillFile(edit, rel)]) : rels.length ? [[rels.join(', '), edit]] : []
  const out = []
  for (const [rel, cmd] of cmds) {
    const x = await runCheck($, root, cmd, 60_000)
    await flush(sink, sink.record('edit-check', { exit: x.exit, status: x.status ?? null, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    if (x.exit) out.push(editCheckText(cmd, rel, x.exit, outputTail(x.tail, '', 30, 3000)))
  }
  return out
}

// Automatic memory: note which files this request changed and which memory files Claude wrote itself.
async function memoryTrack($, e, r) {
  if (!SOURCE_EDIT_TOOLS.has(e.tool) || r?.deny !== undefined || r?.isError === true) return
  const path = String(e.file_path ?? e.notebook_path ?? '').replace(/\\/g, '/')
  for (const k of ['session', 'decisions', 'context']) if (path.endsWith(`/${FILES[k]}`) || path === FILES[k]) req.mem.wrote[k] = true
  const root = await $.session.root().catch(() => null)
  const rel = relPath(root, path)
  if (rel && !/^\.(explain|claude)\//.test(rel) && !req.mem.edited.includes(rel)) req.mem.edited.push(rel)
}

// Automatic memory at the end of a request (classic.Stop): first, once, the decisions nudge for a designed change
// (returned as the Stop hook's block, so Claude continues); then, once, the workspace's own session.md block
// when files changed and Claude wrote none. CW_MEMORY_NUDGE=0 / CW_MEMORY_AUTOLOG=0 turn each off.
async function memoryEnd($, e, root) {
  const m = req.mem
  if (m.logged) return null
  const files = m.gitAt === null ? m.edited : changedFiles(m.edited, m.gitAt, await gitStatus($, root))
  if (!files.length) return null
  const wroteSession = m.wrote.session || (m.sessionAt !== null && (await readText($, `${root}/${FILES.session}`)) !== m.sessionAt)
  const added = {
    decisions: headingsOf(await readText($, `${root}/${FILES.decisions}`)).filter((h) => !m.heads.decisions.includes(h)),
    context: headingsOf(await readText($, `${root}/${FILES.context}`)).filter((h) => !m.heads.context.includes(h)),
  }
  const designed = req.skills.some((s) => /(^|:)(brainstorming|writing-plans)$/.test(s))
  const recorded = m.wrote.decisions || m.wrote.context || added.decisions.length > 0 || added.context.length > 0
  if (!e?.stop_hook_active && (await $.env.get('CW_MEMORY_NUDGE')) !== '0' && shouldNudge({ cls: req.class, edited: true, designed, recorded, nudged: m.nudged })) {
    m.nudged = true
    await flush(sink, sink.record('memory', { action: 'nudge', class: req.class }), (p, b) => $.fs.write(p, b))
    return NUDGE_TEXT
  }
  // Stale notes: once per request, not after the design nudge (that one already asked for the notes). CW_MEMORY_STALE=0 turns it off.
  if (!m.nudged && !m.staleAsked && m.contextAt !== null && (await $.env.get('CW_MEMORY_STALE')) !== '0') {
    const stale = staleSections(m.contextAt, await readText($, `${root}/${FILES.context}`), files)
    if (stale.length) {
      m.staleAsked = true
      await flush(sink, sink.record('memory', { action: 'stale-ask', sections: stale.length }), (p, b) => $.fs.write(p, b))
      return staleText(stale)
    }
  }
  m.logged = true
  if (wroteSession || (await $.env.get('CW_MEMORY_AUTOLOG')) === '0') return null
  const lastEdit = ex.lastEditAt
  const check = [...ex.commands.slice(m.cmdStart)].reverse().find((c) => isVerification(checkLine(c.cmd)) && !/\.memory\//.test(checkLine(c.cmd)) && (!lastEdit || c.at > lastEdit)) ?? null
  const block = autoBlock({ stamp: stampOf(), cls: req.class, title: m.title, files, check: check && { cmd: redact(checkLine(check.cmd)), exit: check.exit }, added })
  const p = `${root}/${FILES.session}`
  await $.fs.write(p, appendBlock(await readText($, p), block))
  await flush(sink, sink.record('memory', { action: 'autolog', files: files.length, checked: !!check, recorded: added.decisions.length + added.context.length }), (p2, b) => $.fs.write(p2, b))
  return null
}

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    await fault($, 'session.start', 'before')
    const r = await next(e)
    await fault($, 'session.start', 'after')
    try {
      await setupSink($)
      const model = await $.session.model().catch(() => null)
      const w = sink.record('session.start', { cwd: e.cwd, root: sink.state.root, surface: e.surface ?? null, interactive: !!e.isInteractive, model, ...((await isOff($)) ? { off: true } : {}) })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
      $.ui.status(statusText())
    } catch (err) { sink.fail(); await flush(sink, hookFailed('session.start', err, 'setup'), (p, b) => $.fs.write(p, b)) }
    return r
  }).catch(async ($, e, next) => {
    if (!sink.state.dir) { try { await setupSink($) } catch {} }
    await flush(sink, hookFailed('session.start', next.error), (p, b) => $.fs.write(p, b))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await fault($, 'session.end', 'before')
    await flush(sink, sink.record('session.end', { reason: e.reason ?? null }), (p, b) => $.fs.write(p, b))
    const r = await next(e)
    await fault($, 'session.end', 'after')
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('session.end', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // One cached, session-scoped section (after the shared prefix, so the shared cache is untouched).
  on('prompt.compose', async ($, e, next) => {
    await fault($, 'prompt.compose', 'before')
    const r = await next(e)
    await fault($, 'prompt.compose', 'after')
    if (await isOff($)) return r
    return { ...r, sections: [...r.sections, { id: 'workspace-core:usage-report', text: USAGE_INSTRUCTION, scope: 'session' }] }
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('prompt.compose', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // Phase 3 (advise): classify the user's prompt locally and attach a short workflow contract as
  // model-only context. Only the class is recorded, never the prompt text.
  on('prompt.submit', async ($, e, next) => {
    await fault($, 'prompt.submit', 'before')
    const human = !e.command && !e.isMeta && ['composer', 'bridge', 'sdk'].includes(e.origin?.kind)
    if (!human || (await isOff($))) { const r0 = await next(e); await fault($, 'prompt.submit', 'after'); return r0 }
    const switched = promptLevel(e.text)
    if (switched) pt.level = switched
    ex.requests = [...ex.requests, short(e.text ?? '', 300)].slice(-10)
    const contracts = (await $.env.get('CW_CONTRACTS')) !== '0'
    const gates = (await $.env.get('CW_GATES')) !== '0'
    let c = classify(e.text)
    // A short confirmation ("yes lets do all three") continues the previous request: it inherits a code-changing class,
    // the skills already loaded, and a debug request's stated root cause (so the gate does not ask for it twice).
    const prev = req
    const followUp = !c.class && c.reason !== 'empty-or-command' && CODE_CLASSES.has(prev?.class) && isFollowUp(e.text) && (await $.env.get('CW_FOLLOW_UP')) !== '0'
    if (followUp) c = { class: prev.class, reason: 'follow-up' }
    const carried = followUp && prev.class === 'debug' && (prev.released || statesRootCause(prev.text))
    req = { class: c.class, reason: c.reason, text: '', last: '', denies: 0, released: carried, gates, contracts, skills: followUp ? [...prev.skills] : [], mem: freshMem({ title: requestTitle(e.text, redact) }), pt: freshPt() }
    const level = (await $.env.get('CW_PONYTAIL')) === '0' ? null : activeLevel(pt.level)
    if ((await $.env.get('CW_MEMORY')) !== '0') {
      const root = await $.session.root().catch(() => null)
      if (root) {
        req.mem.contextAt = await readText($, `${root}/${FILES.context}`)
        req.mem.heads = { decisions: headingsOf(await readText($, `${root}/${FILES.decisions}`)), context: headingsOf(req.mem.contextAt) }
        // Snapshots, so changes made through Bash count too (Claude often appends to .memory/ with `cat >>`).
        req.mem.sessionAt = await readText($, `${root}/${FILES.session}`)
        req.mem.gitAt = await gitStatus($, root)
      }
    }
    const add = []
    if (contracts) {
      const text = !c.class ? null
        : followUp ? restoreText(c.class, { invoked: req.skills, rootCauseStated: carried, ponytail: !!level, reason: c.reason, followUp: true })
        : contractText(c.class, { ponytail: !!level, reason: c.reason })
      await flush(sink, sink.record('classify', { class: c.class, reason: c.reason, contract: !!text }), (p, b) => $.fs.write(p, b))
      if (text) add.push(text)
    }
    // Ponytail's core rule rides with the contract of a request that changes code (other requests: at the first source edit).
    if (level && CODE_CLASSES.has(c.class)) {
      add.push(reminderText(level))
      req.pt.reminded = true
      tracker.ponytail({ reminded: 'contract', level })
      await flush(sink, sink.record('ponytail', { action: 'remind', via: 'contract', level }), (p, b) => $.fs.write(p, b))
    }
    // Phase 6 context pressure (built in; CW_CONTEXT_PRESSURE=0 disables; skipped when a user-level
    // context-pressure hook already adds the same note).
    // Context size: the engine's live window fill (the status line's figure; survives --resume, is absent
    // after /clear or compaction until the next response). Falls back to the last step seen in-process.
    let tokens = ctx.tokens
    try {
      const u = await $.session.usage()
      if (u?.context) tokens = typeof u.context.tokens === 'number' ? u.context.tokens : 0
    } catch { tokens = ctx.tokens }
    let hooksCfg = null
    if (tokens > 0) { try { hooksCfg = await $.settings.read({ key: 'hooks' }) } catch { hooksCfg = null } }
    const p = decidePressure({
      tokens,
      threshold: thresholdFrom(await $.env.get('CW_CONTEXT_PRESSURE_TOKENS'), await $.env.get('CONTEXT_PRESSURE_TOKENS')),
      disabled: (await $.env.get('CW_CONTEXT_PRESSURE')) === '0',
      external: hasExternalPressureHook(hooksCfg),
    })
    if (p) {
      add.push(p.note)
      ctx.pending = p.tokens
      await flush(sink, sink.record('pressure', { tokens: p.tokens }), (q, b) => $.fs.write(q, b))
    }
    const out = await (add.length ? next({ ...e, context: [...(e.context ?? []), ...add] }) : next(e))
    await fault($, 'prompt.submit', 'after')
    return out
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('prompt.submit', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // Phase 3 listing work: drop denied (uninvocable) skills from the model-facing skill listing.
  // The transcript keeps the engine's full record; only what the model reads changes.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    await fault($, 'prompt.attachment', 'before')
    const r = await next(e)
    await fault($, 'prompt.attachment', 'after')
    if (typeof r?.text !== 'string' || (await isOff($)) || (await $.env.get('CW_LISTING_TRIM')) === '0') return r
    const t = trimListing(r.text, deniedSkills(await $.settings.read({ key: 'permissions' })))
    await flush(sink, sink.record('listing', { before: t.before, after: t.after, removed: t.removed.length, agentId: e.agentId ?? null }), (p, b) => $.fs.write(p, b))
    return t.removed.length ? { ...r, text: t.text } : r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('prompt.attachment', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('turn.start', async ($, e, next) => {
    await fault($, 'turn.start', 'before')
    const r = await next(e)
    await fault($, 'turn.start', 'after')
    if (e.agentId === undefined) {
      st.requests++
      tracker.turnStart()
      if (ctx.pending) { tracker.pressure(ctx.pending); ctx.pending = null }
      try { sink.setSid(await $.session.id()) } catch {}
    }
    const w = sink.record('turn.start', { turnId: r?.turnId ?? e.turnId ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('turn.start', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('turn.step', async function* ($, e, next) {
    await fault($, 'turn.step', 'before')
    if (e.agentId === undefined) {
      const w = sink.record('turn.step', { turnId: e.turnId, index: e.index, model: e.model, effort: e.effort ?? null })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
      st.model = e.model; st.effort = e.effort ?? null; $.ui.status(statusText())
      req.step = `${e.turnId}:${e.index}` // the root-cause gate counts holds per step
      // Collect visible text as it streams (debug: a tool call later in the same response sees it), and the
      // request's usage from its stop chunk (context pressure).
      const debug = req.class === 'debug'
      req.last = '' // the latest step's visible text: at Stop, the final answer (Ponytail's closing line)
      for await (const c of next(e)) {
        if (c?.kind === 'text') req.last += c.text
        if (debug && c?.kind === 'text') req.text += c.text
        else if (c?.kind === 'stop' && c.usage) { const t = contextTokens(c.usage); if (t > 0) ctx.tokens = t }
        yield c
      }
      await fault($, 'turn.step', 'after')
      return // the last next(e)'s result stands
    }
    // Subagents: hold every request to at most Opus 5.5 at high effort (lib/subagent-cap.mjs).
    if ((await $.env.get('CW_SUBAGENT_CAP')) === '0') return yield* next(e)
    const cap = capRequest(e)
    if (!cap) return yield* next(e)
    if (e.index === 0) {
      const w = sink.record('subagent-cap', { agentId: e.agentId, from: cap.from, model: cap.model, effort: cap.effort ?? null })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
    }
    return yield* next(cap.effort === undefined ? { ...e, model: cap.model } : { ...e, model: cap.model, effort: cap.effort })
  }).catch(async function* ($, e, next) { await flush(sink, hookFailed('turn.step', next.error), (p, b) => $.fs.write(p, b)); return yield* next(e) })

  // Subagent cap at spawn: an explicit Fable pick becomes Opus 5.5 so the subagent's identity line matches
  // what serves it. No model given is left alone (the agent's own model may be cheaper); turn.step caps every request.
  on('agent.spawn', async ($, e, next) => {
    await fault($, 'agent.spawn', 'before')
    const cap = e.fork || (await $.env.get('CW_SUBAGENT_CAP')) === '0' || e.model === undefined ? null : capRequest({ model: e.model })
    const r = await (cap ? next({ ...e, model: cap.model }) : next(e))
    await fault($, 'agent.spawn', 'after')
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('agent.spawn', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // Phase 4 root-cause gate: hold the first source edit of a debug request until a root cause is stated.
  // Also runs Explain's check on edits (explainCheck below), after the call; a failed check never fails the call.
  on('tool.call', async ($, e, next) => {
    await fault($, 'tool.call', 'before')
    if (await isOff($)) return next(e)
    const after = async (r) => {
      await fault($, 'tool.call', 'after')
      if (e.agentId === undefined && r?.deny === undefined && r?.isError !== true && gatedFile(editTarget(e))) req.pt.edited = true
      // Check note (footer): the time of the last edit to code a test could cover (any agent; markup and styles left out).
      if (r?.deny === undefined && r?.isError !== true && checkableEdit(editTarget(e))) req.codeEditAt = Date.now()
      try { await memoryTrack($, e, r) } catch (err) { await flush(sink, hookFailed('tool.call', err, 'memory-track'), (p, b) => $.fs.write(p, b)) }
      try { return await explainCheck($, e, r) } catch (err) { await flush(sink, hookFailed('tool.call', err, 'explain-check'), (p, b) => $.fs.write(p, b)); return r }
    }
    let held = null
    try { held = await memoryHold($, e) } catch (err) { held = null; await flush(sink, hookFailed('tool.call', err, 'memory-hold'), (p, b) => $.fs.write(p, b)) }
    if (held) return held
    if (!req.gates || req.class !== 'debug') return after(await next(e))
    const d = decide(req, e)
    if (d.action === 'deny') {
      // The edits of one model step are one hold: only the first is counted (sameStep marks the rest).
      if (!d.sameStep) { req.denies++; req.deniedStep = req.step; tracker.gate('deny') }
      await flush(sink, sink.record('gate', { gate: 'root-cause', action: 'deny', tool: e.tool, n: req.denies, ...(d.sameStep ? { sameStep: true } : {}) }), (p, b) => $.fs.write(p, b))
      return { deny: denyText(d.file) }
    }
    if (d.reason && !req.released && e.agentId === undefined) {
      req.released = true // decided once per request; later edits are not re-checked
      tracker.gate('release', d.reason)
      await flush(sink, sink.record('gate', { gate: 'root-cause', action: 'release', reason: d.reason, afterDenies: req.denies }), (p, b) => $.fs.write(p, b))
    }
    return after(await next(e))
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('tool.call', next.error, `tool ${e.tool}`), (p, b) => $.fs.write(p, b)); return next(e) })

  on('turn.complete', async ($, e, next) => {
    await fault($, 'turn.complete', 'before')
    const r = await next(e)
    await fault($, 'turn.complete', 'after')
    const u = r?.usage ?? e.usage
    const main = e.agentId === undefined
    const report = main ? parseUsageSection(e.answer) : null
    if (main && req.pt.edited && activeLevel(pt.level) && e.reason === 'answer') {
      const present = hasClosingLine(e.answer)
      tracker.ponytail({ level: pt.level, closing: present })
      await flush(sink, sink.record('ponytail', { action: 'closing', present, level: pt.level }), (p, b) => $.fs.write(p, b))
    }
    // Check note (lib/explain.mjs checkAfter): footer only, never sent to Claude.
    if (main && req.codeEditAt && !req.checkNoted && e.reason === 'answer') {
      req.checkNoted = true
      const info = checkAfter(ex.commands, req.codeEditAt)
      if (info) {
        tracker.check(info)
        await flush(sink, sink.record('check', info), (p, b) => $.fs.write(p, b))
      }
    }
    // The stop check sent Claude back and a check passed since: the footer says so.
    if (main && req.stopBlocks && !req.stopFixed && e.reason === 'answer' && checkAfter(ex.commands, req.stopCheckAt) === null) {
      req.stopFixed = true
      const info = { status: 'fixed', exit: req.stopExit }
      tracker.stopCheck(info)
      await flush(sink, sink.record('stop-check', info), (p, b) => $.fs.write(p, b))
    }
    const ev = main ? tracker.finish(e.answer) : null
    const w = sink.record('turn.complete', {
      turnId: e.turnId, agentId: e.agentId ?? null, reason: e.reason ?? null,
      usage: u ? { model: u.model, in: u.input_tokens, out: u.output_tokens, cacheRead: u.cache_read_input_tokens, cacheWrite: u.cache_creation_input_tokens } : null,
      usageReport: report ? { present: report.present, claimed: report.applied } : undefined,
      footer: ev?.footer ?? undefined,
    })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    if (!main || e.reason !== 'answer' || (await isOff($))) return r
    // The active check commands, once per session (and again if they change): a teammate sees what runs through sh -c.
    let checks = null
    const line = checksLine(await checksFor($, await $.session.root().catch(() => null)))
    if (line && line !== checksShown) { checksShown = line; checks = line }
    const text = [ev?.footer, checks].filter(Boolean).join('\n')
    return text ? { ...r, text } : r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('turn.complete', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('skill.prompt', async ($, e, next) => {
    await fault($, 'skill.prompt', 'before')
    const r = await next(e)
    await fault($, 'skill.prompt', 'after')
    st.skills++
    tracker.skillPrompt(e.skill)
    if (e.agentId === undefined && e.skill && !req.skills.includes(e.skill)) req.skills.push(e.skill)
    if (e.skill && !/(^|:)explain$/.test(e.skill)) ex.skills = [...ex.skills, e.skill].slice(-30)
    const w = sink.record('skill.prompt', { skill: e.skill, pluginName: e.pluginName ?? null, source: e.source ?? null, agentId: e.agentId ?? null })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    $.ui.status(statusText())
    if (e.pluginName === 'workspace-core' && /(^|:)explain$/.test(e.skill ?? '')) { try { return await explainPrompt($, e, r) } catch (err) { await flush(sink, hookFailed('skill.prompt', err, 'explain'), (p, b) => $.fs.write(p, b)); return r } }
    if (e.pluginName === 'workspace-core' && /(^|:)ci$/.test(e.skill ?? '')) { try { return await ciPrompt($, e, r) } catch (err) { await flush(sink, hookFailed('skill.prompt', err, 'ci'), (p, b) => $.fs.write(p, b)); return r } }
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('skill.prompt', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await fault($, 'tool.call:Skill', 'before')
    const r = await next(e)
    await fault($, 'tool.call:Skill', 'after')
    const outcome = {
      denied: r?.deny !== undefined ? true : undefined,
      isError: r?.isError === true ? true : undefined,
      errorText: r?.isError || r?.deny !== undefined ? short(r.deny ?? r.text ?? '', 200) : undefined,
    }
    tracker.skillCall(e.skill ?? null, outcome)
    const w = sink.record('tool.call', { tool: 'Skill', skill: e.skill ?? null, agentId: e.agentId ?? null, ...outcome })
    await flush(sink, w, (p, b) => $.fs.write(p, b))
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('tool.call', next.error, `tool ${e.tool}`), (p, b) => $.fs.write(p, b)); return next(e) })

  // Safety check (lib/safety.mjs): refuse force-push, reset --hard, git clean -f, rm -rf on /, ~, . or .git, and Bash reads
  // of .env and key files. Every agent, and also under CW_OFF: it adds nothing to the conversation unless it refuses.
  // CW_SAFETY=0 turns it off. A failure in the check lets the command through (the deny rules still apply).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await fault($, 'tool.call:Bash:safety', 'before')
    let off = false
    try { off = (await $.env.get('CW_SAFETY')) === '0' } catch {}
    const hit = off || typeof e.command !== 'string' ? null : checkCommand(e.command)
    if (hit) {
      await flush(sink, sink.record('safety', { rule: hit.rule, agent: e.agentId !== undefined }), (p, b) => $.fs.write(p, b))
      return { deny: safetyText(hit) }
    }
    const r = await next(e)
    await fault($, 'tool.call:Bash:safety', 'after')
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('tool.call', next.error, `tool ${e.tool}`), (p, b) => $.fs.write(p, b)); return next(e) })

  // Explain: remember each Bash command and its exit code for the next change record; a successful
  // `git commit` gets a footer hint. Kept in memory only (never written unless /explain runs).
  // Edits made through Bash (lib/bash-edits.mjs): a command that may write is bracketed by two snapshots of the
  // dirty files, and the files it changed count like edits (Ponytail, memory, the check note, Explain).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    await fault($, 'tool.call:Bash', 'before')
    let root = null, before = null
    if (typeof e.command === 'string' && mayWrite(e.command) === 'yes' && (await $.env.get('CW_BASH_EDITS')) !== '0' && !(await isOff($))) {
      root = await $.session.root().catch(() => null)
      if (root) before = await dirtySnapshot($, root).catch(async (err) => { await flush(sink, hookFailed('tool.call', err, 'bash-edits'), (p, b) => $.fs.write(p, b)); return null })
    }
    const r = await next(e)
    await fault($, 'tool.call:Bash', 'after')
    if (before && r?.deny === undefined) { try { await bashEdits($, e, root, before) } catch (err) { await flush(sink, hookFailed('tool.call', err, 'bash-edits'), (p, b) => $.fs.write(p, b)) } }
    if (typeof e.command !== 'string') return r
    const exit = exitFrom(r)
    if (exit === null) return r
    ex.commands = [...ex.commands, { cmd: e.command, exit, at: Date.now(), agent: e.agentId !== undefined }]
    if (ex.commands.length > 200) { const drop = ex.commands.length - 200; ex.commands = ex.commands.slice(drop); ex.since = Math.max(0, ex.since - drop) }
    if (exit === 0 && e.agentId === undefined && isCommit(e.command) && (await $.env.get('CW_EXPLAIN')) !== '0') tracker.explain({ commit: true })
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('tool.call', next.error, `tool ${e.tool}`), (p, b) => $.fs.write(p, b)); return next(e) })

  on('session.append', async ($, e, next) => {
    await fault($, 'session.append', 'before')
    const r = await next(e)
    await fault($, 'session.append', 'after')
    if (e.door === 'hook-context' && e.origin?.kind === 'hook') {
      const content = e.message?.content
      const len = typeof content === 'string' ? content.length : JSON.stringify(content ?? '').length
      const markers = markerCounts(content)
      const level = markers.ponytail ? injectedLevel(content) : null
      if (level && pt.level !== level) {
        pt.level = level
        await flush(sink, sink.record('ponytail', { action: 'level', level }), (p, b) => $.fs.write(p, b))
      }
      tracker.injection(markers)
      const w = sink.record('injection', { hookEvent: e.origin.event ?? null, len, markers })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('session.append', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('state.set', async ($, e, next) => {
    await fault($, 'state.set', 'before')
    const r = await next(e)
    await fault($, 'state.set', 'after')
    if (e.plugin === 'router' && e.key === 'view' && e.value) {
      const v = e.value
      const w = sink.record('router.view', {
        phase: v.phase ?? null, mode: v.mode ?? null, nativeModel: v.nativeModel ?? null, selectedModel: v.selectedModel ?? null,
        actualModel: v.actualModel ?? null, tier: v.tier ?? null, effort: v.effort ?? null, reason: v.reason ?? null, error: v.error ?? null,
      })
      await flush(sink, w, (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('state.set', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // Phase 4 compaction restore: the contract rode on the request's prompt, which a compaction summary can
  // drop. After a compaction of the main conversation, re-attach it (with what is already done) as SessionStart
  // context, the engine's own channel for post-compaction context. Gate state is in memory and survives as is.
  on('classic.SessionStart', async ($, e, next) => {
    await fault($, 'classic.SessionStart', 'before')
    const r = await next(e)
    await fault($, 'classic.SessionStart', 'after')
    if (await isOff($)) return r
    if (!e.agent_id && ['clear', 'compact', 'startup'].includes(e?.source)) { ctx.tokens = 0; ctx.pending = null }
    // Skills loaded before a /clear or compaction are no longer known to be in context (footer: "loaded earlier").
    if (!e.agent_id && ['clear', 'compact'].includes(e?.source)) {
      tracker.contextReset()
      await flush(sink, sink.record('context.reset', { source: e.source }), (p, b) => $.fs.write(p, b))
    }
    const add = []
    // Plan execution method (lib/execution.mjs): stated on every main-conversation SessionStart, so it survives /clear and compaction.
    const exec = executionNote({ disabled: (await $.env.get('CW_PLAN_EXECUTION')) === '0', agent: !!e.agent_id })
    if (exec) add.push(exec)
    // CLAUDE.md integration: is the workspace file imported here (CLAUDE.md or CLAUDE.local.md)? Then it already
    // carries the md-memory rules and the Karpathy guidelines; record that (the guidelines have no skill event).
    const root = !e.agent_id ? await $.session.root().catch(() => null) : null
    let viaClaudeMd = false
    if (root) {
      viaClaudeMd = importsWorkspace(await readText($, `${root}/CLAUDE.md`)) || importsWorkspace(await readText($, `${root}/CLAUDE.local.md`))
      const karpathy = viaClaudeMd && (await readText($, `${root}/${OWNED}`)).includes(KARPATHY_HEADING)
      if (karpathy) tracker.injection({ claudeMd: 1 })
      if (e?.source === 'startup' || e?.source === 'resume') await flush(sink, sink.record('claude-md', { imported: viaClaudeMd, karpathy }), (p, b) => $.fs.write(p, b))
    }
    // md-memory: the rules (unless CLAUDE.md has them) plus session.md, on every main-conversation start (so /clear and /compact reload it).
    if (!e.agent_id && (await $.env.get('CW_MEMORY')) !== '0') {
      mem.injected = new Map()
      const text = root ? sessionStartText(await readText($, `${root}/${FILES.session}`), { rules: !viaClaudeMd }) : null
      if (text) {
        add.push(text)
        await flush(sink, sink.record('memory', { action: 'session-start', source: e?.source ?? null, len: text.length }), (p, b) => $.fs.write(p, b))
      }
    }
    if (e?.source === 'compact' && !e.agent_id && req.contracts && req.class) {
      const text = restoreText(req.class, { invoked: req.skills, rootCauseStated: req.class === 'debug' && statesRootCause(req.text), ponytail: !!activeLevel(pt.level) && (await $.env.get('CW_PONYTAIL')) !== '0', reason: req.reason })
      if (text) {
        add.push(text)
        await flush(sink, sink.record('compact.restore', { class: req.class, len: text.length, invoked: req.skills.length }), (p, b) => $.fs.write(p, b))
      }
    }
    if (!add.length) return r
    return { ...r, additionalContext: [...(r?.additionalContext ?? []), ...add] }
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('classic.SessionStart', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('classic.PostToolUse', async ($, e, next) => {
    await fault($, 'classic.PostToolUse', 'before')
    let r = await next(e)
    await fault($, 'classic.PostToolUse', 'after')
    if (await isOff($)) return r
    // Ponytail's core rule for a request with no code contract: once, after its first source edit in the main loop.
    const level = activeLevel(pt.level)
    // A source file changed through Bash counts too (set by bashEdits; delivered with this or the next tool result).
    const sourceEdit = (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(e?.tool_name) && gatedFile(e.tool_input?.file_path ?? e.tool_input?.notebook_path)) || req.pt.bashEdit
    if (level && !e?.agent_id && !req.pt.reminded && sourceEdit && (await $.env.get('CW_PONYTAIL')) !== '0') {
      req.pt.reminded = true
      tracker.ponytail({ reminded: 'edit', level })
      await flush(sink, sink.record('ponytail', { action: 'remind', via: 'edit', level }), (p, b) => $.fs.write(p, b))
      r = { ...r, additionalContext: [...(r?.additionalContext ?? []), reminderText(level)] }
    }
    // Edit check (opt-in): a failure is added next to the tool result (PostToolUse cannot undo the edit).
    let fails = []
    try { fails = await editCheck($, e) } catch (err) { fails = []; await flush(sink, hookFailed('classic.PostToolUse', err, 'edit-check'), (p, b) => $.fs.write(p, b)) }
    if (fails.length) r = { ...r, additionalContext: [...(r?.additionalContext ?? []), ...fails] }
    if (e?.tool_name === 'Skill') {
      tracker.skillLoaded(e.tool_input?.skill ?? null)
      await flush(sink, sink.record('skill.loaded', { skill: e.tool_input?.skill ?? null, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
    }
    // md-memory: inject the context.md / decisions.md sections whose paths match the touched file, once per session.
    if (MEMORY_TOOLS.has(e?.tool_name) && (await $.env.get('CW_MEMORY')) !== '0') {
      const root = await $.session.root().catch(() => null)
      const rel = relPath(root, e.tool_input?.file_path ?? e.tool_input?.notebook_path)
      if (rel) {
        const all = [
          ...parseSections(await readText($, `${root}/${FILES.context}`), 'context.md'),
          ...parseSections(await readText($, `${root}/${FILES.decisions}`), 'decisions.md'),
        ]
        const seen = seenBy(e.agent_id)
        const hits = matchSections(all, rel, seen)
        if (hits.length) {
          for (const h of hits) seen.add(h.id)
          await flush(sink, sink.record('memory', { action: 'inject', sections: hits.length, agentId: e.agent_id ?? null }), (p, b) => $.fs.write(p, b))
          return { ...r, additionalContext: [...(r?.additionalContext ?? []), injectText(rel, hits)] }
        }
      }
    }
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('classic.PostToolUse', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // md-memory: an automatic compaction never leaves session.md stale (mechanical snapshot, then trim).
  on('classic.PreCompact', async ($, e, next) => {
    await fault($, 'classic.PreCompact', 'before')
    const r = await next(e)
    await fault($, 'classic.PreCompact', 'after')
    if (e?.trigger !== 'auto' || (await isOff($)) || (await $.env.get('CW_MEMORY')) === '0') return r
    const root = await $.session.root().catch(() => null)
    if (!root) return r
    const git = async (argv) => { try { const x = await $.process.run(['git', ...argv], { cwd: root }); return x.exitCode === 0 ? x.stdout.trim() : '' } catch { return '' } }
    const block = snapshotBlock({ stamp: stampOf(), trigger: e.trigger, lastCommit: await git(['log', '-1', '--format=%h %s']), porcelain: await git(['status', '--porcelain']) })
    const [max, chars] = await sessionCaps($)
    await $.fs.write(`${root}/${FILES.session}`, trimSession(appendBlock(await readText($, `${root}/${FILES.session}`), block), max, chars))
    await flush(sink, sink.record('memory', { action: 'snapshot' }), (p, b) => $.fs.write(p, b))
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('classic.PreCompact', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  // Stop check first (opt-in; a failing check sends Claude back before anything else is asked).
  // md-memory: keep session.md within its cap after every turn (oldest blocks dropped first).
  on('classic.Stop', async ($, e, next) => {
    await fault($, 'classic.Stop', 'before')
    const r = await next(e)
    await fault($, 'classic.Stop', 'after')
    if (await isOff($)) return r
    const root = await $.session.root().catch(() => null)
    let failed = null
    if (root) { try { failed = await stopCheck($, root) } catch (err) { failed = null; await flush(sink, hookFailed('classic.Stop', err, 'stop-check'), (p, b) => $.fs.write(p, b)) } }
    if (failed) return { ...r, block: failed }
    if ((await $.env.get('CW_MEMORY')) === '0') { const ask = await ponytailClose($, e).catch(async (err) => { await flush(sink, hookFailed('classic.Stop', err, 'ponytail-close'), (p, b) => $.fs.write(p, b)); return null }); return ask ? { ...r, block: ask } : r }
    if (!root) return r
    const p = `${root}/${FILES.session}`
    let nudge = null
    try { nudge = await memoryEnd($, e, root) } catch (err) { nudge = null; await flush(sink, hookFailed('classic.Stop', err, 'memory-end'), (p, b) => $.fs.write(p, b)) }
    if (nudge) return { ...r, block: nudge }
    let ask = null
    try { ask = await ponytailClose($, e) } catch (err) { ask = null; await flush(sink, hookFailed('classic.Stop', err, 'ponytail-close'), (p, b) => $.fs.write(p, b)) }
    const text = await readText($, p)
    const [max, chars] = await sessionCaps($)
    const out = trimSession(text, max, chars)
    if (text && out !== text) {
      await $.fs.write(p, out)
      await flush(sink, sink.record('memory', { action: 'trim' }), (p2, b) => $.fs.write(p2, b))
    }
    return ask ? { ...r, block: ask } : r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('classic.Stop', next.error), (p, b) => $.fs.write(p, b)); return next(e) })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await fault($, 'classic.PostToolUseFailure', 'before')
    const r = await next(e)
    await fault($, 'classic.PostToolUseFailure', 'after')
    if (e?.tool_name === 'Skill') {
      tracker.skillFailed(e.tool_input?.skill ?? null)
      await flush(sink, sink.record('skill.failed', { skill: e.tool_input?.skill ?? null, error: short(e.error ?? '', 200) }), (p, b) => $.fs.write(p, b))
    }
    return r
  }).catch(async ($, e, next) => { await flush(sink, hookFailed('classic.PostToolUseFailure', next.error), (p, b) => $.fs.write(p, b)); return next(e) })
}
