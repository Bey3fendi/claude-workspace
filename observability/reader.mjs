// Reads the mod's JSONL segments: <eventsDir>/<projectKey>/<sid>.<run>.<seg>.jsonl
// Files are rewritten whole by the mod, so a file is re-parsed when its size or mtime changes.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const NAME = /^(.+)\.([a-z0-9]+)\.(\d{3})\.jsonl$/

export function createReader(eventsDir) {
  const cache = new Map() // path -> { size, mtimeMs, rows }

  function scan() {
    const files = []
    let projects = []
    try { projects = readdirSync(eventsDir, { withFileTypes: true }).filter((d) => d.isDirectory()) } catch { return files }
    for (const p of projects) {
      let names = []
      try { names = readdirSync(join(eventsDir, p.name)) } catch { continue }
      for (const n of names) {
        const m = n.match(NAME)
        if (!m) continue
        const path = join(eventsDir, p.name, n)
        let st
        try { st = statSync(path) } catch { continue }
        files.push({ path, projectKey: p.name, sid: m[1], run: m[2], seg: Number(m[3]), size: st.size, mtimeMs: st.mtimeMs })
      }
    }
    return files
  }

  function rowsOf(f) {
    const c = cache.get(f.path)
    if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) return c.rows
    let text = ''
    try { text = readFileSync(f.path, 'utf8') } catch { return c?.rows ?? [] }
    const rows = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try { rows.push(JSON.parse(line)) } catch { /* torn final line during a rewrite */ }
    }
    cache.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, rows })
    return rows
  }

  /** Map sid -> { sid, projectKey, events (ordered), lastMtime } */
  function sessions() {
    const by = new Map()
    for (const f of scan()) {
      const s = by.get(f.sid) ?? { sid: f.sid, projectKey: f.projectKey, files: [], lastMtime: 0 }
      s.files.push(f); s.lastMtime = Math.max(s.lastMtime, f.mtimeMs)
      by.set(f.sid, s)
    }
    for (const s of by.values()) {
      s.files.sort((a, b) => (a.run === b.run ? a.seg - b.seg : a.run < b.run ? -1 : 1))
      const ev = []
      for (const f of s.files) for (const r of rowsOf(f)) ev.push(r)
      // order: time, then run, then per-run sequence (stable across segments)
      ev.sort((a, b) => (a.t - b.t) || (a.run === b.run ? a.seq - b.seq : a.run < b.run ? -1 : 1))
      s.events = ev
      delete s.files
    }
    return by
  }

  /** Cheap change token for live updates. */
  function version() {
    let v = 0, n = 0
    for (const f of scan()) { v = Math.max(v, f.mtimeMs); n += f.size }
    return `${v}:${n}`
  }

  return { sessions, version }
}
