# Why implicit skill activation was 0% (Phase 2R investigation, 2026-11-02)

**Conclusion.** The test harness is not the cause. In every condition tested, the workspace was fully loaded:
- Skill tool present;
- all 99 skills listed;
- the Superpowers bootstrap (`You have superpowers…`, `using-superpowers`) injected at SessionStart.

Even so, Claude Opus 5.5 at medium effort did not invoke any skill on its own. That held headless and interactive, read-only and write-enabled. It went straight to the task. When a skill is requested explicitly, invocation works.

**Implication for Phase 3:** the Superpowers bootstrap alone does not produce implicit activation on this model. Activation has to come from the workspace's own mechanisms (plan §6): contract injection, and a `tool.call` gate before edits.

## Evidence

| Condition | Setup | Answered runs | Runs with any skill activation |
|---|---|---|---|
| Baseline, `before` (corrected) | headless, read-only tools, workspace-core off | 21 (19 scored) | 0 |
| Baseline, `with` (corrected) | headless, read-only tools, workspace-core on | 21 (19 scored) | 0 |
| H0 `ro` | headless, `--allowedTools Skill Read Grep Glob`, prompts debug/feat/tests | 3 | 0 |
| H0 `rw` | headless, `acceptEdits` + Edit/Write + test commands only | 3 | 0 (the model edited files and ran tests directly) |
| Interactive | real TUI in tmux (the user's default auto mode), prompts debug/feat/arch | 3 | 0 |
| Explicit request | "invoke the Skill tool with …" | 2 (fixture `live-skill-deny`, footer test) | 2 |

**Implicit runs combined:** 0 of 51 answered runs. The Wilson 95% upper bound is about 7%.

**Load check.**
- For H0, the stream-json `init` message listed `Skill` among the tools, 9 plugins and 105 skills. The transcript held the Superpowers bootstrap in `hook_additional_context`.
- For the interactive runs, workspace-core recorded injected-context markers: Superpowers 3, claude-mem 7, Ponytail 4, Caveman 23+3. Caveman therefore is active interactively, as expected.

## Corrections to the 2026-11-01 baseline

- **42 of its 84 runs had hit the 5-hour usage limit** (`turn.complete reason: error`), and the runner counted them as OK. This includes the bare run, which explains its "0 tokens".
- The report has been re-aggregated from the saved results: 0/19 scored runs per condition, 95% CI upper bound 16.8%.
- The runner now counts only answered requests (`reason === 'answer'`).
- The listing measurements are unaffected, since they come from the transcript's `skill_listing`.

## Also verified in this pass

- **The engine footer renders in the interactive TUI** as a notice row beneath the answer: `● workspace-core+…: Verified by engine: no skill activations observed · context injected this session: Caveman, Ponytail, Superpowers, claude-mem · report matches engine events …`.
- **Headless footer (`claude -p`):** it is not printed. It is recorded in the transcript and in the events, and `claude-workspace usage` shows it.
- **Honesty under pressure:** asked to add a false `Applied:` claim, the model refused and reported only the skill it had invoked. The footer agreed ("report matches engine events").

## Limits

- One model and effort level (opus-5-5 / medium), one small fixture, short prompts, and small n per condition.
- Other models and efforts are untested. So are longer, multi-step sessions where Superpowers might trigger later.
- The interactive runs used the user's default permission mode (auto). The fixture was reset with git afterwards.
- These sessions ran with user-level claude-mem enabled, so it may have recorded observations from the fixture sessions.
