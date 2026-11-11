// claude-mem, legacy (v0.8.0): the workspace no longer installs or uses claude-mem. Memory is md-memory,
// built into workspace-core (.memory/*.md). This module only finds leftovers and runs claude-mem's
// own uninstaller when the user asks (`claude-workspace remove-claude-mem`). That uninstaller is
// user-level (all projects) and keeps ~/.claude-mem (its data) in place.
import { run } from './run.mjs'

export const CLAUDE_MEM_ID = 'claude-mem@thedotmack'
/** The last version the workspace pinned; its uninstaller removes any claude-mem install. */
export const LEGACY_VERSION = '15.9.0'

/** claude-mem plugin records in `claude plugin list` output (any scope). */
export const claudeMemInstalls = (installed) => (installed ?? []).filter((e) => e.id === CLAUDE_MEM_ID)

export const uninstallClaudeMem = (ctx) =>
  run(ctx.npxBin, ['-y', `claude-mem@${LEGACY_VERSION}`, 'uninstall'], { cwd: ctx.home, env: ctx.env, timeoutMs: 600_000 })
