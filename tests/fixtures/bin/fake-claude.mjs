#!/usr/bin/env node
// Fake `claude` CLI for hermetic tests. Implements the subset of `claude plugin ...` the
// workspace CLI uses, with the same JSON shapes observed live on Claude Code 2.1.316.
// State: $CLAUDE_CONFIG_DIR/plugins/{installed_plugins,known_marketplaces}.json, project .claude/settings.json.
import { readFileSync, writeFileSync, mkdirSync, realpathSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

const cfg = process.env.CLAUDE_CONFIG_DIR
const regF = join(cfg, 'plugins', 'installed_plugins.json')
const kmF = join(cfg, 'plugins', 'known_marketplaces.json')
const cwd = realpathSync(process.cwd())
const setF = join(cwd, '.claude', 'settings.json')
const rj = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return d } }
const wj = (f, o) => { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, JSON.stringify(o, null, 2) + '\n') }
const out = (o, code = 0) => { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(code) }
if (process.env.FAKE_CALL_LOG) appendFileSync(process.env.FAKE_CALL_LOG, `claude ${process.argv.slice(2).join(' ')}\n`)

const a = process.argv.slice(2).filter((x) => x !== '--json' && x !== '-y')
const scopeIdx = a.indexOf('--scope'); const scope = scopeIdx >= 0 ? a.splice(scopeIdx, 2)[1] : 'user'
if (a[0] === '--version') { console.log('2.1.316 (Claude Code)'); process.exit(0) }
if (a[0] !== 'plugin') { console.error('fake-claude: unsupported'); process.exit(2) }
const reg = rj(regF, { version: 2, plugins: {} })
const km = rj(kmF, {})
const settings = rj(setF, null)

const cmd = a.slice(1)
if (cmd[0] === 'list') {
  const rows = []
  for (const [id, recs] of Object.entries(reg.plugins)) for (const r of recs)
    rows.push({ id, version: r.version, scope: r.scope, enabled: true, installPath: `/fake/${id}`, ...(r.projectPath ? { projectPath: r.projectPath } : {}) })
  console.log(JSON.stringify(rows, null, 2)); process.exit(0)
}
if (cmd[0] === 'marketplace' && cmd[1] === 'list') {
  console.log(JSON.stringify(Object.entries(km).map(([name, v]) => ({ name, ...v.source })), null, 2)); process.exit(0)
}
if (cmd[0] === 'marketplace' && cmd[1] === 'add') {
  const src = cmd[2]
  const mk = rj(join(src, '.claude-plugin', 'marketplace.json'), null)
  if (!mk) out({ command: 'marketplace-add', outcome: 'failed', message: `no marketplace at ${src}` }, 1)
  km[mk.name] = { source: { source: 'directory', path: src }, installLocation: src, lastUpdated: new Date().toISOString() }
  wj(kmF, km)
  const s = settings ?? {}
  s.extraKnownMarketplaces ??= {}
  s.extraKnownMarketplaces[mk.name] = { source: { source: 'directory', path: src } }
  wj(setF, s)
  out({ command: 'marketplace-add', outcome: 'ok', marketplace: mk.name })
}
if (cmd[0] === 'marketplace' && cmd[1] === 'remove') {
  const name = cmd[2]
  if (!settings?.extraKnownMarketplaces?.[name]) out({ command: 'marketplace-remove', outcome: 'failed', message: `Marketplace '${name}' not found` }, 1)
  delete settings.extraKnownMarketplaces[name]
  wj(setF, settings)
  out({ command: 'marketplace-remove', outcome: 'ok', marketplace: name })
}
if (cmd[0] === 'install') {
  const id = cmd[1]; const [name, mname] = id.split('@')
  const m = km[mname]
  const mk = m && rj(join(m.source.path, '.claude-plugin', 'marketplace.json'), null)
  const entry = mk?.plugins.find((p) => p.name === name)
  if (!entry) out({ command: 'install', outcome: 'failed', plugin: id, message: `Plugin "${id}" not found in marketplace` }, 1)
  const override = process.env[`FAKE_SHA_${name.replace(/-/g, '_').toUpperCase()}`]
  const sha = override || (typeof entry.source === 'object' ? entry.source.sha : undefined)
  reg.plugins[id] = (reg.plugins[id] || []).filter((r) => !(r.scope === scope && r.projectPath === cwd))
  reg.plugins[id].push({ scope, projectPath: cwd, version: '1.0.0', installPath: `/fake/${id}`, installedAt: new Date().toISOString(), ...(sha ? { gitCommitSha: sha } : {}) })
  wj(regF, reg)
  const s = settings ?? {}
  s.enabledPlugins ??= {}
  s.enabledPlugins[id] = true
  wj(setF, s)
  out({ command: 'install', outcome: 'ok', plugin: id, pluginId: id, scope })
}
if (cmd[0] === 'enable') {
  const s = settings ?? {}; s.enabledPlugins ??= {}; s.enabledPlugins[cmd[1]] = true; wj(setF, s)
  out({ command: 'enable', outcome: 'ok', plugin: cmd[1] })
}
if (cmd[0] === 'uninstall') {
  const id = cmd[1]
  const recs = reg.plugins[id] || []
  const keep = recs.filter((r) => !(r.scope === scope && r.projectPath === cwd))
  if (keep.length === recs.length) out({ command: 'uninstall', outcome: 'failed', plugin: id, message: `Plugin "${id}" not found in installed plugins`, failureCode: 'not_installed' }, 1)
  if (keep.length) reg.plugins[id] = keep; else delete reg.plugins[id]
  wj(regF, reg)
  if (settings?.enabledPlugins) { delete settings.enabledPlugins[id]; wj(setF, settings) }
  out({ command: 'uninstall', outcome: 'ok', plugin: id })
}
console.error(`fake-claude: unsupported ${a.join(' ')}`); process.exit(2)
