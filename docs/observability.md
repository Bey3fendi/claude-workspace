# Observability: events and evidence states

The `workspace-core` mod records documented Claude Code engine events. It never treats what the model says as evidence. The dashboard derives every state from those records, and each state names its evidence.

## Where data lives

- **Events.** Stored at `~/.local/state/claude-workspace/events/<project-key>/<session>.<run>.<seg>.jsonl`. The base directory follows `$XDG_STATE_HOME`, and `CW_EVENTS_DIR` overrides it.
  - Each Claude Code process writes its own segment files, up to 500 lines each. This is because the mod file API rewrites whole files rather than appending.
  - Data stays local; nothing is sent anywhere.
- **Dashboard.** `claude-workspace dashboard [--port 47821]`.
  - Binds `127.0.0.1` only and serves read-only GET requests.
  - Checks the `Host` header, which guards against DNS rebinding.
  - Uses a strict CSP and renders all data as text.
  - Never uses ports 37700–37799 (claude-mem worker) or 8000 (Chroma).
- **Index.** Built in memory from the JSONL files and re-parsed when a file changes. The plan's SQLite index is deferred: `node:sqlite` is still experimental on Node 22.13, and the volume doesn't need it yet.

## Privacy

- **Prompts:** only a hash, a redacted 80-character preview, and the length.
- **Tool inputs and outputs:** not recorded. Exceptions: the skill name for `Skill` calls, and the subagent type for `Agent` calls.
- **Redaction:** every string is redacted at write time. This covers API keys (Anthropic, generic `sk-`, GitHub, AWS, Slack), JWTs, bearer and basic credentials, `*_KEY`/`TOKEN`/`SECRET`/`PASSWORD` assignments, URL credentials, and PEM private keys.
- **Router:** for the router `view`, only decision fields are kept. Credentials and health are dropped.

## Event schema (v1)

Every row contains `v`, `t` (epoch ms), `sid`, `run`, `seq` and `ev`.

| `ev` | Engine event | Fields |
|---|---|---|
| `session.start` | `session.start` | `cwd`, `root`, `surface`, `interactive`, `model` |
| `session.end` | `session.end` | `reason` |
| `turn.start` | `turn.start` | `turnId`, `agentId`, `prompt{hash,preview,len}` (main loop only) |
| `turn.step` | `turn.step` | `turnId`, `index`, `model`, `effort`, `agentId`: the model and effort **actually sent** |
| `turn.complete` | `turn.complete` | `turnId`, `agentId`, `reason` (`answer`/`aborted`/`refusal`/`error`), `usage{model,in,out,cacheRead,cacheWrite}` |
| `skill.prompt` | `skill.prompt` | `skill`, `pluginName`, `source`, `agentId` |
| `skill.loaded` / `skill.failed` | `classic.PostToolUse` / `PostToolUseFailure` (Skill) | `skill`, `error` |
| `tool.call` | `tool.call` | `tool`, `skill`, `subagentType`, `agentId`, `denied`, `isError`, `errorText` (Skill only) |
| `agent.spawn` | `agent.spawn` | `subagentType`, `model`, `agentId` |
| `subagent.start` / `subagent.stop` | `classic.SubagentStart` / `SubagentStop` | `agentType`, `agentId` |
| `injection` | `session.append` (door `hook-context`, origin hook) | `hookEvent`, `len`, `markers{capability:count}` |
| `router.view` | `state.set{plugin:"router", key:"view"}` | `phase`, `mode`, `nativeModel`, `selectedModel`, `actualModel`, `tier`, `effort`, `reason`, `error` |
| `compact` | `classic.PreCompact` | `trigger` |

## Evidence states

### Capability states (per session)

| State | Meaning |
|---|---|
| `observed` | An engine event showed it, for example a `hook-context` injection carrying the capability's content markers |
| `activated` | A model-invoked skill fired (`skill.prompt`) |
| `failed` | A hook failure was found (transcript, labeled best-effort), or the router reported an `error` (fallback to the native model) |
| `not-applicable` | For example Caveman in a headless session, since it injects only in interactive sessions |
| `not-activated` | For example Karpathy when its skill was never selected. This is not a failure |
| `unverified` | Only the undocumented transcript showed it, for example a hook ran but no injection was seen |
| `not-observed` | No evidence at all |
| `disabled` | The optional router is off |

### Skill states (per request)

| State | Evidence |
|---|---|
| `activated` | `skill.prompt` |
| `completed` | `PostToolUse` |
| `denied` | `tool.call` deny, or `isError` with a permission-denied message |
| `failed` | `PostToolUseFailure`, or another `tool.call` error |

A denied skill is a policy decision, not a failure.

### Router verdict (per request)

| Verdict | Meaning |
|---|---|
| `match` | The router's expected model equals the `turn.step` model actually sent |
| `mismatch` | The two differ |
| `fallback` | The router reported an `error` |
| `unknown` | Not enough evidence to decide |

## Limits (stated honestly)

- **Attribution of injections uses content markers.** The engine merges the JSON context of all hooks into one row, so a single row can legitimately carry several capabilities. A capability whose text names another capability can produce a false positive.
- **The transcript fallback reads undocumented attachments.** These are `hook_success`, `hook_non_blocking_error` and `async_hook_response`. Anything derived only from them is labeled best-effort or `unverified`.
- **The status line (`cw <model>/<effort> · skills N · req N`) appears only in interactive sessions.**
