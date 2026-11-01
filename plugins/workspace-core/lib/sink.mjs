// Event sink for the workspace-core mod: pure bookkeeping, no engine calls (the mod
// validator requires `$` to be spelled at each call site, so hooks do the `$.fs.write`).
// `$.fs.write` replaces a whole file, so each process writes its own segment files
// (<sid>.<run>.<seg>.jsonl) of at most SEGMENT_LINES lines; each write carries the
// segment's full body, and hooks chain writes so a later body is never overwritten by an
// earlier one.
import { SCHEMA, SEGMENT_LINES, projectKey, redactDeep } from './events.mjs'

export function createSink() {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const S = { run, dir: null, sid: null, root: null, seg: 0, lines: [], seq: 0, chain: Promise.resolve(), failures: 0 }

  /** Called from session.start with values the hook read through `$`. */
  function setup({ home, xdg, override, root, sid }) {
    S.root = root
    S.dir = `${override || `${xdg || `${home || ''}/.local/state`}/claude-workspace/events`}/${projectKey(root)}`
    setSid(sid)
  }

  /** A new session id (fresh load or /clear) starts a new file set. */
  function setSid(sid) {
    if (!sid || sid === S.sid) return
    const carry = S.sid == null ? S.lines : []   // rows recorded before setup belong to this session
    S.sid = sid; S.seg = 0; S.lines = carry; S.seq = carry.length
  }

  /** Record a row. Returns the write to perform ({path, body}) or null while not set up. */
  function record(ev, data = {}) {
    try {
      const row = JSON.stringify(redactDeep({ v: SCHEMA, t: Date.now(), sid: S.sid, run: S.run, seq: S.seq++, ev, ...data }))
      if (S.lines.length >= SEGMENT_LINES) { S.seg++; S.lines = [] }
      S.lines.push(row)
      if (!S.dir || !S.sid) return null
      return { path: `${S.dir}/${S.sid}.${S.run}.${String(S.seg).padStart(3, '0')}.jsonl`, body: S.lines.join('\n') + '\n' }
    } catch { S.failures++; return null }
  }

  const fail = () => { S.failures++ }

  return { setup, setSid, record, fail, state: S }
}

/**
 * Serialize a write produced by record(). `write` is a closure the hook builds around its own
 * `$.fs.write` call. Never rejects.
 */
export function flush(sink, w, write) {
  if (!w) return Promise.resolve()
  const S = sink.state
  S.chain = S.chain.then(() => write(w.path, w.body)).catch(() => { S.failures++ })
  return S.chain
}
