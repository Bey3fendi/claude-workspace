import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const dir = new URL('../../devcontainer/src/claude-workspace/', import.meta.url)
const feat = JSON.parse(readFileSync(new URL('devcontainer-feature.json', dir), 'utf8'))
const install = readFileSync(new URL('install.sh', dir), 'utf8')
const post = readFileSync(new URL('post-create.sh', dir), 'utf8')
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

test('feature version follows package.json', () => assert.equal(feat.version, pkg.version))

test('every option reaches install.sh and is baked into post-create', () => {
  for (const name of Object.keys(feat.options)) {
    const env = name.toUpperCase() // the devcontainer CLI passes options as upper-cased env vars
    assert.match(install, new RegExp(`^${env}="\\$\\{${env}:-`, 'm'), `install.sh reads ${env}`)
    if (name !== 'source') assert.ok(post.includes(`$${env}`) || post.includes(`"$${env}"`), `post-create.sh uses ${env}`)
  }
})

test('post-create never fails container creation and installs no claude-mem', () => {
  assert.match(post, /exit 0\s*$/)
  assert.doesNotMatch(post, /set -e/)
  assert.doesNotMatch(post + install + JSON.stringify(feat), /claude-?mem/i)
})

test('lifecycle hook points at the baked script', () => {
  assert.equal(feat.postCreateCommand, '/usr/local/share/claude-workspace/post-create.sh')
  assert.match(install, /> "\$DEST\/post-create.sh"/)
})
