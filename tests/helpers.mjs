import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, readdirSync, statSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const CLI = join(ROOT, 'cli', 'bin', 'claude-workspace.mjs')

/** Hermetic sandbox: fake HOME, CLAUDE_CONFIG_DIR, managed-settings dir, fake claude/npx. */
export function sandbox() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'cw-test-')))
  const home = join(base, 'home'); const project = join(base, 'project'); const bin = join(base, 'bin')
  for (const d of [home, project, bin, join(base, 'managed')]) mkdirSync(d, { recursive: true })
  for (const f of ['fake-claude.mjs', 'fake-npx.mjs']) {
    copyFileSync(join(ROOT, 'tests', 'fixtures', 'bin', f), join(bin, f)); chmodSync(join(bin, f), 0o755)
  }
  const env = {
    PATH: [dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
    XDG_STATE_HOME: join(home, '.local', 'state'), CW_MANAGED_SETTINGS_DIR: join(base, 'managed'),
    CW_CLAUDE_BIN: join(bin, 'fake-claude.mjs'), CW_NPX_BIN: join(bin, 'fake-npx.mjs'),
    FAKE_CALL_LOG: join(base, 'calls.log'),
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  }
  return { base, home, project, env }
}

export function cli(sb, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args, '--project', sb.project, '--json'], {
    env: { ...sb.env, ...extraEnv }, encoding: 'utf8', input: '', timeout: 120_000,
  })
  const last = r.stdout.trim().split('\n').pop()
  let json = null; try { json = JSON.parse(last) } catch {}
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

/** sha256 of every file under dir (relative path -> hash). */
export function tree(dir, skip = []) {
  const out = {}
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n); const rel = relative(dir, p)
      if (skip.some((s) => rel === s || rel.startsWith(s + '/'))) continue
      if (statSync(p).isDirectory()) walk(p)
      else out[rel] = createHash('sha256').update(readFileSync(p)).digest('hex')
    }
  }
  walk(dir)
  return out
}

export const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=cw-test', '-c', 'user.email=cw-test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })
export const write = (p, s) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, s) }
export const read = (p) => readFileSync(p, 'utf8')
export const calls = (sb) => { try { return readFileSync(sb.env.FAKE_CALL_LOG, 'utf8') } catch { return '' } }
