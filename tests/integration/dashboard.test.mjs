import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { join } from 'node:path'
import { createDashboard } from '../../observability/server.mjs'
import { ROOT } from '../helpers.mjs'

const EVENTS = join(ROOT, 'tests', 'fixtures', 'events', 'synthetic-mixed', 'events')

function get(port, path, { host = `127.0.0.1:${port}`, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, (res) => {
      let body = ''
      res.on('data', (c) => { body += c; if (res.headers['content-type']?.startsWith('text/event-stream')) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body }) } })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('dashboard: loopback only, read-only, host-checked, strict CSP, serves derived evidence', async () => {
  const d = createDashboard({ eventsDir: EVENTS, configDir: null, health: async () => ({ claudeMem: { up: false, port: 37700 } }), pollMs: 50 })
  const h = await d.listen(0)
  try {
    assert.equal(h.server.address().address, '127.0.0.1')

    const list = await get(h.port, '/api/sessions')
    assert.equal(list.status, 200)
    const sessions = JSON.parse(list.body)
    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].requests, 4)
    assert.equal(sessions[0].capabilities.superpowers, 'observed')

    const one = await get(h.port, `/api/sessions/${sessions[0].sid}`)
    assert.equal(JSON.parse(one.body).requests[1].routing.verdict, 'mismatch')

    const page = await get(h.port, '/')
    assert.equal(page.status, 200)
    assert.match(page.headers['content-security-policy'], /script-src 'self'/)
    assert.equal(page.headers['x-content-type-options'], 'nosniff')
    assert.ok(!/<script>(?!<\/script>)/.test(page.body), 'no inline script')

    assert.equal((await get(h.port, '/api/sessions', { host: 'evil.example:80' })).status, 403, 'DNS-rebinding guard')
    assert.equal((await get(h.port, '/api/sessions', { method: 'POST' })).status, 405)
    assert.equal((await get(h.port, '/api/sessions/../../etc/passwd')).status, 404)
    assert.equal((await get(h.port, '/api/sessions/nope')).status, 404)

    const sse = await get(h.port, '/api/stream')
    assert.match(sse.headers['content-type'], /text\/event-stream/)
    assert.match(sse.body, /event: version/)
    assert.deepEqual(JSON.parse((await get(h.port, '/api/health')).body), { claudeMem: { up: false, port: 37700 } })
  } finally { await h.close() }
})

test('dashboard CLI refuses claude-mem worker ports', async () => {
  const { spawnSync } = await import('node:child_process')
  const r = spawnSync(process.execPath, [join(ROOT, 'cli', 'bin', 'claude-workspace.mjs'), 'dashboard', '--port', '37700', '--json'], { encoding: 'utf8', input: '' })
  assert.equal(r.status, 1)
  assert.match(r.stdout, /reserved for the claude-mem worker/)
})
