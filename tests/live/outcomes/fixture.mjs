// Fixture-state helpers shared by the live runner and the offline re-grader.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const G = ['-c', 'user.name=cw-outcomes', '-c', 'user.email=cw-outcomes@example.invalid']
export const git = (cwd, ...a) => { const r = spawnSync('git', [...G, ...a], { cwd, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`); return r.stdout }

/** Changed files (vs HEAD) with added+deleted line counts; untracked files count all their lines. */
export function changedFiles(dir) {
  const changed = {}
  for (const l of git(dir, 'diff', '--numstat', 'HEAD').trim().split('\n').filter(Boolean)) {
    const [a, d, f] = l.split('\t'); changed[f] = (Number(a) || 0) + (Number(d) || 0)
  }
  for (const f of git(dir, 'ls-files', '--others', '--exclude-standard').trim().split('\n').filter(Boolean)) {
    try { changed[f] = readFileSync(join(dir, f), 'utf8').split('\n').length } catch { changed[f] = 0 }
  }
  return changed
}

/** Run the prompt's grader commands in the fixture; true = exit 0. */
export function runGraders(dir, prompt, graders) {
  const out = {}
  for (const c of prompt.checks.filter((c) => c.type === 'grader')) {
    const [cmd, ...a] = graders[c.name]
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd, a, { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    out[c.name] = r.status === 0
  }
  return out
}

export const parseStream = (text) => String(text).split('\n').filter((l) => l.startsWith('{')).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
