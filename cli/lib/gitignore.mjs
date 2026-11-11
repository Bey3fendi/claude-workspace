// The workspace's managed block in .gitignore (a thin wrapper over managed-block.mjs).
import { inspect, upsert, remove } from './managed-block.mjs'

export const BEGIN = '# >>> claude-workspace (managed) >>>'
export const END = '# <<< claude-workspace (managed) <<<'
// .claude/workspace/ holds backups and the manifest (per machine), except CLAUDE.workspace.md, which the
// committed CLAUDE.md imports and so must be committed too. A file under an ignored *directory* cannot be
// re-included, hence `/*` plus the negation.
// .explain/ holds Explain's local, per-developer explanations (never committed).
export const ENTRIES = ['.claude/workspace/*', '!.claude/workspace/CLAUDE.workspace.md', '.claude/settings.local.json', '.explain/']
const MARKERS = { begin: BEGIN, end: END }

/** Insert or update the managed block. Returns the new text (identical text means no change). */
export function upsertBlock(text, entries = ENTRIES) {
  return upsert(text || '', entries, MARKERS).text
}

/** Remove the managed block (and the newline that followed it). */
export const removeBlock = (text) => remove(text, MARKERS)

export const hasBlock = (text) => inspect(text || '', MARKERS).count > 0
