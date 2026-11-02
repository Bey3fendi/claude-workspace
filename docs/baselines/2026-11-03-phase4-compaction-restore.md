# Phase 4 step 2: compaction restore (2026-11-03)

**Problem:** the Phase 3 workflow contract rides on the request's prompt as model-only context. A compaction summary can drop it, and with it the expected outcome for the request still in progress.

## Mechanism (workspace-core 0.6.2)

**Hook:** `classic.SessionStart` with `source: 'compact'` (main loop only). This is the engine's own channel for post-compaction context.

**What it adds:** an `additionalContext` entry, `restoreText(class, { invoked, rootCauseStated })` in `lib/contracts.mjs`. For example:

> [workspace contract: debug, restored after compaction] Applies to the latest user request until a new one arrives; the user's own instructions take precedence. You already invoked superpowers:systematic-debugging for this request; keep following it. Expected: root cause already stated; any fix stays minimal and is verified.

**Behaviour:**
- It does not re-ask for skills already invoked in the request, or for a root cause already stated.
- It defers to the user's instructions. A first wording ("make the minimal fix") could have overridden a user's "do not edit yet", and was changed after the live check showed it.
- Nothing is added for trivial requests, or when `CW_CONTRACTS=0`.
- The gate's state is in memory and survives compaction unchanged.
- Event: `compact.restore` (class, length, number of skills invoked).

## Verification

| Level | Result |
|---|---|
| Unit (`tests/unit/contracts.test.mjs`) | Text per class, already-done handling, no fix push, length < 500: green (51/51 suite) |
| Engine (`claude plugin test`, `tests/compact.test.ts`) | Restore on `SessionStart(compact)` after a debug prompt; nothing on `startup`; nothing for a trivial request: 2/2 |
| Live (`tests/live/compaction/run.mjs`: one process, stream-json input, debug prompt then `/compact`) | **PASS twice** ($0.30, $0.28). `compact.restore` logged, and the restore text is in the engine's session transcript **after** the compaction boundary (evidence from the transcript, not the model's words) |

## Limits

- The request state lives in the session's process. A `--resume` in a new process starts with no active request, so it has nothing to restore. That is acceptable: the next prompt is classified afresh.
- Auto-compaction in the middle of a long turn uses the same SessionStart(compact) path. It was not run live (it needs a context-filling turn); `/compact` was.
