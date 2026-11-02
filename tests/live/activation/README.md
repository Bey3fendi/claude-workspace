# Activation and skill-listing baseline (live)

This suite measures two things for each task class:
- how often the expected workspace skills are **actually activated**;
- whether the skill listing overflows and drops descriptions.

These numbers feed the Phase 2 gate and the Phase 3 A/B acceptance.

```bash
node tests/live/activation/run.mjs                 # smoke (default): 1 prompt per class, `with` only = 7 runs
node tests/live/activation/run.mjs --full --runs 2 # phase-gate run: all 14 prompts, CIs worth reading
#   --conditions nocontract,with   re-measure the reference too (doubles the cost)
#   --only feat-1,debug-1          subset of suite.json ids
#   --budget 0.40                  opt-in --max-budget-usd per run (the model sees it and economises)
#   --out docs/baselines           report: <date>-activation.{md,json}
```

**Cost.** Every run is a full Claude session of about 60k context tokens, and it counts against your usage limit. To keep that down:
- **Smoke mode is the default.** It runs one prompt per class, once, in the `with` condition only.
- **The reference is not re-run.** The no-contract reference is already measured (0/51, `docs/baselines/2026-11-02-activation-investigation.md`).
- **The run stops at the first usage-limit error.** The report shows the total cost and how many runs were not started.
- **Runs are read-only.** `Edit`, `Write` and `Bash` are disallowed, and each run has a 300-second timeout. `--budget` is opt-in, because the model sees the budget and skips work to save it.

## How it measures

- **Evidence source.** Evidence comes from `probe/`, an independent mod named `cw-probe`, loaded with `--plugin-dir`. It records `skill.prompt`, `turn.step`, `turn.complete` and Skill `tool.call`. It shares no code with `workspace-core`, so it can also cross-check it: the "with" condition reports how often `workspace-core` agrees with the probe.
- **Listing.** The listing comes from the transcript's first `skill_listing` attachment, which is the exact text the model sees. An entry with no `: description` is **name-only**, meaning the listing budget dropped its description.
- **Scoring.** A run is a **hit** when any of the class's `expectAny` skills is activated. For the `trivial` class, a hit means no Superpowers process skill fired; any that did fire is counted as over-activation.
- **Statistics.** Rates are reported with Wilson 95% intervals. Before-vs-with differences use Newcombe intervals.

## Conditions

| Condition | Setup |
|---|---|
| `before` | Phase 1 state. The workspace is installed and `workspace-core` is disabled via `--settings` (flag scope, so no files change). The report checks that no `workspace-core` events were written |
| `with` | Phase 2 state. `workspace-core` is enabled |
| `bare` | Listing reference only. An empty directory, no workspace plugins, and claude-mem disabled |

The fixture project is `fixture-project/`, a small cart library with real bugs. It is copied to a temporary directory and the workspace is installed with the real CLI. Runs are interleaved across conditions, which spreads out the effects of timing and memory accumulation.
