#!/usr/bin/env node
// Generates .claude-plugin/marketplace.json from workspace.lock.json (the single source of pins).
// --check: exit 1 if the committed file is out of date (CI guard).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export function buildMarketplace(lock) {
  return {
    name: lock.marketplace.name,
    owner: { name: lock.marketplace.owner },
    description: lock.marketplace.description,
    plugins: lock.plugins.map((p) => ({ name: p.name, description: p.description, source: p.source })),
  }
}

export function render(lock) {
  return JSON.stringify(buildMarketplace(lock), null, 2) + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const lock = JSON.parse(readFileSync(join(ROOT, 'workspace.lock.json'), 'utf8'))
  const out = join(ROOT, '.claude-plugin', 'marketplace.json')
  const want = render(lock)
  if (process.argv.includes('--check')) {
    let have = ''
    try { have = readFileSync(out, 'utf8') } catch {}
    if (have !== want) {
      console.error('marketplace.json is out of date: run `npm run gen:marketplace`')
      process.exit(1)
    }
    console.log('marketplace.json matches workspace.lock.json')
  } else {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, want)
    console.log(`wrote ${out}`)
  }
}
