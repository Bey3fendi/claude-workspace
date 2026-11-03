// Version history for update/rollback (Phase 6). The pins live in the CLI's own workspace.lock.json, so
// "rollback" means running the PREVIOUS workspace version's `repair`. The manifest keeps the last few
// states so `claude-workspace rollback` can say exactly which version/source that is.
import { join } from 'node:path'
import { readJsonFile } from './util.mjs'

export const HISTORY_MAX = 5

/** Version of a local (unpinned) plugin as this checkout ships it, or null. */
export function localPluginVersion(ctx, p) {
  if (typeof p.source !== 'string') return null
  try { return readJsonFile(join(ctx.repoRoot, p.source, '.claude-plugin', 'plugin.json'), { missing: null })?.version ?? null } catch { return null }
}

/** { id: { version, sha } | null } for each plugin id, from Claude Code's registry. */
export function pinState(ctx, ids, projectInstall) {
  return Object.fromEntries(ids.map((id) => { const r = projectInstall(ctx, id); return [id, r ? { version: r.version ?? null, sha: r.gitCommitSha ?? null } : null] }))
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Append the PREVIOUS state when something changed. The first install (nothing installed before) records
 * nothing. Returns true when an entry was added.
 */
export function pushHistory(m, prev, next) {
  const hadInstall = Object.values(prev.plugins ?? {}).some(Boolean)
  if (!hadInstall) return false
  if (same(prev.plugins, next.plugins) && prev.source === next.source && prev.workspaceVersion === next.workspaceVersion) return false
  m.history = [...(m.history ?? []), prev].slice(-HISTORY_MAX)
  return true
}

const isPath = (s) => typeof s === 'string' && (s.startsWith('/') || s.startsWith('.') || /^[A-Za-z]:[\\/]/.test(s))

/** Rollback plan from the manifest: the steps to return to the last recorded state. Pure. */
export function rollbackPlan(m, { projectRoot }) {
  const prev = m?.history?.at(-1)
  if (!prev) return { ok: false, message: 'no previous version recorded (history starts with the first update after install)' }
  const core = Object.entries(prev.plugins ?? {}).find(([id]) => id.startsWith('workspace-core@'))?.[1]
  const what = `workspace ${prev.workspaceVersion ?? '?'}${core?.version ? `, workspace-core ${core.version}` : ''}, recorded ${prev.at}`
  const steps = []
  if (isPath(prev.source)) {
    // For a local checkout Claude Code records the checkout's commit as workspace-core's gitCommitSha.
    if (core?.sha) steps.push(`git -C ${prev.source} checkout ${core.sha.slice(0, 12)}   # the commit workspace-core ${core.version ?? ''} was installed from`)
    else {
      steps.push(`git -C ${prev.source} log --oneline   # find the commit that shipped ${what.split(',')[0]}`)
      steps.push(`git -C ${prev.source} checkout <that-commit>`)
    }
    steps.push(`node ${prev.source}/cli/bin/claude-workspace.mjs repair --project ${projectRoot}`)
  } else {
    const [repo, ref] = String(prev.source).split('#')
    steps.push(`npx -y github:${repo}${ref ? `#${ref}` : ''} repair --project ${projectRoot} --marketplace ${prev.source}`)
  }
  return { ok: true, message: `previous state: ${what}`, previous: prev, steps }
}
