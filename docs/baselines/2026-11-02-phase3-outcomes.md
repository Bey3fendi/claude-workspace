# Workflow outcomes: first measurement (Phase 3, 2026-11-02)

Plan §6 checks run on the activation fixture. Runs are write-enabled but scoped (`acceptEdits` plus test commands) and claude-mem is off. Grading uses stream-json engine events and the fixture's final git state, never the model's own words. The tools are `tests/live/outcomes/` (`run.mjs`, `regrade.mjs`, `outcomes.json`). This is n=1 per cell: a smoke measurement, not a statistic.

## Run 1: contracts off vs on (8 runs, $2.06; re-graded offline after grader fixes)

| Prompt / check | nocontract | with |
|---|---|---|
| debug-fix: root cause stated before the first src edit | ✗ | ✗ |
| debug-fix: reproduced with a test run first (soft) | ✓ | ✓ |
| debug-fix: target test passes (grader) | ✓ | ✓ |
| debug-fix: diff within `src/cart.js`, ≤ 4 lines (Karpathy) | ✓ | ✓ |
| feat-design: design step before any src edit | ✗ | ✓ (brainstorming) |
| feat-design: diff within scope | ✓ | ✓ |
| tdd-new: test → failing run → src | ✗ | ✗ (prompt misclassified as feature) |
| tdd-new: `itemCount` works (grader) | ✓ | ✓ |
| coverage: tests run after writing, `src/` untouched | ✓ | ✓ |
| **Runs passing all hard checks** | **1/4** | **2/4** |

## Fixes made from run 1

**Grader and fixture defects (re-graded at no cost):**
- The debug grader ran `node --test … test/`. Node 22 rejects a directory argument there, so the grader failed even on correct fixes. It now names the file and is verified both ways.
- The fixture's `npm test` script had the same defect, so every model wasted steps on it. It is now `node --test test/*.test.js`.
- In `acceptEdits` mode, shell writes inside the project are allowed (`cat >> test/…`, `sed -i`). The timeline now counts them as edits.

**Workspace changes (workspace-core 0.4.2):**
- The classifier routes "… with tests", "test-first" and "TDD" to the tests contract.
- The debug contract now asks for the root cause (file:line and why) in the reply **before the first edit**.

## Run 2: recheck of the two failing prompts, contracts on (2 runs, $0.55)

| Prompt | Result | Detail |
|---|---|---|
| debug-fix | **PASS** | systematic-debugging; root cause stated before the edit; 2-line fix; target test passes. Soft check: no test run before the fix |
| tdd-new | **PASS** | test-driven-development; test written first and seen failing before the src edit; function works; diff in scope |

## Reading

- **Contracts change outcomes, not just activation.** With contracts the feature design step happened, and after the fixes the debug and TDD workflows were followed as the plan specifies.
- **Without contracts**, the model fixed and implemented directly. The code was correct and minimal, which is Karpathy-compatible, but the Superpowers workflow order was skipped.
- **Next:** a `--runs 2`, full-condition measurement for the Phase 3 gate (confidence intervals), once the remaining Phase 3 items are in.
- **Phase 4 option:** turn "root cause before fix" and "test before src" into `tool.call` gates instead of advice.
