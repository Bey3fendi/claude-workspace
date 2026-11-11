// The CLAUDE.md import the CLI installs (cli/lib/claude-md.mjs writes it; this side only detects it).
// Pure: loads in the engine and in Node.

export const OWNED = '.claude/workspace/CLAUDE.workspace.md'
export const BEGIN = '<!-- >>> claude-workspace (managed) >>> -->'
export const END = '<!-- <<< claude-workspace (managed) <<< -->'
export const IMPORT_LINE = `@${OWNED}`
export const KARPATHY_HEADING = '## Coding guidelines (Karpathy)'

/** True when the text has a managed block whose body is the canonical import line. */
export function importsWorkspace(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim())
  const b = lines.indexOf(BEGIN)
  if (b < 0) return false
  const e = lines.indexOf(END, b + 1)
  return e > b && lines.slice(b + 1, e).some((l) => l === IMPORT_LINE)
}
