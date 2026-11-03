#!/usr/bin/env node
// Builds the devcontainer feature's bundled payload: `npm pack` of this checkout (the package.json
// "files" list) -> devcontainer/src/claude-workspace/payload.tgz. Also checks the feature's version
// matches package.json, so a published feature always carries the CLI version it names.
import { execFileSync } from 'node:child_process'
import { readFileSync, renameSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'devcontainer', 'src', 'claude-workspace')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const feat = JSON.parse(readFileSync(join(dir, 'devcontainer-feature.json'), 'utf8'))
if (feat.version !== pkg.version) {
  console.error(`devcontainer-feature.json version ${feat.version} != package.json ${pkg.version}`)
  process.exit(1)
}
const out = execFileSync('npm', ['pack', '--silent', '--pack-destination', dir], { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').at(-1)
rmSync(join(dir, 'payload.tgz'), { force: true })
renameSync(join(dir, out), join(dir, 'payload.tgz'))
console.log(`payload.tgz built from ${pkg.name}@${pkg.version}`)
