// Dashboard client. All data is untrusted text: rendered with textContent only.
const $ = (sel) => document.querySelector(sel)
const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n.setAttribute(k, v)
  }
  for (const k of kids.flat()) if (k != null) n.append(k instanceof Node ? k : document.createTextNode(String(k)))
  return n
}
const pill = (state, label = state) => el('span', { class: `pill s-${String(state).replace(/[^a-z-]/g, '')}`, text: label })
const fmtTime = (t) => (t ? new Date(t).toLocaleString() : '—')
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString())
const CAP_LABEL = { superpowers: 'Superpowers', caveman: 'Caveman', claudeMem: 'claude-mem', ponytail: 'Ponytail', karpathy: 'Karpathy', router: 'Router (optional)' }

let selected = null

async function getJson(path) {
  const r = await fetch(path, { cache: 'no-store' })
  if (!r.ok) throw new Error(`${path}: ${r.status}`)
  return r.json()
}

async function refresh() {
  const list = await getJson('/api/sessions')
  const ul = $('#sessions')
  ul.replaceChildren(...list.map((s) => el('li', {},
    el('button', { 'aria-current': String(s.sid === selected), onclick: () => { selected = s.sid; refresh() } },
      el('span', { text: (s.root || s.projectKey || '').split('/').pop() || s.sid.slice(0, 8) }),
      el('span', { class: 'meta', text: `${fmtTime(s.lastAt)} · ${s.requests} req · ${s.skills} skills${s.failures ? ` · ${s.failures} failure(s)` : ''}` })))))
  if (!list.length) ul.replaceChildren(el('li', { class: 'muted', text: 'No sessions recorded yet. Start Claude Code in a project with the workspace installed.' }))
  if (!selected && list[0]) selected = list[0].sid
  if (selected) renderSession(await getJson(`/api/sessions/${encodeURIComponent(selected)}`))
}

function renderSession(s) {
  const caps = el('div', { class: 'caps' }, Object.entries(s.capabilities).map(([k, c]) =>
    el('div', { class: 'cap' }, el('b', { text: CAP_LABEL[k] || k }), pill(c.state), ...(c.evidence || []).map((e) => el('small', { text: e })))))

  const reqRows = s.requests.map((r) => el('tr', {},
    el('td', { text: String(r.n) }),
    el('td', {}, el('div', { text: r.prompt?.preview || '—' }), el('div', { class: 'muted mono', text: r.prompt ? `${r.prompt.len} chars · #${r.prompt.hash.slice(0, 8)}` : '' })),
    el('td', {}, ...r.steps.map((st) => el('div', { class: 'mono', text: `${st.index}: ${st.model}${st.effort ? ` / ${st.effort}` : ''}` })),
      ...r.subagents.map((a) => el('div', { class: 'muted mono', text: `↳ ${a.type || 'agent'}: ${[...new Set(a.steps.map((x) => x.model))].join(', ') || '—'}` }))),
    el('td', {}, ...(r.skills.length ? r.skills.map((k) => el('div', {}, pill(k.state), el('span', { class: 'mono', text: k.skill }))) : [el('span', { class: 'muted', text: '—' })])),
    el('td', {}, r.routing ? [pill(r.routing.verdict), el('div', { class: 'muted mono', text: `${r.routing.selected ?? '—'} → ${r.routing.used ?? '—'}${r.routing.error ? ` (${r.routing.error})` : ''}` })] : el('span', { class: 'muted', text: 'off' })),
    el('td', { class: 'mono', text: r.usage ? `in ${fmtNum(r.usage.in)} · out ${fmtNum(r.usage.out)} · cache ${fmtNum(r.usage.cacheRead)}` : '—' }),
    el('td', {}, pill(r.reason === 'answer' ? 'completed' : r.reason ? 'failed' : 'live', r.reason || 'running'))))

  const failures = s.failures.length
    ? el('table', {}, el('tr', {}, ...['Capability', 'Source', 'Where', 'Detail'].map((h) => el('th', { text: h }))),
      ...s.failures.map((f) => el('tr', {}, el('td', { text: CAP_LABEL[f.capability] || f.capability || '—' }), el('td', { text: f.source }),
        el('td', { class: 'mono', text: f.request ? `request ${f.request}${f.skill ? ` · ${f.skill}` : ''}` : (f.hookEvent || '—') }), el('td', { class: 'mono', text: f.detail || '' }))))
    : el('p', { class: 'muted', text: 'No failures recorded.' })

  $('#detail').replaceChildren(
    el('div', { class: 'card' },
      el('h2', { text: s.root || s.projectKey }),
      el('div', { class: 'muted mono', text: `session ${s.sid} · ${s.interactive === false ? 'headless' : s.interactive ? 'interactive' : 'unknown mode'} · ${s.model || ''}` }),
      el('div', { class: 'muted', text: `started ${fmtTime(s.startedAt)} · last event ${fmtTime(s.lastAt)}${s.endedAt ? ` · ended (${s.endReason})` : ''}` }),
      el('div', { class: 'muted', text: `tokens: in ${fmtNum(s.totals.in)} · out ${fmtNum(s.totals.out)} · cache read ${fmtNum(s.totals.cacheRead)} · cache write ${fmtNum(s.totals.cacheWrite)}` }),
      el('div', { class: 'muted', text: `sources: ${s.sources.events} events · transcript: ${s.sources.transcript}` })),
    el('h3', { text: 'Capabilities' }), caps,
    el('h3', { text: 'Requests' }),
    el('div', { class: 'card' }, el('table', {}, el('tr', {}, ...['#', 'Prompt', 'Model / effort (actual)', 'Skills', 'Router', 'Tokens', 'Status'].map((h) => el('th', { text: h }))), ...reqRows)),
    el('h3', { text: 'Failures' }), el('div', { class: 'card' }, failures))
}

async function health() {
  try {
    const h = await getJson('/api/health')
    const node = $('#health')
    if (h.claudeMem) node.replaceWith(Object.assign(pill(h.claudeMem.up ? 'observed' : 'not-observed', `claude-mem worker ${h.claudeMem.up ? 'up' : 'down'}`), { id: 'health' }))
  } catch {}
}

const es = new EventSource('/api/stream')
es.addEventListener('version', () => { $('#live').replaceWith(Object.assign(pill('live', 'live'), { id: 'live' })); refresh().catch(console.error) })
es.onerror = () => { $('#live').replaceWith(Object.assign(pill('unverified', 'reconnecting…'), { id: 'live' })) }
health(); setInterval(health, 15000)
