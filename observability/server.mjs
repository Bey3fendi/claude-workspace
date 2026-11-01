// Read-only dashboard server. Binds 127.0.0.1 only, checks the Host header (DNS-rebinding
// guard), serves GET only, strict CSP, no CORS. Default port avoids claude-mem (37700-37799)
// and Chroma (8000).
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReader } from './reader.mjs'
import { deriveSession, summarize } from './derive.mjs'
import { readTranscriptHooks, transcriptPath } from './transcript.mjs'

export const DEFAULT_PORT = 47821
const HOST = '127.0.0.1'
const WEB = join(dirname(fileURLToPath(import.meta.url)), 'web')
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
}
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

export function createDashboard({ eventsDir, configDir, health = async () => null, pollMs = 1000 }) {
  const reader = createReader(eventsDir)
  const derived = new Map() // sid -> { key, view }

  function view(s) {
    const root = s.events.find((e) => e.ev === 'session.start')?.root
    const tpath = root && configDir ? transcriptPath(configDir, root, s.sid) : null
    const hooks = tpath ? readTranscriptHooks(tpath) : null
    const key = `${s.lastMtime}:${s.events.length}:${hooks?.length ?? -1}`
    const c = derived.get(s.sid)
    if (c && c.key === key) return c.view
    const v = deriveSession({ sid: s.sid, projectKey: s.projectKey, events: s.events, hooks })
    derived.set(s.sid, { key, view: v })
    return v
  }

  async function handle(req, res, port) {
    const host = String(req.headers.host || '')
    if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) return send(res, 403, 'text/plain', 'forbidden host')
    if (req.method !== 'GET') return send(res, 405, 'text/plain', 'read-only', { Allow: 'GET' })
    const url = new URL(req.url, `http://${HOST}`)
    if (STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname]
      return send(res, 200, type, readFileSync(join(WEB, file)))
    }
    if (url.pathname === '/api/sessions') {
      const list = [...reader.sessions().values()].map((s) => summarize(view(s))).sort((a, b) => b.lastAt - a.lastAt)
      return json(res, list)
    }
    const m = url.pathname.match(/^\/api\/sessions\/([A-Za-z0-9-]{1,80})$/)
    if (m) {
      const s = reader.sessions().get(m[1])
      return s ? json(res, view(s)) : send(res, 404, 'text/plain', 'no such session')
    }
    if (url.pathname === '/api/health') return json(res, (await health().catch(() => null)) ?? {})
    if (url.pathname === '/api/stream') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/event-stream', Connection: 'keep-alive' })
      let last = reader.version()
      res.write(`event: version\ndata: ${JSON.stringify(last)}\n\n`)
      const timer = setInterval(() => {
        const v = reader.version()
        if (v !== last) { last = v; res.write(`event: version\ndata: ${JSON.stringify(v)}\n\n`) }
        else res.write(': ping\n\n')
      }, pollMs)
      req.on('close', () => clearInterval(timer))
      return
    }
    return send(res, 404, 'text/plain', 'not found')
  }

  return {
    listen(port = DEFAULT_PORT) {
      return new Promise((resolve, reject) => {
        const server = createServer((req, res) => {
          handle(req, res, server.address().port).catch((err) => send(res, 500, 'text/plain', 'internal error: ' + String(err.message).slice(0, 200)))
        })
        server.once('error', reject)
        server.listen(port, HOST, () => {
          const p = server.address().port
          resolve({ server, port: p, url: `http://${HOST}:${p}/`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r) }) })
        })
      })
    },
  }
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra })
  res.end(body)
}
const json = (res, obj) => send(res, 200, 'application/json; charset=utf-8', JSON.stringify(obj))
