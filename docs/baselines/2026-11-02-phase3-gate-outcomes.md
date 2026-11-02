# Workflow outcomes (2026-11-02)

8 run(s) planned, 8 done · conditions: with (workspace-core on incl. Phase 3 contracts)
Graded from stream-json engine events and the fixture's final git state (plan §6). Soft checks are reported but do not fail a run.

| Prompt / check | with |
|---|---|
| debug-fix/rootCauseBeforeFix | 0/2 |
| debug-fix/reproducedFirst (soft) | 2/2 |
| debug-fix/grader:discount-test-passes | 2/2 |
| debug-fix/diffWithin | 2/2 |
| feat-design/designBeforeEdit | 2/2 |
| feat-design/diffWithin | 2/2 |
| tdd-new/testFirst | 2/2 |
| tdd-new/grader:itemCount-works | 2/2 |
| tdd-new/diffWithin | 2/2 |
| coverage/testsRunAfterWrite | 2/2 |
| coverage/diffWithin | 2/2 |
| **runs passing all hard checks** | **6/8** |

## Runs

- with · debug-fix: FAIL · skills superpowers:systematic-debugging · rootCauseBeforeFix ✗ (no root-cause statement before the first src edit); reproducedFirst ✓ (a test run preceded the fix); grader:discount-test-passes ✓ (discount-test-passes passed); diffWithin ✓ (src/cart.js · 2 lines)
- with · feat-design: PASS · skills superpowers:brainstorming · designBeforeEdit ✓ (no src edits this turn (stopped at design/questions)); diffWithin ✓ (no files · 0 lines)
- with · tdd-new: PASS · skills superpowers:test-driven-development · testFirst ✓ (test written first and seen failing before src edit); grader:itemCount-works ✓ (itemCount-works passed); diffWithin ✓ (src/cart.js, test/cart.test.js · 14 lines)
- with · debug-fix: FAIL · skills superpowers:systematic-debugging · rootCauseBeforeFix ✗ (no root-cause statement before the first src edit); reproducedFirst ✓ (a test run preceded the fix); grader:discount-test-passes ✓ (discount-test-passes passed); diffWithin ✓ (src/cart.js · 2 lines)
- with · coverage: PASS · skills superpowers:verification-before-completion · testsRunAfterWrite ✓ (tests run after the last test edit); diffWithin ✓ (test/cart.test.js · 11 lines)
- with · feat-design: PASS · skills superpowers:brainstorming · designBeforeEdit ✓ (no src edits this turn (stopped at design/questions)); diffWithin ✓ (no files · 0 lines)
- with · tdd-new: PASS · skills superpowers:test-driven-development · testFirst ✓ (test written first and seen failing before src edit); grader:itemCount-works ✓ (itemCount-works passed); diffWithin ✓ (src/cart.js, test/cart.test.js · 14 lines)
- with · coverage: PASS · skills superpowers:verification-before-completion · testsRunAfterWrite ✓ (tests run after the last test edit); diffWithin ✓ (test/cart.test.js · 10 lines)

Cost: $1.97 over 8 run(s)
