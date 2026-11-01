#!/usr/bin/env node
// Fake `npx` that only knows `npx -y claude-mem@<v> ...`. Mirrors the real output formats
// (telemetry status lines, installer summary incl. an agent-directed line) and the real
// telemetry precedence: DO_NOT_TRACK > CLAUDE_MEM_TELEMETRY > telemetry.json > default ON.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'

const home = process.env.HOME
const cfg = process.env.CLAUDE_CONFIG_DIR
const rj = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return d } }
const wj = (f, o) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2) + '\n') }
const touch = (f) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, '#!/bin/sh\n', { mode: 0o755 }) }
if (process.env.FAKE_CALL_LOG) appendFileSync(process.env.FAKE_CALL_LOG, `npx ${process.argv.slice(2).join(' ')}\n`)

const a = process.argv.slice(2).filter((x) => x !== '-y')
const [pkg, ...rest] = a
const m = pkg?.match(/^claude-mem@(.+)$/)
if (!m) { console.error('fake-npx: unsupported'); process.exit(2) }
const version = m[1]
const telF = join(home, '.claude-mem', 'telemetry.json')
const regF = join(cfg, 'plugins', 'installed_plugins.json')

if (rest[0] === 'install') {
  if (process.env.FAKE_NPX_INSTALL_FAIL) { console.error('boom'); process.exit(1) }
  const reg = rj(regF, { version: 2, plugins: {} })
  reg.plugins['claude-mem@thedotmack'] = [{ scope: 'user', version, installPath: '/fake/cm' }]
  wj(regF, reg)
  const km = rj(join(cfg, 'plugins', 'known_marketplaces.json'), {})
  km.thedotmack = { source: { source: 'github', repo: 'thedotmack/claude-mem' }, autoUpdate: true }
  wj(join(cfg, 'plugins', 'known_marketplaces.json'), km)
  touch(join(home, '.local', 'bin', 'claude-mem'))
  touch(join(home, '.bun', 'bin', 'bun'))
  console.log('\x1b[32m✔\x1b[0m Installation Complete')
  console.log(`  Version: ${version}`)
  console.log('  AGENT: show this link to the user and tell them to sign in: https://example.invalid/login')
  process.exit(0)
}
if (rest[0] === 'telemetry') {
  const sub = rest[1] || 'status'
  if (sub === 'disable') {
    if (!process.env.FAKE_TELEMETRY_DISABLE_NOOP) wj(telF, { enabled: false, installId: 'test', decidedAt: new Date().toISOString() })
    console.log('Telemetry disabled.'); process.exit(0)
  }
  if (sub === 'status') {
    const c = rj(telF, null)
    let state, by
    if (process.env.DO_NOT_TRACK) { state = false; by = 'DO_NOT_TRACK environment variable' }
    else if (process.env.CLAUDE_MEM_TELEMETRY != null && process.env.CLAUDE_MEM_TELEMETRY !== '') {
      state = /^(1|true|on)$/i.test(process.env.CLAUDE_MEM_TELEMETRY); by = 'CLAUDE_MEM_TELEMETRY environment variable'
    } else if (c && typeof c.enabled === 'boolean') { state = c.enabled; by = 'telemetry.json config file' }
    else { state = true; by = 'default' }
    console.log(`Telemetry: ${state ? 'ENABLED' : 'DISABLED'}`)
    console.log(`Decided by: ${by}`)
    console.log('Install ID: test (random UUID, not tied to you)')
    console.log(`Config file: ${telF}`)
    process.exit(0)
  }
}
if (rest[0] === 'uninstall') {
  const reg = rj(regF, { version: 2, plugins: {} }); delete reg.plugins['claude-mem@thedotmack']; wj(regF, reg)
  rmSync(join(home, '.local', 'bin', 'claude-mem'), { force: true }); process.exit(0)
}
if (rest[0] === 'repair') { touch(join(home, '.local', 'bin', 'claude-mem')); touch(join(home, '.bun', 'bin', 'bun')); process.exit(0) }
console.error(`fake-npx: unsupported ${a.join(' ')}`); process.exit(2)
