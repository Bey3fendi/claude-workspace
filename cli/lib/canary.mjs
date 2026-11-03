// Upstream canary (Phase 6): read-only comparison of the pins in workspace.lock.json with what upstream
// offers now. Network reads only (`git ls-remote`, `npm view`); never installs or changes anything.
// Pure parsing/judging below; `checkUpstream` does the I/O through an injectable runner.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemver(s) {
  const m = String(s ?? '').trim().match(SEMVER)
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? null, raw: String(s).trim() } : null
}

export function cmpSemver(a, b) {
  for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] - b[k]
  if (a.pre === b.pre) return 0
  return a.pre ? -1 : 1 // a release outranks its pre-release
}

/** `git ls-remote <url>` output → { head, tags: [{ name, sha }] } (peeled tags preferred). */
export function parseLsRemote(text) {
  const tags = new Map()
  let head = null
  for (const line of String(text ?? '').split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/)
    if (!sha || !ref) continue
    if (ref === 'HEAD') head = sha
    else if (ref.startsWith('refs/tags/')) {
      const peeled = ref.endsWith('^{}')
      const name = ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '')
      if (peeled || !tags.has(name)) tags.set(name, sha)
    }
  }
  return { head, tags: [...tags].map(([name, sha]) => ({ name, sha })) }
}

/** Newest stable semver tag, or null. */
export function latestTag(tags) {
  const stable = tags.map((t) => ({ ...t, v: parseSemver(t.name) })).filter((t) => t.v && !t.v.pre)
  stable.sort((a, b) => cmpSemver(b.v, a.v))
  return stable[0] ?? null
}

/**
 * Judge one pinned plugin. status: 'current' | 'update' (newer release) | 'ahead' (pin newer than the
 * latest release, e.g. pinned to a commit) | 'unknown' (no comparable data) | 'error'.
 */
export function judgePlugin(p, remote) {
  if (!remote) return { name: p.name, status: 'error', pinned: p.upstreamVersion ?? null, note: 'upstream not reachable' }
  const pinSha = p.source?.sha ?? null
  const pinnedTag = remote.tags.find((t) => t.sha === pinSha)
  const latest = latestTag(remote.tags)
  const pv = parseSemver(p.upstreamVersion)
  const base = { name: p.name, pinned: p.upstreamVersion ?? null, pinSha: pinSha?.slice(0, 12) ?? null, latest: latest?.name ?? null, pinnedTag: pinnedTag?.name ?? null }
  if (!latest || !pv) return { ...base, status: 'unknown', note: latest ? 'pin has no semver' : 'upstream has no release tags' }
  const c = cmpSemver(latest.v, pv)
  if (c > 0) return { ...base, status: 'update', note: `${latest.name} available (pinned ${p.upstreamVersion})` }
  if (c < 0) return { ...base, status: 'ahead', note: `pin is newer than the latest release ${latest.name}` }
  const shaNote = pinnedTag ? '' : ' (pinned commit is not the tagged one)'
  return { ...base, status: 'current', note: `up to date${shaNote}` }
}

/** Judge claude-mem: pin vs npm latest vs locally installed version. */
export function judgeClaudeMem(lockCm, npmLatest, installed) {
  const pin = parseSemver(lockCm.version), latest = parseSemver(npmLatest), inst = parseSemver(installed)
  const out = { name: 'claude-mem', pinned: lockCm.version, latest: npmLatest ?? null, installed: installed ?? null, status: 'unknown', note: '' }
  const notes = []
  if (inst && pin && cmpSemver(inst, pin) !== 0) notes.push(`installed ${installed} differs from the pin (its marketplace auto-updates)`)
  if (latest && pin) {
    out.status = cmpSemver(latest, pin) > 0 ? 'update' : 'current'
    if (out.status === 'update') notes.push(`${npmLatest} available`)
  } else notes.push('npm not reachable')
  if (notes.some((n) => n.startsWith('installed'))) out.status = out.status === 'update' ? 'update' : 'drift'
  out.note = notes.join('; ') || 'up to date'
  return out
}

/** I/O: runner(cmd, args) → { code, stdout }. Returns rows for every upstream in the lock. */
export function checkUpstream(lock, { runner, installedClaudeMem = null } = {}) {
  const rows = []
  for (const p of lock.plugins.filter((p) => p.source?.url)) {
    const r = runner('git', ['ls-remote', '--', p.source.url])
    rows.push({ ...judgePlugin(p, r.code === 0 ? parseLsRemote(r.stdout) : null), enabled: p.enabled !== false })
  }
  const n = runner('npm', ['view', lock.claudeMem.npmPackage, 'version'])
  rows.push(judgeClaudeMem(lock.claudeMem, n.code === 0 ? n.stdout.trim() : null, installedClaudeMem))
  return rows
}
