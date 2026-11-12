# Claude Workspace: Technical Plan (rev 3)

## What changed in rev 3

Two change requests from the user shape this revision.

- **CR-1: simplify observability.** The goal is that Claude automatically uses the right installed capabilities, briefly says what it used, and makes no unsupported claims.
  - The dashboard, the detailed history, the reconciliation engine and the analytics are dropped.
  - They are replaced by a concise **Workspace Usage** report and minimal verification of skill events.
  - **Priority:** correct Superpowers workflow outcomes and relevant Karpathy guidance matter more than counting activation events.
- **CR-2: memory backend.** We will evaluate **Avenox Beyin V3** as the replacement for claude-mem. **Superseded in v0.8.0 by md-memory (item 9 of the Phase 6 log).**
  - This is a gated evaluation and migration, scheduled **after Phase 3 and before Phase 4**.
  - claude-mem stays the active backend until the decision gate passes. Its data is never deleted automatically.
- **Order agreed with the user:**
  1. Finish the simplified Phase 2 and confirm it works.
  2. Phase 3.
  3. Phase 3M (memory migration).
  4. Phase 4 onward.

Labels: **[V]** means verified (source, docs or a live run). **[U]** means unverified.

**Decisions from earlier revisions that still hold:**
- Platforms: Linux, macOS, WSL, and Linux devcontainers on Docker Engine inside WSL. Native Windows is out of scope.
- Caveman: lite mode, plugin only.
- The router is optional and off by default.
- Skill-listing optimization belongs to Phase 3 and is gated on A/B evidence.
- claude-mem telemetry is forced OFF for as long as claude-mem is installed (§3a).

---

## 1. Verified upstream facts

| Tool @ pin | Integration | Activation | Constraints |
|---|---|---|---|
| **Superpowers** 7.0.1 `2ce8aa1` | Our marketplace (`url` + `sha`) | SessionStart injection plus Skill tool (15 skills) | ~848 always-on tokens |
| **Caveman** 4.0.1 `9b68f7e` | Plugin only; `.caveman.json` lite | Ambient. Its hook runs headless but injects only in interactive sessions [V] | 23 skills. 6 work-pattern skills are denied |
| **claude-mem** 15.8.0 (drifts to 15.8.1 because its marketplace has auto-update on) | Pinned npx installer, user scope | 9 hooks, worker on 127.0.0.1:37700, MCP search | Telemetry ON by default (forced OFF §3a). 30 skills, 25 denied. **Replacement under evaluation (§4a)** |
| **Ponytail** 5.3.3 `96608e0` | Our marketplace | SessionStart injection | 6 skills |
| **Karpathy** 1.0.0 `2c60614` | Our marketplace | Model-invoked `karpathy-guidelines` | ~105 tokens |
| **Router** (optional) 1.19.1 `df56298` | Our marketplace, not enabled | Mod (`turn.step`, `agent.spawn`) | User-level `router.json` |
| **Avenox Beyin V3** 3.12.0 `36f8a75` (candidate) | Release zip plus SHA-256, `install_v3.py --vault`; optional global bridge for projects outside the vault | Its own 4 Claude hooks (SessionStart, UserPromptSubmit, PreCompact, SessionEnd) plus 3 skills (`beyin`, `beyin-doktor`, `beyin-guncelle`) | See the table below |

**Avenox Beyin V3 constraints (read from source):**

| Topic | Fact |
|---|---|
| Runtime and storage | Python ≥ 3.11; Markdown vault plus a local index |
| Model calls | Local checks never call a model. Its Jev advisor is optional and off by default |
| Context injection | Normal: 5,000 characters at session start and on messages. Economical: 2,000, session start only. Manual: off. The bridge has `--context-chars` (0–4000) |
| Capture | It does not store the chat. Durable knowledge is **written by the agent** through its skill [V, README] |
| Bridge | Writes hooks into **user-level** `~/.claude/settings.json` with absolute paths and a project-root allowlist |

**Claude Code mechanisms [V]:**
- **Pinning:** sources pinned by `sha`; `installed_plugins.json.gitCommitSha` records the commit; `git-subdir` needs an https URL.
- **Deduplication:** the same plugin at two scopes is deduplicated.
- **Skill deny rules:** `permissions.deny Skill(...)` blocks invocation but does not shrink the listing. `skillOverrides` does not apply to plugin skills.
- **Mods:** run headless. The validator requires literal event names, function-literal hooks, and **`$` spelled at each call site** (never passed to helpers). It recommends a pass-through `.catch` on gating hooks.
- **Turn events:**
  - `turn.step` gives the model and effort actually sent.
  - `turn.complete` gives the reason and token usage, and **can return `{text}`, which is shown beneath the answer while the transcript record stays unchanged** (see §4).

---

## 2. Capability matrix (rev 3)

| Component | Activation | Evidence used | Enforceability |
|---|---|---|---|
| Superpowers | SessionStart injection plus Skill tool | `skill.prompt`, Skill `tool.call`, PostToolUse | Gates force *invocation*; workflow *outcomes* are checked by postconditions and evals (Phase 3/4) |
| Karpathy | Model-invoked skill, plus Phase 3 contract hints | `skill.prompt` | Suggested; outcome-checked in the eval |
| Caveman | Ambient (interactive) | Injection marker | Config only |
| Ponytail | Ambient | Injection marker | Injection only |
| Memory (claude-mem now, Avenox candidate) | Hooks | Backend health plus observable reads and writes | Retrieval is deterministic (hooks); capture is judgment-based (§4a) |
| Router (optional) | Mod | `router.view` against `turn.step` | Deterministic per policy |
| workspace-core | Mod | Its own minimal signals | `tool.call` deny, Stop block (Phase 4) |

---

## 3. Model router

Unchanged from rev 2: adopt alexei-led/claude-router, opt-in per user. Fallback and key storage are verified. The enable flow asks consent before touching user `router.json`, and our CLI never handles the key.

## 3a. claude-mem telemetry: mandatory OFF (while claude-mem is installed)

Unchanged.
- **Install:** run `telemetry disable`.
- **Doctor:** a hard gate. It scans the environment, settings `env` blocks and shell rc files for enabling overrides.
- **Never:** set `DO_NOT_TRACK`.

This stays in force after a migration to Avenox for as long as claude-mem remains installed on the machine, since that user-level install is not removed.

---

## 4. Usage reporting and minimal verification (replaces rev 2 §4)

**Goal:** a truthful report of about five lines, near-zero token overhead, and no services.

### 4.1 Signals

`workspace-core` captures only these:

| Signal | Engine event | Meaning |
|---|---|---|
| Skill **loaded/activated** | `skill.prompt` | The skill's instructions entered the context |
| Skill **invocation outcome** | Skill `tool.call` (ok, isError, deny) plus `PostToolUse`/`PostToolUseFailure` | Completed, denied or failed |
| Integration **active this session** | `session.append` hook-context content markers | For example Caveman or memory context was injected. This is *active*, which is not the same as *applied* |
| Request boundary | `turn.start` / `turn.complete` | Which skills belong to this request |
| Model/effort actually used | `turn.step` | Kept only for router verification (Phase 5) |

**Dropped:** subagent and compaction rows, prompt previews, transcript reconciliation, analytics.

**Invocation is not compliance:** an activated skill proves only that its instructions were loaded, never that they were followed.

### 4.2 The Workspace Usage report

Both layers are needed: the model knows *why* it used something, and only the engine knows *whether* it happened.

1. **Model-written section (self-reported).** A short instruction is injected once at SessionStart through the workspace-core mod, about 60–90 tokens and measured. For substantive development tasks only, it asks for this section at the end:
   ```
   Workspace Usage
   - Applied: superpowers:systematic-debugging (root-cause before fix); karpathy-guidelines (kept change minimal)
   - Active: Caveman (lite), memory context loaded
   - Not used: TDD skill (no code change)
   ```
   Its rules: no fabrication; never present an integration's mere presence as application; omit the section for trivial Q&A.
2. **Engine footer (independently observed).**
   - The mod's `turn.complete` hook returns `{text}`, which is shown beneath the answer. It costs **0 model tokens**: it is never sent to the model, and the transcript record is not rewritten.
   - One line, for example: `Verified: activated superpowers:systematic-debugging · denied caveman:lean-build · not observed: test-driven-development (claimed above)`.
   - It cross-checks skills the model *claimed* against skills the engine *observed*, by parsing skill ids from the model's section, and flags any mismatch.
   - It is shown only when the request activated or denied a skill, or the model wrote a Workspace Usage section.
3. **CLI.** `claude-workspace usage [--session <id>]` prints the same evidence for the last session from the local JSONL. It is on demand only, with no server.

**Overhead:**
- No observability-only LLM calls.
- One short injected instruction (measured in the activation suite; budget ≤ 120 tokens).
- The footer costs zero model tokens.
- JSONL writes are local and small.
- The status line already exists and costs nothing.

**[U] Spike before relying on it:**
- that a `turn.complete {text}` footer renders in interactive and `-p` sessions and is not fed back to the model;
- that the parsed claims are robust.

**Fallback:** the footer is printed by the CLI only.

### 4.3 Phase 2 implementation review (CR-1 §5)

| Component | Decision | Reason |
|---|---|---|
| `plugins/workspace-core/lib/events.mjs` (redaction, keys, markers) | **Keep** | Small, shared, tested |
| `plugins/workspace-core/lib/sink.mjs` (segment JSONL writer) | **Keep** | Needed by the footer, the CLI and Phase 4 gates |
| `hooks/register.mjs` | **Trim** | Keep the signals in §4.1, add the usage instruction and footer. Drop agent.spawn, subagent.*, compact and prompt previews |
| Status line | **Keep** | Zero token cost; the user confirmed it works |
| `observability/derive.mjs` | **Simplify** | Becomes a per-request "usage evidence" function used by the footer and the CLI. Drop capability analytics and totals |
| `observability/reader.mjs` | **Keep** (small) | Used by `claude-workspace usage` |
| `observability/transcript.mjs` (fallback reconciler) | **Remove** | Undocumented interface; not needed for the report. Doctor checks backend health directly |
| `observability/server.mjs`, `web/`, `cli/commands/dashboard.mjs`, `tests/integration/dashboard.test.mjs` | **Remove** from the product | No dashboard or server per CR-1. Deleted only after the repo is under git (`git init` plus an initial commit) so the removal is recoverable |
| `docs/observability.md` | **Rewrite** | Shorter: signals, report format, honesty rules |
| Golden fixtures and tests (`tests/fixtures/events/*`, `tests/unit/observability.test.mjs`) | **Keep and adapt** | Assert the per-request usage evidence and footer text instead of dashboard views |
| Activation suite (`tests/live/activation/`) | **Keep and extend** | This is the measure of the core objective (implicit activation); Phase 3 adds workflow-outcome checks |
| Installer, doctor, uninstall, repair, telemetry gate, router plumbing | **Untouched** | Out of scope |

---

## 4a. Memory backend: Avenox Beyin V3 evaluation and migration (new, Phase 3M)

**Principle:** the smallest safe change, gated on evidence.
- claude-mem stays active until the gate passes.
- We never run two automatic memory systems in the same project.
- We never delete claude-mem data, and never uninstall the user-level claude-mem.

### 4a.1 Known gaps and questions (from the source read)

| Requirement | Avenox (initial read) | Status |
|---|---|---|
| Automatic retrieval | SessionStart and per-prompt context injection with character limits and modes | Likely satisfied [U: relevance quality] |
| Automatic capture | Agent-written through the `beyin` skill; hooks keep receipts; no chat capture | **Gap versus claude-mem.** Capture depends on Claude's judgment. Mitigation: a deterministic *trigger* (Phase 4 Stop postcondition asking for a memory write when a turn produced decisions or changes) with judgment-based *content*. Honest label: not deterministic |
| Project isolation | Vault-centric. Projects outside the vault go through a user-level bridge with a project-root allowlist and a "project label" | [U] How projects are identified (path or something stronger), whether retrieval filters by project, and what happens on move or clone |
| Reliable project id | Unknown | Likely needs a **minimal adapter**: a `projectId` (UUID) generated at install in the committed `.claude/workspace.json`, passed as Avenox's project scope |
| Portable project-local install | The bridge writes `~/.claude/settings.json` with absolute paths | **Conflict** with our project-local model. Options to evaluate: **(a)** one user vault plus bridge restricted to installed project roots, written by our installer, with ownership recorded and removable; **(b)** a per-project vault inside the project (for example `.beyin/`), if Avenox supports a vault at a subfolder. Pick by isolation, portability and file footprint |
| Token overhead | No background model calls; injection 2–5k characters by mode | Measure against claude-mem (Test 6) |
| Dependencies | Python ≥ 3.11 | New prerequisite (doctor check); the devcontainer image must have it |
| Privacy and telemetry | No telemetry seen in the first read; optional Jev advisor off by default | [U] Audit network calls; doctor keeps Jev off |
| Compatibility | Its 4 hooks add to Superpowers, Caveman, Ponytail and claude-mem hooks; skills and instructions are in Turkish | [U] Hook conflicts, instruction contradictions, language effects on English sessions |

### 4a.2 Steps

1. **Research.** Read Avenox's engine (`beyin_v3*.py`), hooks, bridge, project identity, exclusions, dedupe and compaction code, plus its docs (`GLOBAL-BRIDGE`, `PREFERENCES`, `MIGRATION`, `RUNTIME`). Inventory claude-mem's scope, hooks and data in `~/.claude-mem/`, and check whether migration or import is useful.
2. **Comparison.** Capture, retrieval, context use, isolation, dependencies, lifecycle, and Avenox's economical mode, using measurements and not README claims.
3. **Decision gate.** Proceed only if all seven of the user's criteria hold: retrieval, sufficiently reliable implicit capture, continuity, isolation, low overhead, portable install, compatibility.
   - If capture or isolation needs more than a small adapter, keep claude-mem and document the gap.
4. **Implementation**, the smallest change:
   - pin the Avenox release by version and SHA-256 in `workspace.lock.json`;
   - installer step `memory.backend: "avenox" | "claude-mem"` in `.claude/workspace.json` (one switch, no abstraction framework);
   - project-scoped disable of claude-mem: `enabledPlugins["claude-mem@thedotmack"]: false` in project settings [U: verify a project `false` overrides a user `true`];
   - a capture trigger through the Phase 4 Stop postcondition;
   - doctor memory checks;
   - rollback by flipping the backend switch and removing the project override.
5. **Tests 1–8** from CR-2 (§9). Automated tests are labeled separately from real-session tests.
6. **Documentation:** architecture, install, dependencies, doctor, memory integration, migration and rollback. Remove claude-mem-as-default wording only after the gate passes.

---

## 5. Architecture (rev 3)

```mermaid
flowchart LR
  subgraph CC[Claude Code process]
    CORE[workspace-core mod] -->|skill.prompt, Skill tool.call, PostToolUse, hook-context markers, turn.*| Q[(local JSONL)]
    CORE -->|SessionStart: short usage-report instruction| M[model]
    CORE -->|turn.complete text: observed-usage footer| U[user display]
    CORE -->|tool.call deny / Stop block (Phase 4)| GATE[enforcement]
    CORE -->|$.ui.status| SL[status line]
  end
  Q --> CLI[claude-workspace usage / doctor]
  MEM[memory backend: claude-mem now, Avenox candidate] -.hooks.-> CC
```

The install flow is unchanged from rev 2. There is no dashboard and no long-running service of ours; claude-mem's worker remains its own, while it is the backend.

---

## 6. Activation and enforcement (core objective, unchanged in intent)

- The task-class contracts and gates from rev 1/2 stay.
- `tool.call` gates require process-skill evidence before edits for feature and debug work.
- `classic.Stop` postconditions run at most 2 per request.
- **The usage report is feedback, not enforcement.**
- Overlap resolution through `permissions.deny` stays.
- **Workflow outcomes come before activation counts.** Phase 3 adds outcome checks per class:

| Class | Outcome check |
|---|---|
| Debug | A root cause is stated before any fix, and a reproducing test is run when tools allow |
| Feature | Design or plan before edits |
| Tests | A failing test before the implementation |
| Karpathy | A minimal diff, with no speculative scope |

Each is checked from events plus diffs (programmatic) where possible, and labeled otherwise.

---

## 7. Repository structure (rev 3)

```
claude-workspace/
├─ .claude-plugin/marketplace.json, workspace.lock.json      # + avenox pin in Phase 3M
├─ cli/commands/{install,doctor,repair,uninstall,usage,router}.mjs   # dashboard removed
├─ cli/lib/{settings,manifest,claude,claude-mem,detect,gitignore,report,...}.mjs  # + memory backend step (3M)
├─ plugins/workspace-core/{hooks/register.mjs, lib/{events,sink,usage}.mjs}
├─ observability/{reader,derive}.mjs                         # server/, web/, transcript.mjs removed
├─ policies/{skill-denies.json, ...}   overlays/
├─ tests/{unit,integration,fixtures,live/activation}/
└─ docs/{PLAN.md, observability.md (short), memory.md (3M), baselines/, spikes/}
```

## 8. Lifecycle

Unchanged: install, doctor, repair and uninstall stay idempotent with byte-exact restore.

Phase 3M adds:
- **Doctor memory checks:** backend installed; Python; storage available; project id; hooks or bridge present; a read and write round-trip on a scratch note; conflicts; *claude-mem still active in this project?*; privacy settings.
- **Uninstall:** removes only workspace-owned memory configuration. Vault data is preserved.

## 9. Testing and acceptance (rev 3)

| Area | Test | Pass criterion |
|---|---|---|
| Phase 1 (done) | Install, idempotency, uninstall, telemetry gate | Green on WSL and the devcontainer ✅ |
| Usage evidence | Golden fixtures to per-request evidence and footer text | Matches the snapshot. Denied skills show as denied; nothing "applied" without `skill.prompt` |
| Footer honesty | A live session where the model claims a skill it never invoked (prompted) | The footer flags `not observed (claimed)` |
| Overhead | The activation suite measures injected-instruction tokens | ≤ 120 tokens per session; 0 extra model calls |
| Implicit activation | Activation suite (headless plus an **interactive** variant) | Phase 3 target: at or above baseline and the plan thresholds per class |
| Workflow outcomes | Outcome checks per class (§6) | Phase 3/4 thresholds; reported per class with confidence intervals |
| Memory (3M) | CR-2 Tests 1–8: auto-capture, cross-session retrieval, isolation (2 projects), compaction, updates, token overhead against claude-mem, lifecycle, compatibility | All pass in **real sessions**. Mocked tests are never counted as proof of session behavior |

## 10. Risks (rev 3)

- **Implicit activation does not happen on its own (opus-5-5/medium).**
  - Phase 2R found 0 of 51 answered runs activated a skill: headless and interactive, read-only and write-enabled. The Superpowers bootstrap was verified in context.
  - Explicit requests work.
  - The harness is ruled out (`docs/baselines/2026-11-02-activation-investigation.md`).
  - Phase 3 must create activation through workspace contracts and gates (§6), not rely on the bootstrap.
  - This is the central risk to the project's goal.
- **Self-reported usage can be wrong.** The engine footer exposes mismatches, but it cannot prove instructions were *followed*.
- **Avenox capture is judgment-based.** A deterministic trigger improves reliability but not correctness of content.
- **The Avenox bridge is user-level** and writes absolute paths. Isolation and portability are unverified.
- **claude-mem drifts past its pin** (its marketplace auto-update); doctor warns.
- **Listing overflow:** 6 non-workspace skills are already name-only (99 skills, 29,939 characters). Adding Avenox skills raises the pressure; measure in 3M.
- Router key on Linux is plain text (disclosed). Caveman can't be verified headless.

---

## 11. Roadmap (rev 3)

| Phase | Objective | Key tasks | Completion gate |
|---|---|---|---|
| **0. Spikes** ✅ | Verify premises | L1–L9 | Done |
| **1. Installer foundation** ✅ (macOS run pending) | Pinned, reversible install | CLI, telemetry gate, pins | Green on WSL and the devcontainer |
| **2R. Simplified evidence + usage report** | Truthful, minimal feedback | (1) Spike the `turn.complete {text}` footer. (2) Trim the mod (§4.3), add the usage instruction and footer, `claude-workspace usage`. (3) Remove the dashboard, server and transcript reconciler after `git init` plus an initial commit. (4) Adapt the golden tests. (5) **Investigate the 0% activation baseline** (harness against model behavior; add an interactive suite variant) | Footer correct on the golden tests and in a live interactive check by the user; overhead ≤ 120 tokens; root cause of the 0% baseline understood and documented |
| **3. Orchestration (advise) + workflow-outcome evals + listing optimization** | Implicit, correct workflow use | Classifier, contract injection, Superpowers and Karpathy outcome checks, overlap denies, listing work (rev 2 rules) | Activation and outcome rates above baseline with confidence intervals; listing optimization only on A/B evidence |
| **3M. Memory backend: Avenox evaluation and migration** | Lightweight local memory | §4a steps 1–6 | All 7 decision criteria plus CR-2 Tests 1–8 in real sessions. Otherwise keep claude-mem and document the gaps |
| **4. Enforcement + memory policy** ✅ | Mandatory steps | `tool.call` gates, Stop postconditions (including the memory-capture trigger), compaction restore | Gate and memory tests green |
| **5. Optional router** | Opt-in Jev routing | Enable, test, disable; `view` against `turn.step` | Router tests green |
| **6. Hardening** | Long-term operation | Update and rollback, upstream canary, devcontainer feature, docs | Full §9 suite |

### Phase 6 status (in progress, 2026-11-03; Phase 5 deferred by the user)

**1. Context pressure, built into workspace-core (0.7.1).** The user wanted it in every new environment without a separate install.
- **Mechanism:** on each human prompt, read the engine's live context fill (`$.session.usage().context.tokens`, the status line's figure). It survives `--resume` and is absent after `/clear` or compaction. Over 300K, attach the CLEAR/COMPACT note (same spec as the user's hook), and show `context ~NK: /clear-or-/compact advice attached` in the footer.
- **Switches:** `CW_CONTEXT_PRESSURE=0` disables it; `CW_CONTEXT_PRESSURE_TOKENS` sets the threshold. A user-level `context-pressure` hook takes precedence (no double note).
- **Verified:** unit; engine 5/5; live precedence (user hook fired, built-in silent); live built-in note on a resumed session with `--setting-sources project,local` (note delivered, Claude answered CLEAR plus a handoff note).
- **Bug found by the live check:** the first version used only in-process step usage, so a resumed process started at 0. Fixed with the engine figure.

**2. Upstream canary** (`claude-workspace canary`, read-only).
- **What it does:** `git ls-remote` per pin and `npm view claude-mem`.
- **First run:** router 1.19.2 available; claude-mem 15.9.0 (pin was 15.8.0, installed 15.9.0 through auto-update); caveman and ponytail are current but pinned to commits other than the tagged ones.

**3. Update and rollback.**
- **`repair`:**
  - refreshes the marketplace (`claude plugin marketplace update`);
  - updates workspace-core when its version differs from this checkout. It has no SHA pin, so before this fix repair never updated it, which matters for GitHub installs, where the cached copy runs;
  - re-points the marketplace with `--marketplace` (update or rollback by tag);
  - records the previous versions in the manifest (last 5).
- **`rollback`:** prints the exact steps (`git checkout <recorded commit>` plus `repair`, or `npx github:<repo>#<old-tag> repair`). It does not run another version's code itself.
- **Verified:** fixture 0.7.0 → 0.7.1 updated; a second run made 0 changes; rollback named commit `51884cd`.

**4. Pins:** claude-mem 15.8.0 → 15.9.0 (in use all session; telemetry OFF verified). Workspace version 0.1.0 → 0.7.1 (lock and package.json).

**5. Devcontainer feature** (`devcontainer/src/claude-workspace`).
- **Image build (root):** installs the CLI only.
  - Default source: a bundled `npm pack` payload (`npm run build:feature`), so it needs no published repo.
  - Alternative: an npx spec (`github:<owner>/<repo>#<tag>`).
- **Post-create (remote user, in the workspace folder):**
  - installs Claude Code at the lock's tested version;
  - runs `claude-workspace install`. claude-mem consent comes from the `claudeMem` option.
  - Never fails container creation.
- **Verified live** (Docker 29.9.2, devcontainer CLI 0.90.0, `javascript-node:22`; no model usage):
  - Claude Code 2.1.316 installed;
  - all pins verified, claude-mem 15.9.0 installed with telemetry OFF;
  - `doctor` passed all required checks;
  - a second install made 0 changes.
- **Runner:** `tests/live/devcontainer/run.sh`.
- **Caveat:** without the `marketplace` option, `.claude/settings.json` points at a container-only path. Teams set `marketplace` to a published `<owner>/<repo>#<tag>`.

**6. Published (2026-11-03):** public repo https://github.com/Bey3fendi/claude-workspace (MIT, copyright Bey3fendi).
- Tags v0.7.1 and v0.7.2; CI runs the tests and publishes the feature on each `v*` tag.
- Feature: `ghcr.io/bey3fendi/claude-workspace/claude-workspace:0`, anonymously pullable.
- Verified live in Docker: feature with `source: github:Bey3fendi/claude-workspace#v0.7.2` and `marketplace: Bey3fendi/claude-workspace#v0.7.2` installed Claude Code 2.1.316 and all pinned plugins from the GitHub marketplace; `doctor` passed.
- v0.7.2 fixes the feature installing the latest Claude Code instead of the tested version for non-bundled sources.

**7. QA pass on the released versions** (see `docs/baselines/2026-11-03-phase6-qa.md`):
- Live: outcomes 8/8, activation smoke, `/clear` handoff with claude-mem (new runner), compaction restore, and a GitHub-installed project. All on Claude Code 2.1.317, which is now in the tested list.
- Two bugs fixed in v0.7.3: rollback history lost on a re-point, and a debug classifier miss.

**8. Plan execution: Native only (2026-11-11, v0.7.4).** The user's choice: implement every plan task inline in the current session, with one fresh review of the whole branch at the end. This is Superpowers 7.0.1's "Native" mode, `superpowers:executing-plans`.
- `superpowers:subagent-driven-development` is denied (37 rules).
- workspace-core states the method on every main-conversation SessionStart (startup, resume, clear, compact), so writing-plans' handoff treats it as the supplied method. `CW_PLAN_EXECUTION=0` drops the note.
- **Live** (`tests/live/plan-execution/run.mjs`): with a plan whose header recommends subagent-driven-development, the session loaded executing-plans and made 4 main-session edits, 0 subagent edits, and 1 subagent (the whole-branch review, whose finding was then fixed). It made one commit per task and caused no new test failures. Cost $0.73.
- **Not measured live:** the writing-plans handoff itself (it needs a brainstorm-to-plan session). That path is covered by the engine test of the note.

**9. md-memory replaces claude-mem (2026-11-11, v0.8.0).** The user's choice, because of claude-mem's load (a worker process, a database, Bun and uv, background model calls). Supersedes CR-2 and the Avenox gate.
- **What it is:** the user's own POC, ported into workspace-core as engine hooks (`lib/md-memory.mjs`, wired in `hooks/register.mjs`). Plain Markdown in `.memory/`:
  - `session.md` is a rolling log, loaded at every main-conversation SessionStart and capped at 150 lines (oldest blocks dropped at Stop);
  - `context.md` and `decisions.md` hold `## ` sections with `<!-- paths: … -->`, injected once per session on the first Read or Edit of a matching file;
  - an automatic compaction first appends a git snapshot.
- **Capture is the model's judgment,** guided by rules stated at session start. The context-pressure note is the deterministic trigger: it asks for a handoff block in session.md before CLEAR or COMPACT, and nothing is pasted back. The user-level `context-pressure.sh` was updated to say the same in md-memory projects.
- **claude-mem:** no longer installed, checked or denied (12 rules remain). In a project with a leftover user-level install, install sets `enabledPlugins["claude-mem@thedotmack"]: false` and doctor warns. `remove-claude-mem` runs its own uninstaller after confirmation; `~/.claude-mem` data is kept.
- POC fixes: brace globs like `src/{a,b}/**` were split on their commas; template examples are indented so they are not parsed as sections.
- **Location `.memory/`, not the POC's `.claude/memory/` (live finding, Claude Code 2.1.317).** Claude Code treats every file under `.claude/` as sensitive. It refused the model's handoff edit there whatever the allow rules, `--allowedTools` or acceptEdits said, and an interactive session would ask on every write. Also measured: allow rules in the shared `.claude/settings.json` are ignored (even a bare `Edit`), while `.claude/settings.local.json` and `--settings` are honoured. And `Write(path)` rules are never matched (`Edit(path)` covers every file-editing tool). So install writes one rule, `Edit(.memory/**)`, to `settings.local.json`, which is tracked like the other touched files and gitignored.
- **Live:** `tests/live/clear-handoff/run.mjs` passed. The pressure note (from the user-level hook) led the model to write the handoff into `.memory/session.md` with src/ untouched; after `/clear`, workspace-core reloaded it (memory event `session-start`, source `clear`, and the transcript carries the injected handoff), and the answer recapped the work without opening files. About $0.69. A probe also confirmed a `context.md` section is injected after a Read of a matching file (1 inject event; the model quoted the marker).

**10. Caveman removed (2026-11-11, v0.9.0).** The user's choice: the workspace no longer includes anything that does what Caveman did (shorter output style).
- Gone: the caveman pin in the lock, `overlays/caveman.json` and `.caveman.json`, the doctor `caveman-mode` check, and its 11 deny rules (1 rule remains: `subagent-driven-development`).
- **Existing projects:** `repair` uninstalls plugins an earlier version installed but the lock no longer has (here `caveman@cw-workspace`). It returns `.caveman.json` to its pre-install state if nobody edited it since; an edited one is kept. Uninstall still handles a `.caveman.json` in an old manifest.
- The Caveman context marker in the observability events stays, so a leftover install still shows up in the Workspace Usage report.
- **Bug fixed (found during this change; in earlier versions too): one project's uninstall or re-point broke every other project.** Claude Code keeps marketplaces in one per-user registry, even when they are declared at project scope, and `claude plugin marketplace remove` uninstalls the marketplace's plugins in every project. Measured live on 2.1.317 with two projects: uninstall in A left B with 0 of 4 plugins and a failing doctor. Now:
  - uninstall keeps the marketplace registered while another project (still on disk) has plugins from it;
  - a re-point (`repair --marketplace …`) records the other projects first and reinstalls their plugins from the new source;
  - empty `extraKnownMarketplaces: {}` objects that Claude Code leaves behind are cleaned up.
  - Live: A re-point, then A uninstall → B kept 4/4 plugins, doctor ok; the last uninstall removed the marketplace and both folders were back to their original files.

**11. Default CLAUDE.md; Karpathy guidelines vendored into it (2026-11-11, v0.10.0).** Implements `docs/claude-md-integration.md` (the user's spec; its "after 19 Nov" hold was lifted by the user).
- `install` writes `.claude/workspace/CLAUDE.workspace.md` from `templates/CLAUDE.workspace.md` and adds a three-line managed block (`@.claude/workspace/CLAUDE.workspace.md` between HTML-comment markers) to `CLAUDE.md`, or `CLAUDE.local.md` with `--claude-md=local`; `--no-claude-md` skips it. Every row of the spec's install and uninstall tables is covered by tests (`tests/unit/claude-md.test.mjs`, lifecycle tests).
- Karpathy: the `andrej-karpathy-skills` plugin is gone (repair uninstalls it). Its `CLAUDE.md` is vendored unmodified at the same pin (`vendor/karpathy/`, sha256 in the lock, MIT notice in `vendor/karpathy/LICENSE`; upstream ships no LICENSE file). Rendered with its title dropped and `##` demoted to `###`. Contracts no longer name the skill.
- Deviations from the spec, each for a reason:
  - paths are `.memory/` (since 0.8.0), not `.claude/memory/`;
  - the upstream repo is `multica-ai/andrej-karpathy-skills` (what the lock pinned; it names forrestchang as author), not `forrestchang/…`;
  - the gitignore block now ignores `.claude/workspace/*` with `!.claude/workspace/CLAUDE.workspace.md`, because the spec wants the owned file committed and the old `.claude/workspace/` rule would have hidden it from teammates;
  - CLAUDE.md is tracked like the other touched files, so the dirty-tree check and the byte-exact restore cover it;
  - workspace-core skips the md-memory rules at SessionStart when the import is present (no double rules), and records a `claude-md` event so the footer can say "Karpathy guidelines (loaded via CLAUDE.md)";
  - no `--dry-run` (the CLI has none); `docs/cheatsheet.annotations.json` does not exist, so nothing to change there.
- Size: the rendered file is 80 lines, about 1,000 tokens per session (cached after the first request). Doctor warns above 100.
- **Live (Claude Code 2.1.317):**
  - Upgrade: a project installed with v0.9.0 (its own CLAUDE.md committed), then `repair` from 0.10.0: the Karpathy plugin was uninstalled, the user's text kept with the block appended, doctor all ok. Only `.claude/workspace/CLAUDE.workspace.md` shows as untracked, so it can be committed.
  - Acceptance (haiku, every file tool disallowed): asked for the md-memory rules, the model gave them word for word from the imported file; asked for the Surgical Changes test sentence, it quoted it verbatim. About $0.01 in all.
  - **Finding:** Claude Code strips HTML comments from CLAUDE.md before the model sees them. The block markers and the attribution comment are therefore invisible to the model (the model could not quote the vendored commit hash). That suits the markers; the attribution is for people, and the full notice is in `vendor/karpathy/LICENSE`.
  - Not checked: whether an interactive session asks to approve the import the first time (headless runs show no prompt). Claude Code documents an approval for imports outside the project; this one is inside it.

**12. Subagent cap: at most Opus 5.5 at high effort (2026-11-11, v0.11.0).** The user asked to stop Superpowers' final review from using the costliest model.
- Checked: Superpowers 7.0.1 says to dispatch the final review "on the most capable available model" (executing-plans Final Review, writing-plans Native mode, subagent-driven-development Model Selection). In this Claude Code that is Fable. No skill limits effort.
- workspace-core `turn.step` (subagent loops only, `e.agentId` set): a Fable model becomes `claude-opus-5-5`, and `xhigh` or `max` effort becomes `high`. A numeric effort and every cheaper choice are kept. The main loop is never changed. A `subagent-cap` event is recorded on the first request it rewrites.
- `agent.spawn`: an explicit `model: fable` becomes Opus 5.5 before the model is resolved, so the subagent's identity line matches what serves it. With no model given, the spawn is left alone, because the agent's own model may be cheaper; `turn.step` still caps each request.
- `CW_SUBAGENT_CAP=0` turns both off. Engine tests: `plugins/workspace-core/tests/subagent-cap.test.ts` (6).
- **Live (2.1.317, `claude -p`, about $0.70 in all), evidence from the engine's records, not the model's word:**
  - Sonnet main loop, Agent call with `model: fable, effort: max`: `modelUsage` lists Sonnet and Opus 5.5 only; the subagent's API request carries `output_config.effort: "high"`; every assistant message in its transcript is `claude-opus-5-5`.
  - Fable main loop, Agent call with no model: the subagent's requests went to Opus 5.5 (the Fable entry in `modelUsage` is the main loop's own).
  - **Finding:** rewriting the model in the result after `next(e)` of `agent.spawn` did not change the subagent's identity line (it still said Fable while Opus served it). Rewriting the input before `next` does. In the inherited case the identity line still names Fable; only the requests are capped.

**13. Explain, slim version (2026-11-11, v0.12.0).** From `docs/explain-spec.md` (the user's proposal). Agreed with the user: no gates, local only, build the slim version first and judge it.
- **Built:** a `workspace-core:explain` skill with `disable-model-invocation: true` (only the developer runs it, so it costs nothing in normal turns and is not in the model's listing). workspace-core:
  - remembers each Bash command and its exit code (in memory), the human prompts, the skills used and the time of the last source edit;
  - on `/explain [commit]`, builds the change record with git (`diff HEAD` plus untracked files, or `show <commit>`; `.explain/`, `.memory/` and `.claude/` excluded), writes it to `.explain/records/u-NNNN.json` and appends it to the skill's prompt;
  - when the model saves `.explain/units/u-NNNN.md`, runs the validator (8 rules, `lib/explain.mjs`) and returns failures in the tool result, at most twice; nothing is denied;
  - adds footer lines: `explain u-NNNN: n/8 checks`, and `commit made: /explain HEAD explains it`.
- **Install:** `.explain/` joins the managed gitignore block; `Edit(.explain/**)` joins the allow rules in `settings.local.json`; doctor has an `explain` check. `CW_EXPLAIN=0` and `CW_EXPLAIN_WORDS`.
- **Not built (from the spec):** Stop and commit gates, comprehension checks and understanding debt, the developer profile, MAP.md, TIMELINE.md, commit roll-ups, the post-commit git hook. The spec's `.claude/explain/` would not work: Claude Code treats every `.claude/` path as sensitive (see md-memory), hence `.explain/`.
- **Tests:** `tests/unit/explain.test.mjs` (10: parsing, record, every validator rule passing and failing, footer, install wiring), engine `tests/explain.test.ts` (5).
- **Live (2.1.317, `claude -p` with two messages in one process, Sonnet, about $0.29 in all):**
  - Change + `/workspace-core:explain`: the record held both files with the right line ranges and both `node --test` runs; the model's file passed 8/8 at the first save; the footer showed `explain u-0001: 8/8 checks`.
  - Commit + `/explain HEAD` (the short name works): the footer suggested it after the commit; u-0002 passed 8/8 and said "The tests were not run in this session" (the commands were from the previous process).
  - **Finding:** `node --test 2>&1 | tail -10` records `tail`'s exit code. The model noticed and said so; the record now flags piped commands and names such a run as verification only with that caveat.
  - **Fixed on the way:** a skill typed as a slash command loads before its turn starts, and the footer dropped it ("no skill activations observed"). The tracker now keeps what arrived since the last answer.
- **Judge it by:** whether you read the "In short" and the file, and whether a teammate who didn't watch can say what changed, why, and where to start in 2 minutes (the spec's acceptance test).

**14. Workspace QA round and fixes (2026-11-11, v0.12.1).** Full validation on WSL2 with Claude Code 2.1.317: `WORKSPACE_TEST_REPORT.md` (85 passed, 1 failed (low, open), 2 blocked by the usage budget, 5 not tested), and a developer playbook, `WORKSPACE_DEVELOPER_GUIDE.md`, with every flag and switch.
- Fixed, with regression tests:
  - `/explain` now gets the diff (old and new lines, capped at 12,000 chars), so the model never needs git;
  - invalid settings JSON is refused before any backup is written;
  - `--version` works without a command;
  - doctor's gitignore line names `.explain/`;
  - uninstall warns that `.explain/` is kept;
  - the skill says the Write tool creates the folder (no `mkdir`).
- Open (low): Node < 14 gets a SyntaxError instead of the version message; a re-point reorders keys in `settings.json`.
- Remaining live runs (next window, at most 40%): `clear-handoff` and `plan-execution` (see the report's checkpoint).

**15. Classifier: new-app tickets (2026-11-11, v0.12.2).** A ticket to build a new app went to `debug` when it described error behaviour ("show an error message when the title is empty") and to `tests` when it asked for tests.
- A "new-build" rule now runs before the tests and debug rules. It matches "new … app/project/service/…" (up to two words in between), "from scratch", "greenfield" and user stories ("As a user I want …"). The result is `feature`, or `architecture` when the ticket asks for design.
- It gives way to real breakage: a prompt that starts with fix/debug/investigate, or one that reports a failure without asking for anything to be built ("The new app crashes on start"), stays `debug`.
- Error behaviour a build request asks for ("error handling", "show an error message", "throws an error") no longer triggers `debug`. The stripping applies only when the prompt asks for something to be built, so "Saving shows an error message instead of the task" is still `debug`.
- Still English only; a ticket in another language gets no contract.

**16. Automatic memory (2026-11-11, v0.13.0).** Goal: md-memory fills itself, and a new session (after a context-pressure `/clear`, say) knows what is going on and checks the decisions for a file before touching it.
- The feature and architecture contracts say: once agreed, record the decisions in `decisions.md` and the module facts in `context.md`.
- **Nudge** (`classic.Stop` block, once per request): a request with a design step (brainstorming or writing-plans, or an architecture request) that changed files and added nothing to either file is asked to record them, then finishes. `CW_MEMORY_NUDGE=0`.
- **Facts-only block** (once per request, at Stop): written when files changed and Claude wrote no block. It holds the request's first line (redacted), the files (tool edits plus the git status diff since the request began, so Bash edits count), the last check after the last edit (the command's first line only), and the new `decisions.md` / `context.md` headings. A Claude-written block, through any tool, suppresses it. `CW_MEMORY_AUTOLOG=0`.
- **Pre-edit hold**: the first edit of a file whose notes this agent has not seen is not applied; the notes come back as the reason, and the retry goes through. Subagents get the notes on their own. `CW_MEMORY_PREEDIT=0`.
- Live (Sonnet, 4 runs, about $0.65 with the first attempt):
  - notes injected and followed (Math.floor);
  - the nudge produced a `decisions.md` and a `context.md` section;
  - the hold delivered the decisions before a new file was written;
  - a fresh session with every tool disabled reported the last work and the decisions from the auto-loaded log.
  - The first attempt found two bugs, now fixed and tested: Bash-written memory went unseen, and a heredoc that mentioned a test counted as the check.

**17. ADHD-friendly response style (2026-11-12, v0.14.0).** A "Response style" section in the workspace file (8 rules: answer first, short sentences, steps, commands in one block, a closing next step, at most one question, no filler, chat replies only).
- On by default. `--no-response-style` leaves it out; the choice is kept in `.claude/workspace.json` (`claudeMd.responseStyle`), and doctor compares against the chosen variant. `--response-style` puts it back.
- Advisory: an instruction, not checked by the engine.
- Live (Sonnet, same question with and without it, $0.08): with it, the answer opened with the result and ended with a "Next:" line; without it, it opened with a preamble and had no next step.
- The file grows from 80 to 89 lines (limit 100).

**Open:**
- **macOS run.**

### Phase 3M result (2026-11-03)

- **Gate not met; claude-mem stays** (`docs/baselines/2026-11-03-phase3m-research.md`).
- **What Avenox does better:** overhead (≈0.1 s per hook, <1k chars, no LLM capture spend) and receipt isolation (path hash).
- **Where it falls short:** retrieval is lexical only (a paraphrase abstained); capture depends on the agent writing notes; notes are filtered by folder label; the bridge's own install edits global settings.
- **Revisit** after the Phase 4 capture trigger exists.

### Phase 4 status (done, 2026-11-03)

**Step 1: root-cause gate** (`docs/baselines/2026-11-03-phase4-root-cause-gate.md`).
- **Mechanism:** a `tool.call` hold on the first source edit of a debug request, until the streamed visible text states a root cause. At most 2 holds per request; `CW_GATES=0` disables it.
- **Verified:** unit tests and engine-level `claude plugin test` (3/3).
- **Live:** the gate A/B (`nogate` vs `with`, n=3) gave **0/3 vs 3/3**. Pooled: **5/5 [57–100] vs 1/6 [3–56]**. One live deny, after which the model stated the root cause and fixed it.

**Step 2: compaction restore** (`docs/baselines/2026-11-03-phase4-compaction-restore.md`).
- **Mechanism:** `classic.SessionStart(source: compact)` re-attaches the active request's contract, marking what is already done and deferring to the user's instructions.
- **Verified:** unit, engine (2/2), and live twice (restore text in the transcript after the compaction boundary).

**Step 3: claude-mem isolation check** (doctor, read-only, advisory).
- **Background:** claude-mem keys memories by project *name*. That is the folder basename by default (`CLAUDE_MEM_PROJECT_NAME_SOURCE=path`), or `owner/repo` from the origin remote with `git-remote`, falling back to the basename.
- **Check:** doctor opens `claude-mem.db` read-only (`node:sqlite`). It warns when this project's key is also recorded for other directories, and prints the count only, never the other paths.
- **Verified:** unit tests, plus a real fixture where `shop-cart` is shared with 5 other directories.
- **Not changed:** switching to `git-remote` is a user-level claude-mem setting that re-keys new memories. Doctor names it as an option and does not set it.

**Stop postconditions: not added.** No outcome check shows a gap that one would close (feature 2/2, TDD 2/2, coverage 2/2; debug is now gated). Adding one without evidence would only add turns and tokens.

**Phase 4 completion gate (2026-11-03): met.**
- Outcome suite with everything on (`outcomes --conditions with --runs 1`, $1.00): **4/4 PASS**. Debug (root cause before fix), feature (design before edit), TDD (red before green) and coverage (tests run): no regression from the gates or the restore.
- Gate tests: unit, engine and live (A/B 5/5 vs 1/6, one live deny/recover).
- Memory: compaction restore live 2/2; claude-mem isolation check.
- Usage: the 5-hour window ended at 95%, the user's limit.

**Outside the repo (user-level, by user request):** `~/.claude/hooks/context-pressure.sh` (WSL), a `UserPromptSubmit` hook.
- Over 300K context tokens, it asks Claude to recommend CLEAR or COMPACT at a natural stopping point, with a cold-start handoff note.
- It works alongside claude-mem's own `SessionStart(clear)` injection.
- Verified: 14 script tests plus a live session.

### Phase 3 status (in progress, 2026-11-02)

**Step 1: classifier plus advisory contracts.**
- **Mechanism:** a local keyword classifier (`lib/contracts.mjs`, no model calls). A `prompt.submit` hook attaches one short contract as model-only context, and records only the class. `CW_CONTRACTS=0` turns it off.
- **A/B** (`docs/baselines/2026-11-02-phase3-contracts-ab.md`, 14 prompts × contracts on/off):
  - activation 6/12 vs 0/12, +50 points, 95% CI [+15, +75];
  - classifier 14/14;
  - overhead is noise (−51 tokens per request);
  - trivial prompts: no over-activation.
- **Misses** were disclosed and mostly correct, which led to three changes:
  - the review contract is outcome-only, since no skill fits and the class is unscored;
  - the tests contract picks TDD or verification depending on the request;
  - the activation runner's budget flag is opt-in, because the model sees the budget and economises.
- **Cost control in the runner:**
  - smoke mode by default (7 runs, `with` only);
  - the reference is not re-run;
  - the run stops at the first usage-limit error;
  - a cost line in every report.

**Smoke check of the revised contracts (`docs/baselines/2026-11-02-phase3-smoke.md`):** 5/5 scored, trivial with no over-activation, review outcome-only; $1.59 for 7 runs.

**Step 2: workflow-outcome checks (§6)**, see `docs/baselines/2026-11-02-phase3-outcomes.md`.
- **Tooling:** `tests/live/outcomes/`, graded from stream-json engine events plus the fixture's git state, with an offline re-grader.
- **Run 1:** 1/4 runs passed all hard checks without contracts vs 2/4 with them. It exposed:
  - a grader defect and a fixture defect;
  - a TDD prompt misclassified as feature;
  - debug contract wording that was too indirect.
- **After the fixes:** the debug and TDD rechecks pass (root cause before the edit; test → red → src).
- **Cost:** $2.61 in total.

**Step 3: overlap denies** (`docs/overlaps.md`).
- **Added:** 5 deny rules for the Caveman Cloud skills, out of scope because cloud is off, bringing the total to 36.
- **Reviewed and allowed:** the review, minimal-change, delegation and local-tooling overlaps. Across the 45 Phase 3 runs, all 16 activations were contract skills.
- **New test:** no contract skill may ever be denied.
- **Existing installs:** `doctor` warns and `repair` adds the rules.

**Step 4: listing work** (`docs/baselines/2026-11-02-phase3-listing-ab.md`).
- **Change:** a `prompt.attachment` hook drops the skills denied by `permissions.deny` from the model-facing listing (workspace-core 0.5.0).
- **A/B, trim off vs on (14 runs, $3.13):**
  - activation 5/5 in both, with identical skills;
  - listing 30,004 → 20,381 characters;
  - context per request −3.1k tokens;
  - cost per run −6.5%.
- **Discoverability:** no invocable skill was removed.

**Gate measurement** (`docs/baselines/2026-11-02-phase3-gate.md`; 36 runs, $7.46; usage guard at 60% never tripped).
- **Activation: met.** 20/20, 95% CI [84–100], vs 0/51 [0–7]. workspace-core agreed with the probe 28/28.
- **Outcomes:** 6/8 runs passed all hard checks with contracts, vs 1/4 without.
  - Feature design-first: 2/2. TDD order: 2/2. Coverage: 2/2.
  - **Root cause before fix: 0/2.** The model loads systematic-debugging and then edits first; it is 1/3 across all with-contract runs.
  - The outcome difference is not significant at this sample size.
- **Handed to Phase 4:** enforce "root cause before fix" with a `tool.call` gate, since advice alone does not secure it.

**Phase 3: complete**, pending the user's acceptance of the gate verdict.


### Phase 2R status (2026-11-02)

- **Done:**
  - the mod is trimmed;
  - the usage instruction is about 400 characters (~100 tokens, a cached session-scoped section);
  - the engine footer (`turn.complete {text}`);
  - `lib/usage.mjs`;
  - `claude-workspace usage`;
  - the dashboard, server, web UI and transcript reconciler are removed;
  - goldens adapted (34/34 tests; `--strict` validation passes);
  - `docs/observability.md` rewritten.
- **Live:**
  - the footer renders in the interactive TUI, and is in the transcript and events for `-p`;
  - the model refused a requested false claim, and the footer agreed.
- **Baseline:**
  - 0% activation is genuine model behavior (§10);
  - the 2026-11-01 report was corrected, because 42 of 84 runs had hit the usage limit and were miscounted as OK;
  - the runner is fixed.
- **User check passed (2026-11-02, falling-brick-game, WSL):**
  - a substantive task got a truthful section ("Applied: none") and a visible footer reading "report matches engine events";
  - a trivial question got neither.
- **Gate: met.**

### Phase 2 status before rev 3 (for the record)

The full pipeline was built and passed 34/34 tests:
- the mod, passing `--strict` validation;
- JSONL storage;
- derivation;
- a dashboard on a loopback-only port;
- golden tests.

Two live results:
- **Interactive check by the user:** passed, with the status line working and Caveman observed.
- **Baseline report** (`docs/baselines/2026-11-01-activation.md`):
  - activation 0/36 with the mod and 0/36 without (difference 0.0);
  - context per request delta −196 tokens (noise);
  - listing identical with and without the mod (99 skills, 6 non-workspace name-only, 0 mandatory name-only);
  - the mod agreed with the independent probe 42/42.

Rev 3 keeps the mod, writer, tests and suite, and removes the dashboard layer per §4.3.

## Verification

- **Rule:** every phase gates on its row in §11.
- **Evidence:** live checks use engine events (`claude -p` and interactive), never the model's own statements.
- **Labels:** mocked tests are labeled as such.
