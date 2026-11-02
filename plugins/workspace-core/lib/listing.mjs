// Phase 3 listing work: drop skills the user's permissions deny from the model-facing skill listing.
// A denied skill cannot be invoked (permissions.deny Skill(...), verified in Phase 0 L7), so its entry
// costs tokens without offering usable discoverability. Nothing else is removed or reworded.

/**
 * Skill names denied by `permissions.deny`. Accepts `Skill(skill:name)` and `Skill(name)`; a trailing
 * `*` (e.g. `Skill(skill:claude-mem:*)`) denies a prefix. Other rule kinds are ignored.
 */
export function deniedSkills(permissions) {
  const exact = new Set(), prefixes = []
  for (const r of permissions?.deny ?? []) {
    const m = String(r).match(/^Skill\((?:skill:)?([^)\s]+)\)$/)
    if (!m) continue
    if (m[1].endsWith('*')) prefixes.push(m[1].slice(0, -1))
    else exact.add(m[1])
  }
  return { has: (name) => exact.has(name) || prefixes.some((p) => name.startsWith(p)), size: exact.size + prefixes.length }
}

const entryName = (line) => line.slice(2).split(/:\s/, 1)[0].trim()

/**
 * Remove denied entries from a listing. An entry is a line starting with "- " plus any following
 * continuation lines (lines that do not start a new entry). Text before the first entry is kept.
 */
export function trimListing(text, denied) {
  const lines = String(text ?? '').split('\n')
  const out = [], removed = []
  let skipping = false
  for (const line of lines) {
    if (line.startsWith('- ')) {
      const name = entryName(line)
      skipping = denied.has(name)
      if (skipping) { removed.push(name); continue }
    } else if (skipping) continue
    out.push(line)
  }
  const result = out.join('\n')
  return { text: result, removed, before: String(text ?? '').length, after: result.length }
}
