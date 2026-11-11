# Skill overlaps and deny rules

`policies/skill-denies.json` is merged into the project's `permissions.deny`. A deny rule blocks **invocation** of a skill. Since workspace-core 0.5.0, denied skills are also left out of the model-facing skill listing, because they cannot be invoked anyway. That saves about 2.4k tokens per session; see `docs/baselines/2026-11-02-phase3-listing-ab.md`. `CW_LISTING_TRIM=0` turns this off.

**Rule of thumb:** deny only when a skill is out of scope for this workspace, or when evidence shows it displaces the workflow a contract asks for. Never deny a skill a contract needs; `tests/unit/contracts.test.mjs` enforces that.

## Current rules (12)

| Group | Rules | Reason |
|---|---|---|
| Caveman work-pattern skills (6) | `investigate-first`, `lean-build`, `surgical-patch`, `safe-refactor`, `migration`, `verify-and-stop` | Each duplicates a Superpowers workflow: debugging, brainstorming or plans, TDD or verification. Caveman is used for its style (lite mode) only (Phase 1) |
| Superpowers subagent execution (1, 0.7.4) | `subagent-driven-development` | Plans run in Native mode (`executing-plans`: inline, one review at the end) to cut cost; see PLAN item 8 |
| **Caveman Cloud skills (5, Phase 3)** | `caveman-setup`, `caveman-discover`, `caveman-evidence-review`, `caveman-manage`, `caveman-optimize` | They drive `caveman cloud …`, a gateway or a project key. The workspace runs Caveman with **cloud off** (a setup decision), so they are out of scope and would send data to an unrelated service |

## Reviewed and not denied (2026-11-02)

| Overlap | Skills | Decision and evidence |
|---|---|---|
| Code review | `ponytail:ponytail-review`, `caveman:caveman-review`, built-in `code-review`, `superpowers:requesting-code-review` | **Allowed.** The review contract is outcome-only (findings by severity with file:line), so any reviewer satisfies it. No run showed one displacing a workflow |
| Minimal-change style | `ponytail:ponytail`, `andrej-karpathy-skills:karpathy-guidelines` | **Allowed.** They are complementary, and Ponytail is mostly ambient (SessionStart). The outcome checks' Karpathy diff-scope check passed in every graded run |
| Delegation and exploration | `caveman:cavecrew`, `caveman:caveman-explore`, `superpowers:dispatching-parallel-agents` | **Allowed.** None was activated in any of the 45 Phase 3 runs, so there is nothing to act on |
| Data leaving the machine | `caveman:caveman-compress` | **Allowed.** It runs only as an explicit `/caveman-compress`, warns that the file goes to the configured model provider, and refuses secret-looking files. Revisit if it is ever invoked implicitly |
| Local tooling | `caveman:caveman-learn`, `caveman-stats`, `caveman-init`, `caveman-help` | **Allowed.** Local only and user-triggered |

**Evidence base.** Across the 45 Phase 3 runs (A/B 28, smoke 7, outcomes 10), all 16 skill activations were skills a contract asked for: brainstorming 6, systematic-debugging 5, verification-before-completion 2, mem-search 2, test-driven-development 1. Karpathy was never activated as a skill; its effect was only checked through the diff-scope outcome. No competing skill fired instead of a contract skill. Re-run this review when the activation suite or the outcome checks show a non-contract skill being chosen for a contract class.

## Updating existing installs

`claude-workspace doctor` reports `skill-deny-rules: N rule(s) missing (run repair)`. Running `claude-workspace repair` adds the new rules. Rules the user added are never touched.
