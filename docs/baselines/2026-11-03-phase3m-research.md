# Phase 3M step 1: Avenox Beyin V3 vs claude-mem (static research, 2026-11-03)

**Sources:**
- Avenox `v3.12.0` at commit `36f8a75`, cloned read-only. **Its code was not executed.**
- claude-mem `15.9.0`, inspected read-only: `~/.claude-mem/settings.json` (keys redacted), `CAPTURE_BROKEN`, `observer-health.json`, and row counts per project from `claude-mem.db` (`mode=ro`).

**Status:**
- Step 1 (static read) is done, and step 2 (sandbox measurement) is done; see the end of this doc.
- Each row below is marked *source* (read in code or docs) or *observed* (seen on this machine).

## How each system works

| | claude-mem 15.9.0 (current) | Avenox Beyin V3.12.0 |
|---|---|---|
| Storage | SQLite + FTS5 + Chroma vectors in `~/.claude-mem/` (13 MB here) *observed* | Markdown vault (canonical) + local SQLite/JSON index in a runtime dir outside the vault *source* |
| Runtime deps | Bun worker daemon on 127.0.0.1:37700 *observed*; failed once with "Bun runtime not found" (`CAPTURE_BROKEN`, 2026-11-01) *observed* | Python ≥ 3.11, stdlib only; no daemon, no API key *source* |
| Capture | **Implicit.** Tool observations are compressed by an LLM (`CLAUDE_MEM_PROVIDER=claude`, model haiku, **subscription auth**) *observed* | **Agent-written.** After meaningful work the agent writes a vault note and sends a `receipt` with refs; "if the agent closes without a record the worker invents no summary" *source* |
| Capture cost | Spends the user's Claude usage. `observer-health.json` recorded "five-hour usage allowance is exhausted" *observed* | No model calls from hooks; the agent's own turn tokens only *source* |
| Retrieval | Search across FTS and vectors; SessionStart injects up to 50 observations (`CONTEXT_PROJECTS=current`) *observed* | Keyword search with a Turkish stemmer (no embeddings, "no general NL understanding claimed") *source*. Outside the vault, retrieval is **explicit**: the agent calls `beyin.py context "topic" --project P --json` *source* |
| Startup injection | Recent observations index (large) | Bridge: ~1.5k-char bootstrap (label, session hash, CLI path, receipt instruction), 0–4000 configurable. Optional `--project-context on` adds that project's latest receipt summary plus due tasks *source* |
| Project identity | **Folder basename.** Observed collision: 176 `shop-cart` sessions from many different fixture paths are merged into one project *observed* | `project_id = sha256(resolved cwd)[:24]`; label = folder name; same-named folders are kept apart *source* |
| Hooks outside its home | Project-scope plugin (ours: `claude-mem@thedotmack`) | **Global bridge**: writes `SessionStart/Stop/PreCompact/SessionEnd` into **`~/.claude/settings.json`** with absolute Python, vault and state paths, plus a `--project-root` allowlist; `.bak` backup *source*. `UserPromptSubmit` is **not** forwarded, so the vault's per-turn context injection does not reach external projects *source* |
| Network | Local worker; optional third-party providers configured but unused here | Update checks against GitHub releases (not from the global bridge start) *source* |
| Telemetry | Present upstream; forced off by us (Phase 2) | None found in code *source* |

## The 7 decision criteria (plan §4a step 3), provisional

| # | Criterion | Static verdict | Needs measurement |
|---|---|---|---|
| 1 | Retrieval | **Uncertain.** Keyword-only, tuned for Turkish; the agent must call it explicitly in external projects | Tests 3–4: does the agent find prior decisions without being told the command? |
| 2 | Sufficiently reliable implicit capture | **Weak by design.** Capture depends on the agent choosing to write a receipt (our Phase 3 baseline: advice alone gave 0/51 skill invocations). Would need our Phase 4 capture trigger | Tests 1–2, with and without a trigger |
| 3 | Continuity | Possible via `--project-context on` (latest receipt summary) | Test 5 |
| 4 | Isolation | **Better than claude-mem** (path hash vs basename; claude-mem collision observed) | Test 6 |
| 5 | Low overhead | **Better**: no LLM capture spend, no daemon; ~1.5k-char bootstrap vs up to 50 observations | Hook latency; context chars per session |
| 6 | Portable install | **Conflict.** The documented path edits the user-level `~/.claude/settings.json` with machine-specific absolute paths, against "installation must not modify unrelated files". It also needs a vault created first | Whether workspace-core can call the bridge script from its own project-scoped hooks instead |
| 7 | Compatibility | Python 3.11+ on Linux, macOS and WSL is fine; Windows paths supported; no conflict with Superpowers or Caveman expected | Install in a fixture; doctor |

## Provisional read

**What Avenox does better:**
- Isolation and overhead are clearly better.
- No Bun, no daemon, and no hidden spend of the user's usage on capture.

**What blocks a straight swap:**
- **Capture is not implicit.** It relies on the agent. This is exactly the failure mode Phase 3 measured (advice alone → 0%). Swapping without a Phase 4 capture trigger would likely regress capture from "automatic but costly" to "rare".
- **Install path.** The bridge's global settings edit is outside our scope rules. The smallest compliant design: workspace-core invokes `beyin_v3_bridge.py` (pinned by SHA-256) from its own project-scoped `session.start/end` and `prompt.submit` hooks. Vault and state paths come from user-level workspace config, never committed. claude-mem is disabled only at project scope when `memory.backend=avenox`.
- **Retrieval in external projects is explicit only.** Per-turn context is not forwarded by the bridge, so we would have to add it (a `prompt.submit` call to `context --project`). That is new code to measure, not an upstream feature.

## Step 2: sandbox measurement (2026-11-03, user-approved, $0)

**Setup:**
- WSL, Python 3.12.9.
- `HOME`, vault, state and two project roots under `/tmp/cw-3m/sb`.
- Two **same-named** projects: `projA/shop-cart` and `projB/shop-cart`.
- The bridge was fed Claude hook payloads on stdin exactly as a `SessionStart`/`SessionEnd` hook would be. No model calls.
- Script: `$CLAUDE_JOB_DIR/tmp/measure.sh` (job scratch).

| Measure | Result |
|---|---|
| `install_v3.py` into an empty vault | 0.57 s; 68 files, all in the vault and state dir; **fake `HOME` untouched** (no global settings without `bridge --install`) |
| Bridge hook latency, in-scope `SessionStart` / `SessionEnd` | **86–100 ms** each (3 runs each) |
| Bridge hook, cwd outside `--project-root` | 50 ms, outputs `{}` (silent) |
| Injected at `SessionStart` | **855 chars** (bootstrap only); 925 with `--project-context on` and one receipt |
| Retrieval latency (`context … --project`) | ~160 ms; 417 chars returned for one matching note |
| Retrieval, shared keywords | Correct note returned; the project filter excluded the other project's note |
| Retrieval, paraphrase with no shared words ("money precision issue" vs a note on cents rounding) | **Abstained** (0 records); keyword-only |
| Project identity of the two same-named folders | Same label `shop-cart`, **different `project_id`** (path hash) |
| Continuity (`--project-context on`) | projA's receipt summary appeared in projA's next start and **not** in projB's |
| `doctor` after the run | `claude: observed_metadata` (SessionStart, SessionEnd) |

**Findings that change the static read:**
- **Isolation is split.**
  - Receipts and continuity are isolated by path hash: verified.
  - **Note retrieval filters by label** (`--project shop-cart`). Same-named repos would share notes. That is the same weakness as claude-mem's basename, though limited to notes the agent wrote.
- **Retrieval is lexical.** A paraphrase with no word overlap finds nothing; claude-mem also has Chroma vectors. Criterion 1 is weaker than claude-mem by design.
- **Overhead is low and bounded:**
  - ~0.1 s per lifecycle hook;
  - under 1k chars injected;
  - no LLM spend on capture.
- **The bridge silently outputs `{}` on any internal error**, by design ("never block the host"). Example: run with `python3 -I`, it cannot import its sibling modules. Our doctor would have to check health via `beyin.py doctor`, not via hook output.
- **The injected bootstrap carries absolute machine paths** (Python and vault). That is fine for runtime context, but these must never be written into committed project files.

## Revised criteria after step 2

| # | Criterion | Verdict |
|---|---|---|
| 1 | Retrieval | **Below claude-mem.** Lexical only; explicit agent call needed outside the vault |
| 2 | Implicit capture | **Not met without Phase 4.** Agent-written receipts only |
| 3 | Continuity | **Met (mechanism)** via `--project-context`: latest receipt summary only |
| 4 | Isolation | **Partial.** Receipts by path hash ✓; notes by label ✗ |
| 5 | Low overhead | **Met; better than claude-mem** (≈0.1 s/hook, <1k chars, $0 capture) |
| 6 | Portable install | **Met only via our own wrapper.** Upstream bridge edits global settings |
| 7 | Compatibility | **Met in sandbox** (Python 3.11+, stdlib, no daemon) |

**Gate (step 3) outlook:**
- Avenox does **not** pass all 7 criteria as shipped: 1, 2 and 4 fail or are partial.
- A replacement would only make sense with three workspace additions:
  - (a) a Phase 4 capture trigger;
  - (b) per-turn `context` injection from `prompt.submit`;
  - (c) project labels that include a path-hash suffix.
- Even then, retrieval stays lexical. Tests 1–8 in real sessions would decide whether that is good enough.
