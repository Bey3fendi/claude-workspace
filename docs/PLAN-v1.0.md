# claude-workspace: plan to v1.0

Based on `Bey3fendi/claude-workspace` at v0.19.2 (commit `17370af`), reviewed 2026-11-16.
This replaces the 14-point list from the earlier review. Section 4 says what changed and why.

## 1. What 1.0 means

**Goal:** anyone who uses Claude Code can install the workspace into a new or an existing project with one command, and it behaves the same way on every run.

1.0 is done when all five hold:

1. **Every promise is labelled.** Each feature in the README is either *enforced* (a hook does it, and its tests pass 100%) or *advice* (the model is asked, and the README shows the measured rate).
2. **No silent failures.** A hook that throws is recorded and shown to the user. Today it disappears.
3. **It is not worse than plain Claude Code.** On the release suite, the default profile matches or beats a `CW_OFF=1` run on task success, and the extra cost is known.
4. **The release gate passes** (section 7) on the current Claude Code, on Sonnet and Opus.
5. **It runs where people work:** Linux, WSL2, macOS and a devcontainer.

## 2. Why it is inconsistent today

The CLI (install, uninstall, repair, doctor) is solid. The inconsistency is in `workspace-core`, and it has four causes.

| # | Cause | Evidence |
|---|---|---|
| 1 | **A regex decides which instructions are sent.** Wrong class means wrong workflow, and no class means plain Claude Code. | On 40 prompts I labelled, `classify()` matched my label on 21. It attached a contract to 6 that needed none ("add a comment above this function" → brainstorming; "update the error message in login.ts" → debug, so the gate would hold the edit). It missed 13, including all 4 Turkish prompts and "it returns 500 when the body is empty". Small sample, my labels. |
| 2 | **Most features ask the model; few force it.** Asking varies from run to run. | The repo's own data: skills fired on their own in 0 of 51 runs. With the gate off, a root cause was stated first in 1 of 6 runs; with it on, 5 of 5. |
| 3 | **Too many voices per request.** | One request can get a contract, a Ponytail rule, memory notes, a held edit and a gate hold. At the end, Claude can be sent back up to 3 times (stop check twice, then the stale-notes ask). The decisions nudge and the Ponytail closing ask are dropped when another ask fired first, so the same request ends differently between runs. |
| 4 | **Failures leave no trace.** | I injected a fault into three hooks in a scratch copy. The Bash and Stop hooks swallowed it with no record. In `prompt.submit` the contract was dropped and nothing was logged. |

Two more facts shape the plan:

- **Validation is behind the code.** The last full test report covers 0.12.0. Versions 0.13 to 0.19.2 added about ten features (automatic memory, Ponytail driving, the safety guard, `/ci`, follow-ups, Bash edits, check hooks, auto-mode trust, stale notes, attribution), each tested alone.
- **Everything rests on Claude Code's module-hook API** (`prompt.submit`, `tool.call`, `turn.step`). The lock lists 2.1.316 and 2.1.317 as tested. I ran the 74 engine tests on 2.1.325 and they pass, but nothing checks this automatically.

## 3. Rules that decide scope

- **R1. Enforce, or label it advice.** If a hook cannot guarantee a promise, the promise is advice: off by default, or shown with its measured rate.
- **R2. Routing favours precision.** A missed contract costs nothing (the user gets plain Claude Code). A wrong contract costs a turn and trust.
- **R3. One interruption.** At the end of a request, at most one advisory message.
- **R4. Fail open and loud.** A hook error never blocks the user and is always recorded.
- **R5. Freeze.** Until 1.0, nothing new runs unless the user types it. New slash commands and install flags are allowed; new automatic behaviour is not.
- **R6. Neutral defaults.** Personal taste lives in a profile.
- **R7. No tag without the gate.**

## 4. What changed from the 14-point list

| Earlier item | Verdict | Change |
|---|---|---|
| 1 Freeze | Keep | Now rule R5, with a precise definition. |
| 2 Double-run risk in `.catch(next)` | **Resolved** | I tested it. A fault after `next()` in the Bash hook ran the command once, and in the Stop hook ran downstream hooks once (engine test kit, Claude Code 2.1.325). Keep the two tests as regression tests. The real problem is the silence (M1). |
| 3 Log hook errors, engine tests in CI | Keep, enlarge | 5 of the 21 hooks have no catch at all. `claude plugin test` needs no login, so CI can run it. |
| 4 Detect the test command | Keep, change | A greenfield project gets `"auto"`, resolved at run time. A hook never writes to a committed file mid-session. |
| 5 Classifier | Change | Three layers: slash modes, language-independent signals, then narrow keywords. The corpus test gates on false contracts, not on recall. |
| 6 One end-of-request message | Keep | Specified as a state machine (M4). The earlier "up to four" was wrong; the code allows three. |
| 7 Profiles | Keep | Three concrete profiles (section 5). Existing installs keep today's behaviour. |
| 8 Precedence rule in `CLAUDE.workspace.md` | **Drop** | It is one more line of advice. The response style leaves the default profile, so the conflict is gone. |
| 9 State on disk | Keep | Store flags and exit codes, never prompt or command text. |
| 10 Action-based gate | Change | Not every bug has a failing command. Release on evidence *or* on a root-cause line that names a real file. Bash edits are reported, not blocked. |
| 11 Gitignore `session.md` | Keep | |
| 12 Seed `context.md` | Change | No empty stubs: an empty section would be injected as an empty note. One generated "Project facts" section, plus an opt-in `/memory-bootstrap`. |
| 13 Release gate | Keep, enlarge | Adds a `CW_OFF=1` baseline, pass thresholds, and Sonnet. |
| 14 Claude Code in `canary` | Keep, enlarge | Plus a weekly CI run of the engine tests on the latest Claude Code. |

**Added:** contracts as data (so a skill pack can be swapped), a docs rewrite, macOS in CI, and showing the active check commands to the user.
**Moved to 1.1:** the LLM-wiki ideas (sources folder, index, `/memory-lint`), a second skill pack, the router.

## 5. Profiles

`install --profile core|standard|full`, stored in `.claude/workspace.json`. `CW_*` variables still override.

| Feature | Kind | core | standard | full |
|---|---|:-:|:-:|:-:|
| Install, doctor, repair, uninstall, rollback | CLI | ✓ | ✓ | ✓ |
| Safety guard (deny rules and Bash check) | enforced | ✓ | ✓ | ✓ |
| Stop check and edit check, auto-detected | enforced | ✓ | ✓ | ✓ |
| Session log: loaded at start, facts-only entry written at the end | enforced | ✓ | ✓ | ✓ |
| `context.md` / `decisions.md` notes injected by path | enforced | ✓ | ✓ | ✓ |
| Footer, event log, hook-error report | enforced | ✓ | ✓ | ✓ |
| `/ci`, `/explain` | user-typed | ✓ | ✓ | ✓ |
| Skill pack (Superpowers, pinned) | plugin | | ✓ | ✓ |
| `/debug`, `/feature`, `/tests`, `/review` | user-typed | | ✓ | ✓ |
| Contracts from signals and narrow keywords | advice, measured | | ✓ | ✓ |
| Root-cause gate | enforced | | ✓ | ✓ |
| Compaction restore, context-pressure note | advice | | ✓ | ✓ |
| Stale-notes ask | advice | | ✓ | ✓ |
| Karpathy guidelines in `CLAUDE.md` | advice | | ✓ | ✓ |
| Ponytail plugin and driving | advice | | | ✓ |
| Decisions nudge | advice | | | ✓ |
| Response style | advice | | | ✓ |
| Claude attribution removed | setting | | | ✓ |
| Subagent cap (Opus 5.5, high) | enforced | | | ✓ |
| Native plan execution, subagent mode denied | setting | | | ✓ |

- **New installs:** `standard`.
- **Existing installs:** `repair` records `full`, so nobody's setup changes without them asking.
- `core` has no third-party plugin. It is the fallback when an upstream breaks.

## 6. Milestones

Sizes are rough: S is under a day, M is one to three days, L is about a week.

### M0. Freeze and baseline (S)

| ID | Task | Done when |
|---|---|---|
| 0.1 | State the freeze (R5) in the README. Move `docs/PLAN.md` to `docs/history/`. Commit this file as `docs/PLAN-v1.0.md`. | Merged. |
| 0.2 | Baseline v0.19.2: run `tests/live/outcomes` 5 times per prompt on Sonnet, with the workspace on and with `CW_OFF=1`. | Report in `docs/baselines/`. Later milestones compare against it. |
| 0.3 | Run the two runners that were never run: `clear-handoff` and `plan-execution`. | Results recorded. |

### M1. Failures visible (S–M)

| ID | Task | Files | Done when |
|---|---|---|---|
| 1.1 | One error policy for all 21 hooks. Code before `next()`: on error, record it and call `next(e)` once. Code after `next()`: on error, record it and return the result. The 5 hooks without a catch (`session.start`, `session.end`, `turn.start`, `turn.step`, `skill.prompt`) get the same. The validator needs function-literal hooks, so add a pure `errorRow(hook, err)` helper, not a wrapper. | `hooks/register.mjs`, `lib/events.mjs` | For each hook, an engine test injects a fault before and after `next()`: the tool runs once, and a `hook.error` row exists. |
| 1.2 | Show errors. Footer: `workspace-core: 1 hook error (prompt.submit)`. `usage` lists them. `doctor` warns when the last session had any. | `lib/usage.mjs`, `cli/commands/usage.mjs`, `doctor.mjs` | Engine test for the footer line. |
| 1.3 | Keep my two fault tests (Bash, Stop) as regression tests. | `plugins/workspace-core/tests/` | In CI. |
| 1.4 | CI: install Claude Code at the lock's tested version, then run `claude plugin validate .`, `validate --strict plugins/workspace-core` and `claude plugin test plugins/workspace-core`. Add `macos-latest` to the unit-test matrix. | `.github/workflows/test.yml` | Green on both systems. |
| 1.5 | Show the active check commands once per session in the footer (`stop check: npm test`) and in `doctor`. They come from a committed file and run through `sh -c`, so a teammate should see what will run. | `lib/usage.mjs`, `doctor.mjs`, guide | Visible in both. |

### M2. Checks on by default (M)

| ID | Task | Files | Done when |
|---|---|---|---|
| 2.1 | Pure detector: manifest files → `{ stop, edit }` from a closed list. `package.json` with a real `test` script → `npm test` (or pnpm/yarn/bun by lockfile). pytest config → `pytest -q`. `Cargo.toml` → `cargo test`. `go.mod` → `go test ./...`. A `Makefile` with a `test` target → `make test`. Anything else → none. | new `plugins/workspace-core/lib/detect-checks.mjs`, used by the CLI too | Unit tests on fixture folders. |
| 2.2 | `install`: when a command is detected, show it and write it literally (with `--yes`, or after a prompt). `--no-stop-check` refuses. When nothing is detected, write `checks.stop: "auto"`. | `cli/commands/install.mjs` | Integration test for an npm repo and an empty repo. |
| 2.3 | Run time: resolve `"auto"` at each Stop with the same detector. Drop the once-per-process cache (`CHECKS ??=`, `register.mjs:228`), so a project scaffolded mid-session gets its check in the same session. | `hooks/register.mjs` | Engine test: no manifest → no check; add `package.json` → the next Stop runs it. |
| 2.4 | Timeout: `checks.stopTimeoutSec`, default 300 (today 600, fixed). The footer says when it timed out. | `lib/checks.mjs` | Unit test. |
| 2.5 | `doctor` suggests pinning once `"auto"` resolves. | `doctor.mjs` | Message shown. |

### M3. Routing: explicit first (M–L)

| ID | Task | Files | Done when |
|---|---|---|---|
| 3.1 | Slash modes `/debug`, `/feature`, `/tests`, `/review` as workspace-core skills with `disable-model-invocation: true`. Generalise `ciPrompt` to `modePrompt(class)`. They work in any language. Check the names against built-in commands on the tested versions first. | `skills/*/SKILL.md`, `hooks/register.mjs` | Engine test per mode: contract attached, gate armed for `/debug`. |
| 3.2 | Signal layer, checked before keywords and independent of language. (a) The last test or build command in this session failed, and the prompt is short with no create verb → debug. (b) The prompt or its paste has a stack-trace shape → debug. | `lib/contracts.mjs` | Unit tests, including Turkish prompts. |
| 3.3 | Narrow the keywords. Remove the catch-all `\w+` from the feature rule. Add a no-contract list for small edits (comment, typo, rename, bump, format, text, label, colour, docs, gitignore, commit, push). "Why is X slow" is a question. | `lib/contracts.mjs` | Corpus test (3.4). |
| 3.4 | Labelled corpus: at least 200 prompts with the expected class or none. Take them from your own sessions (the event log stores no prompt text, so you pick them by hand) plus the 40 from this review. CI fails when more than 2% of the no-contract prompts get a contract, or when any prompt gets the wrong class. Recall is reported, not gated. | `tests/fixtures/prompts.jsonl`, `tests/unit/contracts.test.mjs` | In CI. |
| 3.5 | Contracts as data: move the `CONTRACTS` map to `policies/contracts.superpowers.json`; the lock names the pack. | `lib/contracts.mjs`, `workspace.lock.json` | Existing contract tests pass unchanged. |
| 3.6 | In `CLAUDE.workspace.md`, replace the line that asks the model to route non-English requests itself with one line listing the slash modes. | `templates/CLAUDE.workspace.md` | Template test. |

### M4. One voice, durable state (M)

| ID | Task | Files | Done when |
|---|---|---|---|
| 4.1 | Stop pipeline as a state machine. Step 1: the stop check (enforced, at most 2 send-backs). Step 2: at most one advisory message per request, combining every ask that applies (stale notes, decisions nudge, Ponytail close). It is skipped when the stop check already sent Claude back. Step 3: the facts-only log entry, always. | `hooks/register.mjs`, new `lib/stop.mjs` | Table-driven unit test over every combination. The same inputs always give the same ending. |
| 4.2 | Per-session state file next to the event log (`~/.local/state/claude-workspace/state/<project>/<session>.json`): class, reason, skills, gate state, counters, Ponytail level, sections already injected, and the exit code and time of recent checks. No prompt text, no command text. Loaded on resume and on process start. | new `lib/state.mjs`, `hooks/register.mjs` | Engine test: a debug request stays gated or released across a restart, and a follow-up still inherits its class. |
| 4.3 | Gate v2. Release when either (a) a test or build command failed in this request, or the request started from a failing check, or (b) a `Root cause:` line names a path that exists in the project and gives a reason of at least 5 words. `Root cause: -` no longer passes. The 2-hold limit stays. A Bash command that changes a gated file before release is recorded as `gate bypass (bash)` and shown in the footer. | `lib/gates.mjs` | Unit and engine tests, with the hollow-line cases. |
| 4.4 | `.memory/session.md` is per developer. Add it to the managed `.gitignore` block. Update the guide (line 98 says to commit all of `.memory/`). `repair` prints `git rm --cached .memory/session.md` and does not run it. `context.md` and `decisions.md` stay committed. | `cli/lib/gitignore.mjs`, guide, `doctor.mjs` | Integration test. |

### M5. Profiles and existing projects (M)

| ID | Task | Files | Done when |
|---|---|---|---|
| 5.1 | `--profile`, as in section 5. The plugin reads it for each default. Lock entries name their profiles. `repair` on an old install records `full`. | `install.mjs`, `workspace.lock.json`, `hooks/register.mjs` | Integration tests per profile; an old install is unchanged after `repair`. |
| 5.2 | Build `CLAUDE.workspace.md` per profile. `doctor` prints its size. | `templates/`, `cli/lib/claude-md.mjs` | Template tests. |
| 5.3 | Existing projects: `install` writes one `## Project facts` section into `context.md`, filled only from files (language, package manager, test/lint/build commands, CI workflow names). It is marked as generated, and `repair` never overwrites it once edited. | `install.mjs`, `lib/md-memory.mjs` | Integration test on fixtures. |
| 5.4 | `/memory-bootstrap`, typed by the user: Claude drafts at most 12 module sections, each tagged `<!-- draft -->`. A draft is injected with an "unreviewed, check the code" label until you remove the tag. `doctor` lists open drafts. | new skill, `lib/md-memory.mjs` | Engine test for the label. |
| 5.5 | Docs. README: a one-screen quickstart for new and existing projects, the profile table, and the promise table (enforced or advice, with rates). Move the per-version history to `CHANGELOG.md`. Keep the 23 `CW_*` switches in the guide only. | README, guide, `CHANGELOG.md` | A new user can install without reading anything else. |

### M6. Release gate and 1.0 (M)

| ID | Task | Done when |
|---|---|---|
| 6.1 | Build the suite in section 7. Scenarios 2, 8, 9 and 10 need new fixtures; 3 and 4 need new prompts on the existing one. | `tests/live/release/` runs with one command. |
| 6.2 | Platforms: Linux (CI), WSL2, a devcontainer, and macOS once by hand (install, doctor, one scenario, uninstall). | Recorded in the report. |
| 6.3 | `canary` compares the installed Claude Code with the lock's tested list. A weekly CI job runs the engine tests on the latest Claude Code and opens an issue when they fail. | Job live. |
| 6.4 | `npm run release:check`: unit tests, engine tests, validators, corpus, marketplace check. Generate `WORKSPACE_TEST_REPORT.md` from the gate results. | One command. |
| 6.5 | Tag 1.0.0 when the gate passes. | Report published with the tag. |

## 7. Release gate

**Runs:** 10 scenarios × 5 runs × 2 conditions (`standard`, `CW_OFF=1`) on Sonnet, plus one `standard` pass on Opus. Graded from engine events and the final git state, as the suites do today.

| # | Scenario | What it shows |
|---|---|---|
| 1 | Failing test, fix it (existing `debug-fix`) | gate and minimal diff |
| 2 | Bug whose cause is in another file than the symptom | root cause quality |
| 3 | Small edit ("rename X", "fix this typo") | no contract, no interview |
| 4 | Small, fully specified feature | cost of brainstorming |
| 5 | Ambiguous feature (existing `feat-design`) | design before edit |
| 6 | New function with tests (existing `tdd-new`) | test first |
| 7 | Coverage for existing code (existing `coverage`) | tests run after writing |
| 8 | Empty repo: scaffold, then a first feature | `"auto"` check resolves mid-session |
| 9 | Told to "only edit", with a latent failing test | stop check sends Claude back |
| 10 | Two sessions: handoff, `/clear`, a path note before an edit, a stale note | memory |

One run of scenario 1 uses `/debug` with a Turkish prompt.

**Pass thresholds**

- **Enforced promises: 100% of runs.** No source edit before the gate releases. The stop check ran when it was due. The log entry exists. Zero `hook.error` rows.
- **Advice: at least 4 of 5 runs** per scenario for `standard`.
- **Against `CW_OFF=1`:** task success is equal or better. Tokens and turns are reported. If `standard` costs more than 1.5× the tokens with no gain in a scenario, that scenario's contract is reviewed before the tag.

**Cost:** earlier Opus runs cost about $0.15 to $0.25 each (8 runs for $1.97, 6 for $0.87). About 110 runs, mostly on Sonnet, should be in the range of $10 to $25. This is an estimate.

## 8. Order

M0 → M1 → M2 → M3 → M4 → M5 → M6. M1 comes first because every later change needs visible failures to be judged. M2 and M3 can run in parallel. Tag a 0.x release after each milestone, with the engine tests green.

## 9. Not in 1.0

- **1.1, memory:** a `sources/` folder, a generated index of notes, lint for dead `paths:` globs in `doctor`, `/memory-lint`, one file per module.
- **1.1, skill packs:** a second pack (Matt Pocock's skills) behind the 3.5 data file, compared with Superpowers on the release suite.
- **Later:** the router, native Windows, keyword routing in other languages.

## 10. Limits that stay in 1.0 (to be documented)

- An edit made by a script through Bash cannot be held before it happens; it is detected and reported afterwards.
- `/explain` forgets recorded commands after a restart.
- Keyword routing is English. Slash modes and signals work in any language.
- Two sessions in one project at the same time can lose a `session.md` entry, because the file is rewritten whole.
- Advice stays advice: a contract makes a skill load; it does not prove the skill was followed.

## 11. Decisions (made 2026-11-16)

1. **Default profile for new installs: `standard`.** Existing installs are recorded as `full` by `repair` (section 5).
2. **Attribution: removing Claude's credit lines moves to the `full` profile only.** Some teams must disclose AI authorship, so it is not a default of `core` or `standard`.
3. **Release gate: reduced.** 3 runs per scenario per condition (not 5); the advice threshold is **at least 2 of 3** runs per scenario for `standard`. **Sonnet is the reference model**, plus a short Opus pass. Section 7's run counts and cost estimate shrink to match (about 60 Sonnet runs plus the Opus pass). Enforced promises stay at 100% of runs.
4. **Skill pack:** decided after 1.1, from the comparison on the release suite, not before.

## Appendix: what I checked, and what I did not

| Checked | Result |
|---|---|
| `npm test` | 161 pass, 0 fail |
| `claude plugin test plugins/workspace-core` on Claude Code 2.1.325 | 74 pass, 0 fail, no login needed |
| `claude plugin validate .` and `--strict` on the plugin | both pass |
| Fault injected after `next()` in the Bash hook and the Stop hook | ran once each; the fault left no record |
| Fault injected before `next()` in `prompt.submit` | the prompt went on with no contract and no record |
| `classify()` on 40 labelled prompts | 21 as labelled, 6 false contracts, 13 missed |
| `statesRootCause("Root cause: -")` | `true` |
| Stop pipeline, read in `register.mjs` | at most 3 send-backs; nudge and Ponytail close skipped after another ask |
| `install` | no test-command detection; `.memory/` is not in the managed `.gitignore` block |

**Not checked:** any live model run, macOS, and the fault behaviour in a real session (only in the engine test kit).
