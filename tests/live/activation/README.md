# Activation and skill-listing baseline (live)

This suite measures two things for each task class:
- how often the expected workspace skills are **actually activated**;
- whether the skill listing overflows and drops descriptions.

These numbers feed the Phase 2 gate and the Phase 3 A/B acceptance.

```bash
node tests/live/activation/run.mjs --runs 3 --conditions before,with,bare --concurrency 4
#   --only feat-1,debug-1   subset of suite.json ids
#   --budget 0.40           --max-budget-usd per run
#   --out docs/baselines    report: <date>-activation.{md,json}
```

**Cost:** each run is a real `claude -p` request. Runs are read-only (`Edit`, `Write` and `Bash` are disallowed) and capped by `--max-budget-usd`.

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
