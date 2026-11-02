import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { isolationVerdict, projectIsolation } from '../../cli/lib/claude-mem.mjs'

test('verdict: shared key warns, own-only is ok, no key is info', () => {
  assert.equal(isolationVerdict({ key: null, ownCwd: '/a', cwds: [], source: 'path' }).status, 'info')
  assert.equal(isolationVerdict({ key: 'shop', ownCwd: '/a/shop', cwds: ['/a/shop'], source: 'path' }).status, 'ok')
  const w = isolationVerdict({ key: 'shop', ownCwd: '/a/shop', cwds: ['/a/shop', '/b/shop', '/c/shop', '/b/shop'], source: 'path' })
  assert.equal(w.status, 'warn')
  assert.match(w.message, /shared with 2 other directories/)
  assert.match(w.message, /CLAUDE_MEM_PROJECT_NAME_SOURCE=git-remote/)
  assert.doesNotMatch(w.message, /\/b\/shop/, 'other projects\' paths are not printed')
  assert.match(isolationVerdict({ key: 'o/r', ownCwd: '/a', cwds: ['/a', '/b'], source: 'git-remote' }).message, /origin remote/)
})

test('projectIsolation reads the database read-only and never fails doctor', () => {
  const home = mkdtempSync(join(tmpdir(), 'cw-iso-'))
  const ctx = { home, env: {}, projectRoot: '/w/shop-cart' }
  assert.equal(projectIsolation(ctx).status, 'info', 'no database')
  mkdirSync(join(home, '.claude-mem'))
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
  const d = new DatabaseSync(join(home, '.claude-mem', 'claude-mem.db'))
  d.exec('CREATE TABLE sdk_sessions (project TEXT, cwd TEXT, started_at_epoch INTEGER)')
  const ins = d.prepare('INSERT INTO sdk_sessions VALUES (?, ?, ?)')
  ins.run('shop-cart', '/w/shop-cart', 1); ins.run('shop-cart', '/tmp/x/shop-cart', 2); ins.run('other', '/o', 3)
  d.close()
  const r = projectIsolation(ctx)
  assert.equal(r.status, 'warn'); assert.match(r.message, /shared with 1 other directory/)
  writeFileSync(join(home, '.claude-mem', 'settings.json'), JSON.stringify({ CLAUDE_MEM_PROJECT_NAME_SOURCE: 'git-remote' }))
  assert.match(projectIsolation(ctx).message, /name source|origin remote/)
  assert.equal(projectIsolation({ ...ctx, projectRoot: '/o' }).status, 'ok')
  assert.equal(projectIsolation({ ...ctx, sqlite: { DatabaseSync: class { constructor() { throw new Error('boom') } } } }).status, 'info')
})
