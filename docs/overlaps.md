# Skill overlaps and deny rules

`policies/skill-denies.json` is merged into the project's `permissions.deny`. A deny rule blocks **invocation** of a skill. Since workspace-core 0.5.0, denied skills are also left out of the model-facing skill listing, because they cannot be invoked anyway. That saves about 2.4k tokens per session; see `docs/baselines/2026-11-02-phase3-listing-ab.md`. `CW_LISTING_TRIM=0` turns this off.

**Rule of thumb:** deny only when a skill is out of scope for this workspace, or when evidence shows it displaces the workflow a contract asks for. Never deny a skill a contract needs; `tests/unit/contracts.test.mjs` enforces that.

## Current rules (1)

| Group | Rules | Reason |
|---|---|---|
| Superpowers subagent execution (1, 0.7.4) | `subagent-driven-development` | Plans run in Native mode (`executing-plans`: inline, one review at the end) to cut cost; see PLAN item 8 |

## Reviewed and not denied (2026-11-02)

| Overlap | Skills | Decision and evidence |
|---|---|---|
| Code review | `ponytail:ponytail-review`, built-in `code-review`, `superpowers:requesting-code-review` | **Allowed.** The review contract is outcome-only (findings by severity with file:line), so any reviewer satisfies it. No run showed one displacing a workflow |
| Minimal-change style | `ponytail:ponytail`, the Karpathy guidelines (always loaded via CLAUDE.md since 0.10.0) | **Allowed.** They are complementary, and Ponytail is mostly ambient (SessionStart). If they ever conflict, Ponytail's level wins for verbosity and Karpathy's sections for process (assumptions, success criteria). The outcome checks' Karpathy diff-scope check passed in every graded run |
| Delegation and exploration | `superpowers:dispatching-parallel-agents` | **Allowed.** None was activated in any of the 45 Phase 3 runs, so there is nothing to act on |

**Evidence base.** Across the 45 Phase 3 runs (A/B 28, smoke 7, outcomes 10), all 16 skill activations were skills a contract asked for: brainstorming 6, systematic-debugging 5, verification-before-completion 2, mem-search 2, test-driven-development 1. Karpathy was never activated as a skill; its effect was only checked through the diff-scope outcome. No competing skill fired instead of a contract skill. Re-run this review when the activation suite or the outcome checks show a non-contract skill being chosen for a contract class.

## Updating existing installs

`claude-workspace doctor` reports `skill-deny-rules: N rule(s) missing (run repair)`. Running `claude-workspace repair` adds the new rules. Rules the user added are never touched.
