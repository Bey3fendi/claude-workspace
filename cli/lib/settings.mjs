// Key-level merges for project .claude/settings.json. Only keys we own are added or removed;
// everything else (including unknown keys and their order) is preserved.

export function addDenies(settings, rules) {
  const s = structuredClone(settings)
  s.permissions ??= {}
  const deny = Array.isArray(s.permissions.deny) ? s.permissions.deny : []
  const added = rules.filter((r) => !deny.includes(r))
  s.permissions.deny = [...deny, ...added]
  return { settings: s, added }
}

export function removeDenies(settings, rules) {
  const s = structuredClone(settings)
  const deny = s.permissions?.deny
  if (!Array.isArray(deny)) return s
  s.permissions.deny = deny.filter((r) => !rules.includes(r))
  if (!s.permissions.deny.length) delete s.permissions.deny
  if (s.permissions && !Object.keys(s.permissions).length) delete s.permissions
  return s
}

/** Remove what `claude plugin install/marketplace add --scope project` wrote for our marketplace. */
export function removeMarketplaceKeys(settings, marketplaceName) {
  const s = structuredClone(settings)
  if (s.enabledPlugins) {
    for (const k of Object.keys(s.enabledPlugins)) if (k.endsWith(`@${marketplaceName}`)) delete s.enabledPlugins[k]
    if (!Object.keys(s.enabledPlugins).length) delete s.enabledPlugins
  }
  if (s.extraKnownMarketplaces?.[marketplaceName]) {
    delete s.extraKnownMarketplaces[marketplaceName]
    if (!Object.keys(s.extraKnownMarketplaces).length) delete s.extraKnownMarketplaces
  }
  return s
}

export function missingDenies(settings, rules) {
  const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : []
  return rules.filter((r) => !deny.includes(r))
}
