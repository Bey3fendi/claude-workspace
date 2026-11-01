# Phase 0: Verification Spike Report

Status: **Phase 0 complete. 8 of 9 live spikes pass; L7 is partial (deny blocks invocation but saves no context), and context reduction moves to Phase 3. L4 passed by manual check. L9 passed on WSL and in a devcontainer (Docker Engine 29.9.2 inside WSL, devcontainer CLI 0.90.0).** Live environment: WSL2 Ubuntu, Claude Code 2.1.316 (native installer), Node 22.23.4 (nvm), Haiku 5.5 for probe runs.
Date: 2026-11-01. Claude Code checked against: 2.1.316 (Windows host). Method: shallow clones of each upstream at the SHAs below (read-only, nothing executed), the official docs at code.claude.com, and the bundled mods API types for 2.1.316.

Legend: **[V-src]** verified in upstream source · **[V-doc]** verified in official docs or type definitions · **[LIVE]** still needs a live run · **[✗]** plan premise was wrong and the plan changes.

## Pinned upstream snapshot (candidate `workspace.lock.json`)

| Plugin id (entry@marketplace) | Repo | SHA | Commit date | Version |
|---|---|---|---|---|
| `superpowers@superpowers-dev` | obra/superpowers | `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | 2026-10-21 | 7.0.1 |
| `caveman@caveman` | JuliusBrussee/caveman | `9b68f7ed12b05e7efaff18e65c5a3fc2849fd0a4` | 2026-10-25 | 4.0.1 |
| `claude-mem@thedotmack` (source `./plugin`) | thedotmack/claude-mem | `b80b29bc49d08a71312f44b8feacb2e7585edff4` | 2026-10-31 | 15.8.0 |
| `ponytail@ponytail` | DietrichGebert/ponytail | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` | 2026-10-29 | 5.3.3 |
| `andrej-karpathy-skills@karpathy-skills` | multica-ai/andrej-karpathy-skills (= forrestchang/…) | `2c606141936f1eeef17fa3043a72095b4765b9c2` | 2026-04-20 | 1.0.0 |
| `router@alexei-led-claude-router` (optional) | alexei-led/claude-router | `df56298187ec393ff04c54a4f14bf9c7c5606219` | 2026-10-31 | 1.19.1 |

## Results by spike

### S1: Is skill invocation observable? **[V-doc] yes, more strongly than the plan assumed. [LIVE] for the classic-hook path**
- Mods API event `skill.prompt` fires "when the engine expands a skill's prompt for the model (`/name`, the Skill tool, a preload)". Its input carries `skill`, `pluginName`, `path`, `source` and `frontmatter`. That one event covers every activation path.
- Transcripts record `tool_use{name:"Skill", input.skill}` **[V: observed in this session's transcript]**.
- A classic `PreToolUse` matcher on `Skill` is still **[LIVE]**. It's no longer critical, because `skill.prompt` replaces it.

### S2: Pinning and non-interactive install. **[V-doc]**
- Plugin sources `github`, `url` and `git-subdir` accept `ref` plus `sha` (a full 40-character SHA). When both are set, the **SHA is checked out**. Our own marketplace can therefore list every upstream pinned by SHA.
- `claude plugin marketplace add <owner/repo[@ref|#ref]>`, `claude plugin install <id>`, `claude plugin list`, `claude plugin details`, `claude plugin validate [--strict]` and `claude plugin marketplace remove` all exist as shell commands.
- Project-scope behavior of install (`--scope project`) is **[LIVE]**.
- `${CLAUDE_PLUGIN_DATA}` is `~/.claude/plugins/data/<id>/`. It's deleted on uninstall unless `--keep-data` is passed.

### S3: Caveman. **[V-src] [✗] premise corrected**
- Hooks are declared **inline in `.claude-plugin/plugin.json`**: SessionStart, SubagentStart, UserPromptSubmit and SessionEnd. Each one exits silently if `node` is missing.
- **The Claude Code plugin makes no network calls.** Telemetry, Auto routing, the proxy and cloud features all live only in the separate `@caveman-ai/cli` package.
  - **Plan change:** install the plugin only, never the CLI. "Telemetry off" and "Auto off" then hold by construction, and no overlay is needed.
- Mode resolution order is the `CAVEMAN_DEFAULT_MODE` env var, then project `.caveman/config.json` or `.caveman.json` (`{"defaultMode": "lite"}`), then the user config. **The project-local `.caveman.json` gives lite mode without touching global state.**
- Its marketplace source is `./` (the repo root), so the plugin loads root `skills/`: **22 skills, ~930 listing tokens**. These include the work patterns `investigate-first`, `lean-build`, `surgical-patch`, `safe-refactor`, `migration` and `verify-and-stop`, which overlap Superpowers. Only `megacave` and `ultracave` are `disable-model-invocation`.
- It ships three `cavecrew-*` agents. Their model can be overridden through `CAVECREW_*_MODEL` env vars, which edit the installed agent frontmatter at SessionStart.

### S4: Karpathy canonical repo. **[V-src]**
`multica-ai/andrej-karpathy-skills` and `forrestchang/andrej-karpathy-skills` resolve to the **same commit**. The marketplace name is `karpathy-skills`, the plugin is `andrej-karpathy-skills`, and it has one skill, `karpathy-guidelines` (~55 tokens).

### S5: claude-router internals. **[V-src] two premises corrected**
- It is a **mod** (`hooks/hooks.json` = `{"modules": ["./native-router.mjs"]}`). It changes model and effort per `turn.step`, and the model per subagent at `agent.spawn`.
- **Decisions live in the mod's private `$.store`** (key `decisions:v1:<session>`, at most 60 rows and 20 sessions, kept 30 days, counts and labels only, no prompt text). No file is written. **[✗] There's no decisions file for an adapter to tail.**
  - **Plan change:** our observer mod records the *actual* model and effort from `turn.step` itself.
  - The router's view state may be readable by hooking `state.set` for plugin `router` **[LIVE]**.
- **Mid-turn re-classification** runs every `policy.reviewEveryRequests` requests, in the background. Its answer can move the tier, and "down only past the dwell and a checkpoint". `0` disables it.
- **[✗] Policy, routes, classifier and timeout live in the profile file `~/.claude/router.json` (user scope).** Project `.claude/router.json` holds only the routing *mode*.
  - **Plan change:** `router enable` must say so and write that user-level file only with explicit consent, or accept the defaults.
- The Jev endpoint `https://api.typesafe.ai/v1/systemone` is built in. The key is a `userConfig` option `typesafe_api_key` with `sensitive: true`, which the docs say goes to the platform's secure credential store, not settings files **[V-doc]**. Where that store lives on Linux and WSL is **[LIVE]**.
- **Subagent routing defaults to `on`.** Explore → haiku; Plan and general-purpose → classified, which sends the subagent prompt to Jev. Our overlay sets `subagentRouting: "off"` (needs the user-level file, as above).
- On classifier failure the current route is kept. With routing "unavailable" (no key, or an unsupported provider such as `ANTHROPIC_BASE_URL` being set), Claude's model is kept. This is the fail-safe we wanted **[V-src]**.
- Defaults: high = Opus/xhigh, medium = Opus/medium, low = Haiku/high, micro = Haiku/medium. The code/debug/plan/review activities move `low` to Sonnet/high.
- Swapping in a mock classifier is not supported. Built-in classifier endpoints are fixed, so router tests use a live nightly run or the `ollama` classifier against a local stub **[LIVE]**.

### S6: Bands. **[V-doc] partial, [LIVE] for the real behavior**
- `AbovePrompt` is a hook **chain**. A band that returns a tree without calling `next(e)` hides the ones beneath it.
- Coexistence of the Ponytail band, the router band and ours depends on each one composing with `next` **[LIVE]**.
- **Mitigation:** our observer shows its line through `$.ui.status` (the status line entry) instead of competing for `AbovePrompt`.

### S7: The same plugin enabled at two scopes. **[LIVE]** (the docs don't say)

### S8: Transcript and evidence fields. **[V: this session's transcript] + [V-doc]**
- The documented, primary source is the mod events:
  - `turn.step` (`turnId`, `index`, `model`, `effort`, `agentId`);
  - `turn.start` and `turn.complete` (`reason`: answered, interrupted, …);
  - `agent.spawn`;
  - `skill.prompt`;
  - `classic.<Event>` for every classic hook event, fired "whether or not any settings hook is configured".
- **New capability:** in `classic.SessionStart` and the other `classic.*` events, `await next(e)` returns the **merged result of the settings and plugin command hooks beneath** (for example `additionalContext`). That makes upstream injections observable by content markers.
  - **Caveat:** results are merged, not attributed per hook.
  - The mod chain order relative to other plugins' modules is **[LIVE]**.
- Secondary source (undocumented, so best-effort only): assistant transcript records carry `message.model`, `requestedModel`, `effort`, `perTurnEffort` and `attributionSkill`.
- Mods load in `claude -p` (headless loads fresh) **[V-doc]**, so the live E2E tests can observe through the mod.

### S9: Disabling overlapping skills. **[V-doc]; [LIVE] for whether it saves context**
- The deny rule `Skill(skill:<name>)` blocks a skill "whichever of its names Claude calls it by". `Skill(name)` and `Skill(name *)` are also available.
- The docs don't say whether a denied skill also leaves the *listing*, and so stops costing context **[LIVE]**.
- A marketplace entry's `skills` list can only *restrict* plugins whose source is the marketplace root. For github sources (strict mode) it *appends*. So permissions are the tool for this.

### S10: Context budget (static estimate). **[V-src]; [LIVE] measurement with `/context`**

| Source | Model-invocable skills | Listing tokens (≈ chars/4, capped at 1,536 chars each) |
|---|---|---|
| Superpowers | 15 | ~580, plus ~800 SessionStart injection (full `using-superpowers`) |
| Caveman | 20 (+2 hidden) | ~930, plus activation text (dynamic) |
| Ponytail | 6 | ~410, plus activation text |
| Karpathy | 1 | ~55 |
| **claude-mem** | **30** | **~1,960**, plus SessionStart memory context (dynamic) |
| **Total static** | **72** | **≈ 4.7k tokens before any memory context** |

**[✗] New finding:** claude-mem ships **30 model-invocable skills**, far more than its README lists.
- Many are off-scope: `wowerpoint`, `screenpipe`, `ccs-align`, `standup`, `weekly-digests`, `owner-goals`.
- Some send data out: `cloud-sync`.
- Some overlap Superpowers: `make-plan`, `do`, `build`, `build-and-release`, `babysit`, `handoff`.
- Some cost a lot of tokens: `learn-codebase` ("reading every source file in full").
- **Plan change:** add a claude-mem skill allowlist. Keep `mem-search`, `smart-explore`, `how-it-works`, `backup-setup` and `timeline-report`. Deny the rest with `Skill(skill:…)` rules.

### S11: claude-mem worker on WSL and in a devcontainer. **[LIVE]**
- On native Windows, `git clone` of claude-mem **fails to check out** (path or filename limits). This confirms the Linux/WSL-only scope.
- The worker port defaults to `37700 + uid%100` (harness) or 37777 (observer) **[V-src]**. Our dashboard must avoid both.

## Plan deltas (to apply to the approved plan)
1. **Observability core becomes a mod**, not a set of shell-command hooks. One `workspace-core` module hooks the following events:
   - `turn.*` for the actual model and effort;
   - `skill.prompt` for activation;
   - `agent.spawn` for subagents;
   - `classic.*` for hook-level events and upstream injection evidence;
   - `tool.call` for gates.

   It writes JSONL through `$.fs`. This costs no process spawn per event, and it reads the documented API instead of transcripts. Transcript reconciliation becomes secondary.
2. **Caveman:** plugin only, plus a project `.caveman.json` with `{"defaultMode":"lite"}`. Remove the "turn off telemetry/Auto" overlay, since those don't exist in the plugin.
3. **The router adapter is replaced** by direct `turn.step` observation. Router policy needs the user-level `~/.claude/router.json`, which is disclosed and requires consent.
4. **Skill overlap policy:** add the claude-mem allowlist and the Caveman work-pattern denies through `permissions.deny` `Skill(skill:…)` rules.
5. **Status display:** use `$.ui.status` and avoid the `AbovePrompt` chain.
6. **Lock file:** use the SHAs above.

## Live spike results

**Probe kit:**
- Observer mod `cw-observer`, loaded with `--plugin-dir`. It is read-only, and every hook forwards through `next`. It logs `session.*`, `turn.*`, `skill.prompt`, `agent.spawn`, `tool.call`, `state.set`, `session.append` and `classic.*` to JSONL.
- A local marketplace `cw-spike` that pins every upstream by SHA.
- A throwaway git project at `~/spikes/proj`.
- All evidence below comes from the observer log or transcript records. None of it comes from the model's own statements.

| ID | Result | Evidence |
|---|---|---|
| **L1** skill activation | **PASS** | *Model-invoked:* `classic.PreToolUse{tool:"Skill", skill:"andrej-karpathy-skills:karpathy-guidelines"}`, then `skill.prompt{skill, pluginName:"andrej-karpathy-skills", source:"plugin", textLen:2357}`, `classic.PostToolUse`, `tool.call{tool:"Skill"}`. *Typed slash command:* `classic.UserPromptExpansion` then `skill.prompt` (same fields). `skill.prompt` is the single reliable "Activated" signal across both paths |
| **L2** pinned project install | **PASS, with 2 findings** | `marketplace add --scope project` and `install --scope project` touched only the project's `.claude/settings.json` (`enabledPlugins` and `extraKnownMarketplaces`). At user level only `~/.claude/plugins/{installed_plugins,known_marketplaces}.json` changed. `installed_plugins.json` records **`gitCommitSha` equal to the locked SHA for every plugin**. **Finding 1:** a `git-subdir` source given as `owner/repo` shorthand clones over **SSH** and fails with no key (`github` sources fall back to HTTPS). Use a full `https://…git` URL. **Finding 2:** `claude plugin validate` rejects our marketplace entry named `claude-mem` (reserved `claude-` prefix), but `install` still works. CI runs validate with that one error allowlisted |
| **L3** router | **PASS** | The key passed with `--config typesafe_api_key=…` is stored in **`~/.claude/.credentials.json` → `pluginSecrets` (mode 0600)**. WSL has no libsecret/keychain, so that is plain text protected only by file mode. It never appears in settings or project files, and **uninstalling the plugin deletes it**. Router state is observable through `state.set{plugin:"router", key:"view"}`, with `phase, mode, nativeModel, selectedModel, actualModel, tier, effort, reason, error, health`. `view.credentials` holds only status strings, and the key **never appeared in the observer log**. *Fallback with an invalid key:* `error:"auth"`, `reason:"no-advice"`, `health.failures:1`, and selected = actual = native model (`claude-opus-5-5`). Routing failed safe. `turn.step.model` confirms it independently |
| **L4** band coexistence | **PASS (manual check by the user, 2026-11-01)** | Bands draw only in an interactive terminal (not under `-p`). In an interactive session in `~/spikes/proj`, the user confirmed that the Ponytail band showed, Caveman lite was active and everything displayed correctly. Ponytail's band state was also observed through `state.set{plugin:"ponytail", key:"band"}` |
| **L5** same plugin at two scopes | **PASS (deduped)** | `claude-mem@cw-spike` (project) and `claude-mem@thedotmack` (user) were both "enabled". The engine **deduplicated** them: skills appeared once (99 total either way) and each claude-mem hook ran once. Which copy's *version* wins is unspecified, so the installer still has to prevent duplicates |
| **L6** upstream injection evidence | **PASS through `session.append`, not `classic.*`** | `classic.SessionStart` `next(e)` returned only the **JSON** `additionalContext` (Superpowers' and claude-mem's). **Caveman and Ponytail inject plain stdout, which that result doesn't include.** `session.append` with `door:"hook-context"` and `origin:{kind:"hook", event:"SessionStart"}` delivers **one row per hook output**. Content markers attribute them: Ponytail 3,110 chars; Superpowers + claude-mem 7,872 chars. This is a documented, evidence-grade path |
| **L7** deny overlapping skills | **PARTIAL: blocks invocation, saves no context** | With 31 `Skill(skill:…)` deny rules, invoking `caveman:investigate-first` produced `tool.call{isError:true}`, **no `skill.prompt`**, and the model reported the denial. But the skill listing stayed **99 skills / 29,939 chars** before and after. **Denies don't reduce context.** Options for Phase 3: (a) accept it; (b) a `session.append` hook that filters the `skill_listing` row (documented hook, more invasive); (c) ask upstreams for `disable-model-invocation` on niche skills |
| **L8** context baseline | **RECORDED** | `claude plugin details` reports always-on cost: Superpowers ~848, Caveman ~1,991, Ponytail ~641, Karpathy ~105, claude-mem ~2,873. That's **≈6.5k tokens per session for listings alone**. Measured skill listing: 26 built-in plus 73 plugin skills = 99 skills, 29,939 chars. SessionStart injections add Superpowers ~3.5k chars, Ponytail ~3.1k chars, claude-mem memory context (variable), and Caveman in interactive sessions. CI budget: listing ≤ 7k tokens, total SessionStart injection ≤ 4k tokens, re-measured on every lock bump |
| **L9** claude-mem worker | **PASS on WSL and in a devcontainer.** *Devcontainer run:* `mcr.microsoft.com/devcontainers/javascript-node:22` (Debian 13, Node 22.23.4, non-root `node`), started with `devcontainer up` on Docker Engine in WSL. Inside it: the native installer gave Claude Code 2.1.316; the pinned **project-scope install with no login** recorded `gitCommitSha` equal to the lock for all 4 marketplace plugins; `npx -y claude-mem@15.8.0 install --provider claude --no-auto-start </dev/null` exited 0 with **1 `AGENT:` line in the captured output**, the same `~/.bashrc` Bun lines, and the launcher, Bun and uv placed. Telemetry went **ENABLED (default) → `telemetry disable` → DISABLED (config)**, and **`CLAUDE_MEM_TELEMETRY=1` flips it back to ENABLED (source: env)**, which confirms the doctor override check is needed. The worker answered `GET 127.0.0.1:37700/api/health` with 200 v15.8.0, a **loopback-only** listener. The port is `37700 + uid%100` (37700 for uid 1000). Chroma (8000) is not started eagerly. *WSL run:* | **Plugin-only install does not work.** Hooks fail with `Executable not found in $PATH: "claude-mem"` and `Bun was not found`. These are *non-blocking*, so the session silently runs without memory, which is a textbook "Failed" state for the dashboard. After `npx -y claude-mem@15.8.0 install --provider claude --no-auto-start` plus `npx claude-mem start`, `GET 127.0.0.1:37700/api/health` returns `200 {"status":"ok","version":"15.8.0"}`, bound to **loopback only**. The installer's side effects: user-scope `enabledPlugins["claude-mem@thedotmack"]`, its own marketplace, a 109 MB `~/.local/bin/claude-mem` launcher, Bun in `~/.bun` plus a `~/.bashrc` PATH line, and uv. Cloud sync is OFF. Chroma's port defaults to **8000** (risk of clashing with dev servers) |

**Follow-ups resolved after the live run**
- **claude-mem telemetry was ON by default** (`Decided by: default`). It was disabled with `npx claude-mem@15.8.0 telemetry disable`, and `status` now shows `DISABLED`, decided by the `telemetry.json` config file. Precedence verified in `src/services/telemetry/consent.ts`: `DO_NOT_TRACK` > `CLAUDE_MEM_TELEMETRY` (`1`/`true`/`on` re-enables it) > config > default (on). The mandatory OFF policy is now plan §3a.
- **`skillOverrides` does not apply to plugin skills** (docs: "Plugin skills are not affected by `skillOverrides`"). The native listing levers are `skillListingBudgetFraction`, `skillListingMaxDescChars`, and the overflow policy that drops the least-invoked descriptions first. The optimization is deferred to Phase 3 and gated on A/B evidence (plan §11).
- **L9 devcontainer:** the user installed Docker Engine in WSL (replacing the Docker Desktop CLI symlink). L9 was re-run there and passed (see table).

**Other observations**
- `turn.step` gives the model and effort actually used for every request (`claude-haiku-5-5`/`medium`, `claude-opus-5-5`/`medium`), with `turnId` and `agentId`. `turn.complete.reason` gives `answer` (or interrupted and so on).
- Mods load under `claude -p --plugin-dir`, so headless E2E tests can use the observer.
- The mods validator requires **string-literal event names and function-literal hooks** in `on(…)`. Hooks can't be generated in a loop. This shapes how `workspace-core` is written.
- **Caveman stays silent under `-p`.** Its SessionStart hook prints only `OK`, because it's gated on the entry point. Its effect can only be tested interactively, or with `CAVEMAN_DEFAULT_MODE` set.
- **Upstream installer output contains instructions aimed at agents.** The claude-mem installer printed `AGENT: show this link to the user…` with a cmem.ai sign-in URL. It wasn't acted on. Our installer must capture upstream installer output and never relay it as instructions.

## Final plan deltas (supersede the list above where they differ)
1. **Observability = one mod (`workspace-core`)**:
   - `turn.step` gives the actual model and effort;
   - `skill.prompt` gives activation;
   - `classic.PreToolUse`/`PostToolUse` give Skill tool success or failure;
   - `session.append` with door `hook-context` gives upstream injection evidence, attributed by content markers;
   - `state.set{plugin:"router"}` gives routing decisions;
   - `agent.spawn` plus `turn.step.agentId` give subagents.

   Transcript `hook_*` attachments are a fallback only, since they're undocumented.
2. **claude-mem is installed through its pinned npx installer** (`npx -y claude-mem@<ver> install --provider claude --no-auto-start`, run non-interactively with output captured). It is **not** listed in our marketplace, to avoid duplicates. The integration is user-scope by nature; disclose that and handle it in `uninstall` through `npx claude-mem uninstall`. `doctor` checks the launcher on PATH, Bun, and the worker's health on loopback.
3. **Caveman is installed as a plugin only** (no CLI), with project `.caveman.json` `{"defaultMode":"lite"}`. Its activation is verified interactively, not headless.
4. **Router:** the key goes only through Claude Code `userConfig` (`--config` or `/plugin configure`). On WSL/Linux it lands in a 0600 plain-text file, which must be disclosed. Fallback works. Routing evidence comes from router `view` state cross-checked against `turn.step`.
5. **Skill overlap:** use `permissions.deny Skill(skill:…)` to block invocation (verified). Context reduction needs option (b) or (c) from L7, decided in Phase 3 against the measured budget.
6. **Marketplace hygiene:** use full HTTPS URLs for `git-subdir`, pin a `sha` on every entry, and allowlist the `claude-` reserved-name validate error for upstream names.
