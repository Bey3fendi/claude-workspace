// Key-level merges for project .claude/settings.json. Only keys we own are added or removed;
// everything else (including unknown keys and their order) is preserved.

/** Append the rules missing from permissions[kind] ('deny' | 'allow'). */
export function addRules(settings, kind, rules) {
  const s = structuredClone(settings)
  s.permissions ??= {}
  const cur = Array.isArray(s.permissions[kind]) ? s.permissions[kind] : []
  const added = rules.filter((r) => !cur.includes(r))
  s.permissions[kind] = [...cur, ...added]
  return { settings: s, added }
}

export function removeRules(settings, kind, rules) {
  const s = structuredClone(settings)
  const cur = s.permissions?.[kind]
  if (!Array.isArray(cur)) return s
  s.permissions[kind] = cur.filter((r) => !rules.includes(r))
  if (!s.permissions[kind].length) delete s.permissions[kind]
  if (s.permissions && !Object.keys(s.permissions).length) delete s.permissions
  return s
}

export const addDenies = (settings, rules) => addRules(settings, 'deny', rules)
export const removeDenies = (settings, rules) => removeRules(settings, 'deny', rules)

/** Remove what `claude plugin install/marketplace add --scope project` wrote for our marketplace. */
export function removeMarketplaceKeys(settings, marketplaceName) {
  const s = structuredClone(settings)
  if (s.enabledPlugins) {
    for (const k of Object.keys(s.enabledPlugins)) if (k.endsWith(`@${marketplaceName}`)) delete s.enabledPlugins[k]
    if (!Object.keys(s.enabledPlugins).length) delete s.enabledPlugins
  }
  if (s.extraKnownMarketplaces) {
    delete s.extraKnownMarketplaces[marketplaceName]
    // Claude Code's own `marketplace remove` leaves an empty object behind
    if (!Object.keys(s.extraKnownMarketplaces).length) delete s.extraKnownMarketplaces
  }
  return s
}

export function missingDenies(settings, rules) {
  const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : []
  return rules.filter((r) => !deny.includes(r))
}
