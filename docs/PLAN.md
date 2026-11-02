# Claude Workspace: Technical Plan (rev 3)

## What changed in rev 3

Two change requests from the user shape this revision.

- **CR-1: simplify observability.** The goal is that Claude automatically uses the right installed capabilities, briefly says what it used, and makes no unsupported claims.
  - The dashboard, the detailed history, the reconciliation engine and the analytics are dropped.
  - They are replaced by a concise **Workspace Usage** report and minimal verification of skill events.
  - **Priority:** correct Superpowers workflow outcomes and relevant Karpathy guidance matter more than counting activation events.
- **CR-2: memory backend.** We will evaluate **Avenox Beyin V3** as the replacement for claude-mem.
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
| **4. Enforcement + memory policy** | Mandatory steps | `tool.call` gates, Stop postconditions (including the memory-capture trigger), compaction restore | Gate and memory tests green |
| **5. Optional router** | Opt-in Jev routing | Enable, test, disable; `view` against `turn.step` | Router tests green |
| **6. Hardening** | Long-term operation | Update and rollback, upstream canary, devcontainer feature, docs | Full §9 suite |

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

**Next:**
- listing work, gated on A/B evidence.

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
