---
name: ship-ticket
description: Ship the ticket described in SPEC.md test-first. A test-writer agent writes failing tests, tests/ is locked, then a be-writer agent makes them green. Run it from the repo root on the ticket branch.
disable-model-invocation: true
allowed-tools: Agent, Read, Grep, Glob, Bash(npm run test:run*), Bash(npx tsc --noEmit*), Bash(touch .tests.lock), Bash(rm -f .tests.lock), Bash(git status*), Bash(git diff*), Bash(git add*), Bash(git commit*)
---
You orchestrate one ticket from SPEC.md to a green build. You never write code yourself; the specialists do. Delegation prompts are short: the task, the file paths that matter, the constraints, and the return format. No transcripts, no reasoning of yours, no file contents.

# Preflight
1. Read `SPEC.md` (the contract). If it is missing or ambiguous, stop and ask the user. Do not guess.
2. Run `git status --short`. If the tree is dirty with unrelated changes, stop and say so.
3. Run `rm -f .tests.lock` so the build starts in the test-writing phase.
4. Run `npm run test:run` and note the baseline pass count. The baseline must be green.

# Phase 1: RED (tests first)
1. Call the `ticket-to-merge:test-writer` agent. Prompt: "Write the failing tests for the ticket in SPEC.md. Cover every row of the interface table and every acceptance criterion. Return the red evidence."
2. Verify yourself, do not trust its report: run `npm run test:run`. Require that (a) the new tests fail, (b) they fail because the feature is missing or wrong, not because of a syntax error, bad import or broken setup, and (c) all baseline tests still pass. If not, send the specific problem back to the test-writer once.
3. Checkpoint: `git add tests && git commit -m "Add failing tests for the ticket"` with a body line "Revert with: git revert HEAD".

# Phase 2: LOCK
Run `touch .tests.lock`. From now on `tests/` is read-only for every agent (the guardrail hook enforces it) and the session cannot stop until `npm run test:run` is green (the Stop hook enforces it).

# Phase 3: GREEN (implement)
1. Call the `ticket-to-merge:be-writer` agent. Prompt: "Make the failing tests in tests/ pass by implementing SPEC.md. tests/ is locked. Iterate on `npm run test:run` and `npx tsc --noEmit` until both are clean."
2. If be-writer reports a test it believes is wrong, do NOT let it edit the test. Judge it against SPEC.md yourself. If the test is wrong, run `rm -f .tests.lock`, send the test-writer the one correction, lock again with `touch .tests.lock`, and re-run be-writer. At most once. If the test is right, send be-writer the reason.
3. Verify yourself: run `npm run test:run` and `npx tsc --noEmit`. Check `git diff --stat` touches only what SPEC.md's definition of done allows.
4. Checkpoint: `git add src && git commit -m "Implement the ticket"` with a body line "Revert with: git revert HEAD".

# Phase 4: UNLOCK and report
Run `rm -f .tests.lock`. Final report (under 150 words): files changed per agent, the exact `npm run test:run` summary line and typecheck result you ran yourself, any test that was corrected and why, and what you did not verify.
