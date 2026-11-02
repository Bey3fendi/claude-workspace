# Phase 4 step 1: root-cause gate (2026-11-03)

**Why:** the Phase 3 gate measured "root cause stated before the first edit" at 0/2 with the contract alone (1/3 overall), so advice was not enough (`2026-11-02-phase3-gate.md`).

## Mechanism (workspace-core 0.6.0)

**Where it lives:**
- Logic in `lib/gates.mjs`, which is pure.
- Wiring in `hooks/register.mjs`.

**How it works:**
- `prompt.submit` classifies each human prompt (the same local keyword classifier) and resets per-request state.
- For a **debug** request, `turn.step` accumulates the model's visible main-loop text **as it streams**. It is held in memory only and never written to disk.
- A `tool.call` hook holds the first edit to a **source file** until that text states a root cause:
  - It covers Edit, Write, MultiEdit, NotebookEdit, and shell writes (`>`, `tee`, `sed -i`).
  - "States a root cause" means either an explicit `Root cause: …`, or a code location (`file:line` / `line N`) together with a causal claim (`because`, `due to`, …).
  - The model receives a deny that names the expected form.
- **Not held:**
  - tests (writing a reproducing test first is good practice) and docs;
  - subagents;
  - non-debug requests.
- **Limits:**
  - at most **2 holds per request**; the third attempt goes through, so no loops or lock-out;
  - `CW_GATES=0` disables the gate.
- **Evidence:**
  - `gate` events (`deny` / `release` with a reason) in the event log;
  - the engine-verified footer says `root-cause gate held N edit(s) until a root cause was stated`, or `…then let it through (limit reached)`.
- **Grader fix:** an edit whose tool result is an error (a gate deny) is no longer counted as the first fix.

## Verification

| Level | Result |
|---|---|
| Unit (`tests/unit/gates.test.mjs`, outcomes-lib) | Edit-target and path rules, root-cause detector (incl. "I will find the root cause" ≠ a statement), decide/limit, footer and replay, denied-edit grading: **50/50 suite green** |
| Engine (`claude plugin test plugins/workspace-core`, `tests/gate.test.ts`, no model) | Debug: src edit **held** → test edit passes → streamed "Root cause: src/cart.js:5 …" → src edit **passes**; feature request never held; 2 holds then pass: **3/3** |
| Live (`outcomes --only debug-fix --runs 2`, $0.45) | **2/2 PASS**, root cause before fix 2/2. The gate loaded (0.6.0) and logged `release: root cause stated` in both. The model stated the cause before editing **unprompted**, so **no deny fired live** |

## Honest status

- **The deny path is proven at engine level, not yet in a live session.**
- **The 2/2 live result is not attributable to the gate.** With n=2 it is within the earlier advice-only range (1/3). An A/B (`CW_GATES=0` vs on, n≥4 each) is needed to measure the gate's effect.
- **The live check was stopped by the 60% usage guard.** The 5-hour window was already at 69% at the first run, so no further live runs were made.
