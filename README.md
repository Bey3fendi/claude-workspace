# claude-workspace

A portable Claude Code workspace that is pinned, reversible and project-local. It installs these tools:
- [Superpowers](https://github.com/obra/superpowers)
- [Ponytail](https://github.com/DietrichGebert/ponytail)

It also writes a **default CLAUDE.md** for the project: one managed file, `.claude/workspace/CLAUDE.workspace.md`, imported from your `CLAUDE.md` with a three-line block. It holds the workspace's rules (memory, contracts, secrets, an ADHD-friendly response style) and the [Karpathy coding guidelines](https://github.com/multica-ai/andrej-karpathy-skills), vendored at a pinned commit (since 0.10.0 they are always loaded, no longer a skill to invoke).

Session-to-session memory is **md-memory**, built into workspace-core: plain Markdown files in `.memory/`, with no database, worker process or background model calls. It replaces claude-mem (0.8.0). Since 0.13.0 it fills itself: a change that leaves no log entry gets a facts-only one, a designed change is asked to record its decisions, and the notes for a file reach Claude before it changes that file.

On request, **`/explain`** writes a short explanation of a change, built from facts the workspace records itself and checked mechanically (0.12.0). Every subagent, including Superpowers' final reviewer, runs on at most **Opus 5.5 at high effort** (0.11.0).

It also includes an optional, disabled-by-default model router.

**Status: Phase 6 (hardening) done; released on GitHub.** Phases 0–4 and 6 are done; Phase 5 (router) and the macOS run are deferred. See `docs/PLAN.md`.

**Start here:** [`WORKSPACE_DEVELOPER_GUIDE.md`](WORKSPACE_DEVELOPER_GUIDE.md) is the step-by-step playbook for new and existing projects, with every flag and switch. [`WORKSPACE_TEST_REPORT.md`](WORKSPACE_TEST_REPORT.md) is the latest validation round (2026-11-11: ready with limitations).

## What workspace-core adds to every session
- **Workflow contracts:** a local keyword classifier attaches a short contract to each request (debug → systematic-debugging, feature → brainstorming, tests → TDD or verification, …). Measured: activation 20/20 vs 0/51 without. A ticket to build something new ("new app", "from scratch", a user story) is a feature even when it mentions tests or error messages; real breakage stays debug (0.12.2). Since 0.15.0 only your own words count (pasted output is ignored), questions get no contract, "exception" alone is not a bug word, and reviewer feedback ("check the review, fix or justify") gets `superpowers:receiving-code-review`. English only.
- **Root-cause gate:** in a debug request, the first source edit is held until Claude states a root cause (max 2 holds per request, counted per response, so edits sent together are one hold; only source code is held, never tests, docs, logs or data).
- **Follow-ups** (0.18.1): a short confirmation right after a code-changing request ("yes lets do all three", "ok go ahead", "keep going with Task 3") continues that request's contract, marked `follow-up`. The skills already invoked count, so Claude is not asked to invoke them again, and a stated root cause stays stated. Questions and new requests are classified as usual. `CW_FOLLOW_UP=0` turns it off.
- **Edits made through Bash** (0.18.1): a command that may write (a `python3 - <<EOF` script, `sed -i`, a redirect, a build) is bracketed by two git snapshots of the changed files. A file changed between them counts as an edit for Ponytail's rule, the memory log, Explain and the footer check note. Read-only commands (`cat`, `grep`, `git status`, …) take no snapshot, and git commands that move the tree (`checkout`, `pull`, `stash`) are not edits. Tracked after the fact: the root-cause gate cannot hold an edit made through Bash. `CW_BASH_EDITS=0` turns it off.
- **Check hooks** (0.19.0, opt-in): a check that has to run is a hook, not a prompt.
  - `install --stop-check "npm test"`: at the end of a request that changed code and ran no passing check after its last code edit, the workspace runs the command once. On a failure Claude gets the last 40 lines and is sent back to fix the cause (at most twice per request). When Claude already ran a passing test, nothing runs. The footer says `stop check passed`, `stop check failed (exit 1), sent back`, or `… a check passed after the fix`.
  - `install --edit-check "npx eslint {file}"`: after each code edit (Edit tools, and files a Bash command changed), the command runs on that file (`{file}` is the quoted path; without it the whole command runs). A failure is shown to Claude next to the edit.
  - Both live in the committed `.claude/workspace.json`, so the team shares them; `repair` keeps them, `--no-stop-check` / `--no-edit-check` clear them. `CW_CHECKS=0` turns them off for a shell. Your own settings hooks: exit 2 sends Claude back; exit 1 is ignored.
  - Live (Haiku, $0.03 for three runs): told to only edit, Haiku capped the coupon but left an older bug; the stop check failed, Claude fixed the real bug and the tests passed (3/3). When Claude ran `npm test` itself, no stop check ran. An edit with a syntax error got the `node --check` failure next to it and was reverted.
- **Auto mode trust** (0.19.0, opt-in): auto mode blocks a push to a repo it does not know. It reads its trusted repos only from your own `~/.claude/settings.json` (`autoMode.environment`), never from project files. `doctor` says when this repo's `origin` is not named there; `install --trust-remote` adds `"Source control: github.com/owner/repo (this project's repo)"` (after `"$defaults"` when it starts the list, so the built-in rules stay). `uninstall` or `--no-trust-remote` removes only that line.
- **Compaction restore:** after a compaction, the request's contract is re-attached (noting what is already done).
- **Context pressure:** past 300K tokens of context, Claude is asked to recommend **CLEAR** or **COMPACT** at the next natural stopping point, and to append a cold-start handoff to `.memory/session.md` first. Nothing has to be pasted back: the next session loads it.
- **md-memory:**
  - `.memory/session.md` is a rolling log, loaded at every session start (startup, resume, `/clear`, compaction) and trimmed to its newest 150 lines.
  - `context.md` and `decisions.md` hold `## ` sections tagged `<!-- paths: src/cart/** -->`. A section reaches Claude before it changes a matching file: with the read, or in place of its first edit there (that edit is not applied; the retry is). Once per session and per subagent.
  - Claude writes the notes itself, following short rules given at session start. The feature and architecture contracts also ask for the agreed decisions to be recorded. When a request with a design step (brainstorming, writing-plans, or an architecture request) changes code but records nothing, Claude is asked once, at the end, to add them.
  - When a request changes files and Claude writes no log block, the workspace appends a facts-only one: the request's first line (secrets redacted), the files changed (git included, so Bash edits count), the last check after the last edit and its exit code, and the sections added to `decisions.md` / `context.md`.
  - Before an automatic compaction, a git snapshot (last commit and changed files) is appended to the log.
  - The files are yours to read, edit and commit.
- **CI (`/ci`)** (0.18.0): you type it after a push, or before one. It checks the latest CI run of the current branch (or `/ci <run id>`, `/ci <PR number>`) with `gh`, reads the failed log, reproduces the failing step locally with the command from `.github/workflows/`, and fixes it. Nothing runs unless you type it.
  - It is a debugging request: the debug contract (`superpowers:systematic-debugging`), Ponytail's rule when it is active, and the root-cause gate before the first source edit. A slash command skips the keyword classifier, so workspace-core starts the request when the skill loads.
  - Fix the code, not the test or the workflow, unless that is what is wrong; never skip a test or add `continue-on-error`. A CI-environment problem (secret, runner, flaky test) is reported, not "fixed". When this machine lacks what the workflow installs, it says so and installs nothing.
  - It never commits or pushes unless you ask. No GitHub App, workflow file or secret is added. Needs the `gh` CLI for the run and its log; without it (or after GitHub drops logs, about 90 days) it reproduces from the workflow file.
  - Live check on log_daemon (C++, Haiku, $0.014 and $0.018): an unpushed commit that broke the formatter test was found, root-caused at `formatter.cpp:13` before the edit, fixed in one line and verified with the workflow's `ctest` command. Without the test packages it reported them missing and proved the bug with a small reproduction. Against a real failed run (a throwaway PR, since closed): `/ci 1` read the run's `--log-failed` output, reproduced the same 2 failures, fixed the line, 22/22 tests passed locally, and the pushed fix turned CI green ($0.012).
- **Plan execution:** plans run in Superpowers' **Native** mode (`superpowers:executing-plans`): every task inline in the current session, then one fresh review of the whole branch. `superpowers:subagent-driven-development` is denied, and the method is stated at session start, so the plan handoff doesn't ask.
- **Explain (`/explain`):** you ask for it, it writes a short explanation of a change for a reader who didn't watch the session. Nothing runs unless you type it, and nothing ever blocks.
  - `/explain` explains the uncommitted changes; `/explain HEAD` (or any commit) explains a commit. After a commit, the footer suggests it.
  - workspace-core builds a **change record** by code: the changed files and line ranges (git), the commands that ran with their exit codes, the skills used, new decisions in `.memory/decisions.md`. The model writes `.explain/units/u-NNNN.md` from it and shows you only the "In short" part.
  - A mechanical check runs when the file is saved: structure, cited `path:line`s inside the change, cited commands as recorded, every changed file named, no "tested" without a passing command, banned filler words, at most one diagram, at most 300 words outside `<details>`. Failures go back to the model at most twice; the footer shows the result (e.g. `explain u-0002: 8/8 checks`).
  - Local only: `.explain/` is gitignored. Commands are remembered in memory for the running session, so after a restart or `--resume` the record has no earlier commands (and says the change wasn't verified).
  - The checks prove the explanation points at the right places, not that its reasoning is correct.
- **Subagent cap:** every subagent request runs on at most **Opus 5.5 at high effort**. Superpowers sends its final whole-branch review to "the most capable available model" (Fable here), and a subagent may ask for `xhigh` or `max` effort; both are lowered. Cheaper choices (Sonnet, Haiku, lower effort) are kept, and the main conversation is never changed.
- **CLAUDE.md:**
  - `install` writes `.claude/workspace/CLAUDE.workspace.md` (owned by the workspace, rewritten on every install or repair, committed) and adds this block to `CLAUDE.md`, creating the file if needed:
    ```md
    <!-- >>> claude-workspace (managed) >>> -->
    @.claude/workspace/CLAUDE.workspace.md
    <!-- <<< claude-workspace (managed) <<< -->
    ```
  - Nothing outside the block is ever changed. Uninstall removes only the block (and deletes `CLAUDE.md` if install created it and nothing else is left). Broken markers stop the install with nothing written.
  - `--claude-md=local` puts the block in `CLAUDE.local.md` instead (not committed); `--no-claude-md` leaves your CLAUDE.md alone. Repair keeps the choice; `--claude-md=project` switches back.
  - **Response style (ADHD-friendly)**, on by default: answer first, short sentences, steps for anything with more than two parts, commands in one block, and a closing line with what you do next. It is an instruction to Claude, not something the workspace can check. `--no-response-style` leaves it out; repair keeps the choice; `--response-style` puts it back.
  - The file is about 90 lines (roughly 1,100 tokens), loaded every session and cached after the first request. When it is imported, workspace-core does not repeat the md-memory rules at session start.
  - The guidelines have no skill call to observe, so the footer can only say they were loaded ("Karpathy guidelines (loaded via CLAUDE.md)"). Judge them by outcomes: diff size, rewrites, questions before code.
- **Workspace Usage footer:** an engine-verified line under each answer (skills activated, gate holds, pressure advice, Explain checks), shown to you, never sent to the model. Since 0.15.1 the injected-context list and the `/explain HEAD` hint appear once per session, and Claude adds its own one-line "Workspace Usage —" note only when it invoked or skipped a skill. Since 0.17.1 it also says when a request changed code and no test, lint, typecheck or build ran after the last code edit, or the last one failed ("no test or check ran after the last code edit"). Edits to tests, docs, HTML and styles do not count. It never blocks, and Claude never sees it.
- **Ponytail, with no `/ponytail-*` command** (0.16.0). Ponytail's own hooks inject its rules once, at session start; in long sessions they fade. In AgentBridge its closing line was in 16 of 97 answers. Once Ponytail has announced its level ("PONYTAIL MODE ACTIVE — level: full"), workspace-core:
  - repeats its core rule with the contract of each request that changes code (feature, debug, tests, architecture, review feedback), and for any other request after its first source edit;
  - sends "review this / review my PR / is this over-engineered" to `ponytail:ponytail-review`, and "audit the repo / what can I delete" to `ponytail:ponytail-audit`;
  - when a request changed source code and the answer has no closing line (what was skipped or not checked, and any risk), asks for that line once.
  - `/ponytail lite|full|ultra` and "stop ponytail" are followed.

- **Safety guard** (0.17.0), two layers against destructive or leaking commands:
  - **Deny rules** in `.claude/settings.json` from `policies/safety-denies.json`: the plain forms of `git push --force`/`-f`, `git reset --hard` and `git clean -f`, and `Read` of `.env` files (`.env`, `.env.local`, `.env.production`, …), `*.pem`, `id_rsa`-style keys, `~/.ssh/**` and `~/.aws/credentials`. Claude Code also applies the `Read` rules to `cat`/`head`/`tail`/`sed` in Bash. Templates such as `.env.example` stay readable. A deny rule wins over every allow rule, so a teammate cannot allow these locally. `--no-safety-denies` leaves them out; repair keeps the choice; `--safety-denies` puts them back.
  - **A Bash check** in workspace-core (`lib/safety.mjs`) that reads the command the way a shell splits it. It also catches `git -C . push -f`, `git push origin +main`, `--force-with-lease`, `sh -c '…'`, `$(cat .env)`, `< .env`, `grep`/`source`/`base64`/`curl -d @` on secret files, and `rm -rf` on `/`, `~`, `$HOME`, `.`, `..`, `*` or `.git`. Text in quotes and heredoc bodies is data, so a commit message may name these commands. Claude is told to ask you to run the command yourself (`! <command>`). It covers subagents too, and stays on under `CW_OFF=1`. `CW_SAFETY=0` turns it off.
  - **Not covered:** a script or program that opens `.env` or a key itself (`python app.py`, `npm run x`), and `grep -r` over a folder that contains `.env`. Only Claude Code's sandbox stops those. This guard is against mistakes, not a security boundary.

### Is Ponytail working?
Check from evidence, not from Claude's word:
- **Footer:** after a request that changed code it shows `ponytail full: rule repeated, closing line present` (or `missing`).
- **`claude-workspace usage`:** shows how often its rules were injected, the level, how many answers that changed code carried the closing line, and the session's row from Ponytail's own task ledger (`~/.config/ponytail/band/<project>.csv`: turns, reuse %, new code, tests).
- `/ponytail-gain` shows Ponytail's benchmark numbers. `/ponytail-debt` lists the `shortcut:` comments it left.

### Demos and product runs: the workspace off for one session
To run Claude in the project as a plain user would (a demo of your product, for example), turn the three plugins off for that session only. Your MCP servers still load:
```
claude --settings '{"enabledPlugins":{"workspace-core@cw-workspace":false,"superpowers@cw-workspace":false,"ponytail@cw-workspace":false}}'
```
- `CW_OFF=1 claude` turns off only workspace-core: no memory, contracts, holds, Ponytail driving or footer. Claude sees nothing from it (the skill listing is not trimmed either). The local event log still records the session, marked `off: true`, and the subagent cap and the safety check stay on.
- The `CLAUDE.md` import still loads the workspace file (general rules). Use `--no-claude-md` at install if a demo must not see it.

| Switch (environment) | Effect |
|---|---|
| `CW_OFF=1` | workspace-core inert for the session (demos, product runs) |
| `CW_PONYTAIL=0` | the workspace does not drive Ponytail (no repeated rule, no Ponytail skills in review contracts, no closing-line ask); Ponytail's own hooks still run |
| `CW_PONYTAIL_CLOSE=0` | no closing-line ask only |
| `CW_CONTRACTS=0` | no contracts (and no compaction restore) |
| `CW_GATES=0` | no root-cause gate |
| `CW_CONTEXT_PRESSURE=0` | no context-pressure note |
| `CW_CONTEXT_PRESSURE_TOKENS=250000` | pressure threshold (default 300000) |
| `CW_LISTING_TRIM=0` | keep denied skills in the model-facing listing |
| `CW_MEMORY=0` | no md-memory (nothing loaded, injected, snapshotted or trimmed) |
| `CW_MEMORY_MAX_LINES=300` | session.md cap (default 150) |
| `CW_MEMORY_MAX_CHARS=20000` | session.md character cap (default 12000) |
| `CW_MEMORY_PREEDIT=0` | notes arrive only with a read, never in place of a first edit |
| `CW_MEMORY_AUTOLOG=0` | no facts-only block at the end of a request |
| `CW_MEMORY_NUDGE=0` | no end-of-request request to record a design step's decisions |
| `CW_EXPLAIN=0` | no Explain (no command capture, `/explain` writes nothing) |
| `CW_EXPLAIN_WORDS=500` | Explain word budget outside `<details>` (default 300) |
| `CW_SUBAGENT_CAP=0` | no subagent cap (subagents may run on Fable or at xhigh/max effort) |
| `CW_CHECKS=0` | the stop check and edit check do not run (set them with `install --stop-check` / `--edit-check`) |
| `CW_FOLLOW_UP=0` | short confirmations ("yes do it") do not continue the previous request's contract |
| `CW_BASH_EDITS=0` | no git snapshots around Bash commands that may write (files changed by scripts are not counted as edits) |
| `CW_SAFETY=0` | no Bash safety check (the safety deny rules in settings still apply) |
| `CW_PLAN_EXECUTION=0` | no plan-execution note (subagent mode stays denied; remove its rule in `policies/skill-denies.json` to allow it) |

A user-level hook command containing `context-pressure` (e.g. `~/.claude/hooks/context-pressure.sh`) takes precedence: workspace-core then adds no second note.

## Requirements
- Linux, macOS, WSL2, or a Linux devcontainer. Native Windows is not supported; use WSL.
- Node ≥ 22.13.
- Claude Code ≥ 2.1.290 (tested: 2.1.316, 2.1.317).
- git.

## Use
```bash
# straight from GitHub (pinned release; no checkout needed)
npx -y github:Bey3fendi/claude-workspace#v0.19.0 install --yes --marketplace Bey3fendi/claude-workspace#v0.19.0

# a project already on an older version: move it to this one
npx -y github:Bey3fendi/claude-workspace#v0.19.0 repair --marketplace Bey3fendi/claude-workspace#v0.19.0

# or from a checkout of this repo
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs install --yes      # in your project
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs doctor
node /path/to/claude-workspace/cli/bin/claude-workspace.mjs uninstall
```
For a team, install with `--marketplace Bey3fendi/claude-workspace#<tag>` (or your fork). Otherwise the committed `.claude/settings.json` holds this checkout's absolute path.

| Command | What it does |
|---|---|
| `install` | Idempotent. A second run makes zero changes. Refuses if files it would touch have uncommitted changes (override with `--allow-dirty`), or if a same-named plugin would load twice |
| `doctor` | Verifies pins, duplicates, deny rules, the memory files, the CLAUDE.md import and the allow rules for `.memory/` and `.explain/`, and warns if a leftover claude-mem is installed. Never writes. Exits 1 on any failure |
| `repair` | Re-applies everything `install` does: refreshes the marketplace, updates workspace-core, reinstalls drifted pins, restores missing memory files, removes what older versions added (deny rules, the Caveman plugin and an untouched `.caveman.json`), and records the previous versions. `--marketplace <owner>/<repo>#<tag>` re-points to another release (update or rollback) |
| `uninstall` | Removes what the workspace added. A touched file nobody edited since install is restored **byte-for-byte**. An edited file loses only the workspace's own keys. Other projects on the machine are never affected: the marketplace stays registered while another project uses it |
| `usage` | Prints the engine-verified Workspace Usage evidence for the latest session in this project (`--session <id>` for another). Reads local files only |
| `canary` | Read-only (network): compares every pin with upstream's latest release |
| `remove-claude-mem` | For projects set up before 0.8.0. Asks first (`--yes` to skip), then runs claude-mem's own uninstaller. That removes claude-mem at **user level** (every project). Its data in `~/.claude-mem` is kept |
| `rollback` | Prints the exact steps back to the previous recorded version (the pins live in that version's lock, so its own `repair` restores them) |

### Update and rollback
- **Update:** get the new workspace version (`git pull` in the checkout, or the new `Bey3fendi/claude-workspace#<tag>`), then run its `repair` in each project. The previous versions are recorded in `.claude/workspace/manifest.json`.
- **Rollback:** `claude-workspace rollback` prints the steps, e.g. `git -C <checkout> checkout <commit>` then `repair`, or `npx -y github:<owner>/<repo>#<old-tag> repair --marketplace <owner>/<repo>#<old-tag>`.
- **Before bumping pins:** `claude-workspace canary` shows what changed upstream; re-run the live suites (`tests/live/`) after a bump.

### Devcontainer

The devcontainer feature in [`devcontainer/`](devcontainer/README.md) installs the CLI into the image. When the container is created, it installs Claude Code and the workspace into the project folder. Build its payload with `npm run build:feature`.

## What it changes

**Project files** are the only files it touches:
- `.claude/settings.json`: Claude Code's own `extraKnownMarketplaces` and `enabledPlugins` entries, plus 1 `permissions.deny` skill rule from `policies/skill-denies.json` and the safety deny rules from `policies/safety-denies.json` (unless `--no-safety-denies`).
- `CLAUDE.md` (or `CLAUDE.local.md`): the managed import block only. `.claude/workspace/CLAUDE.workspace.md`: the owned file it imports.
- `.memory/session.md`, `context.md`, `decisions.md`: created as templates if missing; existing ones are never overwritten. Uninstall removes only the templates nobody wrote in. The folder is not under `.claude/`, because Claude Code asks before every edit there (and a headless run cannot write there at all).
- `.claude/settings.local.json` (per user, gitignored): two `permissions.allow` rules, `Edit(.memory/**)` and `Edit(.explain/**)` (each covers every file-editing tool), so Claude updates the memory files and writes `/explain` files without asking. It is not in `settings.json`, because Claude Code ignores allow rules in the shared, committed settings.
- `.claude/workspace.json`: a marker file meant to be committed.
- If claude-mem is still installed at user level, `enabledPlugins["claude-mem@thedotmack"]: false` in this project, so two memory systems never run together. Uninstall removes that key.
- `.explain/`: created only when you run `/explain` (`records/` and `units/`); never committed.
- `.gitignore`: one managed block that ignores `.claude/workspace/*` except `CLAUDE.workspace.md` (your committed CLAUDE.md imports it), `.claude/settings.local.json` and `.explain/`.

Backups and the manifest live in `.claude/workspace/`, which is gitignored.

**User level:** nothing. `install` no longer touches `~/`. Only `remove-claude-mem`, after you confirm it, runs claude-mem's uninstaller; its output goes to `~/.local/state/claude-workspace/logs/`.

## Development
```bash
npm test                    # node:test, hermetic (fake claude/npx), runs on Linux/WSL/macOS
npm run gen:marketplace     # regenerate .claude-plugin/marketplace.json from workspace.lock.json
claude plugin validate .    # marketplace; plugins/workspace-core with --strict
```

## License

MIT, see [LICENSE](LICENSE). The plugins it installs (Superpowers, Ponytail, the router) are separate projects under their own licenses; this repo pins them by commit and does not copy their code. The one exception is the Karpathy guidelines, copied unmodified into `vendor/karpathy/` under their MIT license (notice in `vendor/karpathy/LICENSE`).
