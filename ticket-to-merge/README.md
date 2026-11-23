# ticket-to-merge

A Claude Code plugin that ships one ticket test-first and reviews the result with read-only agents, behind a file guardrail.
Ticket: **BOOK-101, search books by title or author** (`GET /api/books/search?q=`).

| | |
|---|---|
| Branch | `capstone/book-101` (local, **not pushed yet**; push it to your fork for the link) |
| Contract | [`SPEC.md`](../SPEC.md) (interface, acceptance criteria, definition of done) |
| Project rules | [`CLAUDE.md`](../CLAUDE.md) |
| Plugin | `ticket-to-merge/` with `/ship-ticket` and `/review-pr` |

## Run it

```bash
# from the repo root, on the ticket branch
claude --plugin-dir ./ticket-to-merge

/ticket-to-merge:ship-ticket            # tests first, lock tests, implement, review, fix loop (max 2 rounds)
/ticket-to-merge:ship-ticket review     # skip the build: lock tests, review and fix an existing branch
/ticket-to-merge:review-pr [base]       # read-only review of the branch diff (default base origin/main)
```

`review-pr` returns one JSON object: `{"base", "reviewed_paths", "reviewers":{"security","correctness"}, "findings":[{file,line,severity,issue,evidence,found_by}]}`.
An empty `findings` list is a valid answer for clean code.

## How it works

```
/ship-ticket (main thread, orchestrates, never writes code)
  1 RED     test-writer (haiku)  -> failing tests from SPEC.md only; orchestrator re-runs them to confirm red
  2 LOCK    touch .tests.lock    -> tests/ read-only for every agent; Stop hook demands a green suite
  3 GREEN   be-writer (sonnet)   -> smallest diff in src/routes + src/models that turns the tests green
  4 REVIEW  /review-pr           -> review-security + review-correctness (sonnet, Read/Grep/Glob only), in parallel
            high/medium findings -> be-writer, tests still locked; re-review; max 2 rounds
  5 UNLOCK  rm .tests.lock, report with the exact test and tsc output
```

## Guardrails (4 layers, all tested)

1. **PreToolUse hook** (`hooks/protect.js`) blocks `bookshelf.db` (+ `-wal/-shm/-journal`), `seed.sql`, `.env`, `.env.*` (`.env.example` allowed) for Edit/Write/MultiEdit/NotebookEdit by resolved path, symlink and hardlink, and for Bash by command analysis: quoting and backslash tricks, split fragments, globs, variables, `eval`/base64, `\x`/octal/`$'..'` escapes, inline `python -c`/`node -e` code, `git clean`, destructive commands on `src/db`. Read is blocked for `.env`. Unparseable input fails closed.
2. **Test lock.** While `.tests.lock` exists, any write to `tests/` is blocked (by path, and in Bash by write verbs and redirects). Subagents (hook input carries `agent_id`) can never touch the lock itself, so `be-writer` cannot unlock tests.
3. **Deny rules** in `.claude/settings.json` (`Read(./.env*)`, `Edit(...)` for the db and seed), because `@`-references skip PreToolUse hooks.
4. **Read-only reviewers** by construction: their `tools` list is `Read, Grep, Glob`. Plugin agents ignore hooks and `permissionMode`, so the tool list is the only reliable control.

Evidence: `node ticket-to-merge/hooks/protect.test.mjs` runs **120 cases** (attacks that must block, legitimate commands that must pass, lock and subagent cases), all passing. Live: the hook blocked `.env` write and read in a real session with no `CLAUDE.md` to rely on, blocked edits to `tests/` under the lock, and a reviewer ordered to write a file had no write tool and wrote nothing.

**Known limits.** A pattern hook cannot be airtight against arbitrary code; layers 1-4 plus `/sandbox` are the defence in depth. The hook is deliberately strict: a Bash command that merely mentions `seed.sql` (a commit message, `cat`) is blocked. Writes made by running code the agent just wrote (not inline `-c`/`-e`) are not inspected.

## Proof

**Build.** `npm run test:run`: 5 files, **43 tests passed**; `npx tsc --noEmit` clean; diff = `src/routes/api.ts` (+17) and two new test files. One test per criterion and SPEC row (partial/case-insensitive title and author, empty and whitespace query returns all 50, trim, exactly 100 valid, 101 rejected with the exact error, repeated or non-string `q`, injection string as data, route not shadowed by `/books/:id`).

**Review recall and precision** (`evals/`, 3 runs, final version of the skill). Cases: `planted` (4 bugs: string-built SQL, `>= 100` off-by-one, missing trim, search route registered after `/books/:id`), `clean` (the real implementation) and `clean-variant` (a behaviour-identical refactor, to catch false positives).

| Run | Planted bugs found | Findings on planted | Findings on clean + clean-variant |
|---|---|---|---|
| 1 | 4/4 | 4 | 0 |
| 2 | 4/4 | 4 | 0 |
| 3 | 4/4 | 4 | 0 |
| **Total** | **recall 12/12** | **precision 12/12 real** | **0 false positives** |

Honest reading: the sample is small (3 runs, 4 planted bugs, all of them blatant) and I wrote both the bugs and the reviewer prompts, so this is not a hidden-bug measurement. Two things went wrong on the way and are reported, not hidden:
- An earlier official batch scored 67% recall. My scorer matched findings to the first bug within +/-3 lines, so two adjacent bugs were conflated (fixed: nearest-bug assignment; re-scoring the saved findings gave 4/4).
- In that same batch one planted run returned **zero findings**. It did not reproduce in 5 further runs and I could not find the cause. Likely suspect: headless mode started the reviewers in the background and the main thread merged early. `review-pr` now waits for both reviewers and reports a status per reviewer. The final batch above ran on that version.

**Fix loop.** Planted worktree, 21 of 43 tests failing at the start: round 1 fixed all 4 findings, round 2 came back clean, `src/` ended identical to the clean implementation, `tests/` untouched, lock removed.

## Cost report

Numbers come from `claude -p --output-format json` (`total_cost_usd`, `modelUsage`), the same figures `/usage` aggregates. Paste an interactive `/usage` screenshot here if the grader wants that exact view.

| Stage (one full `/ship-ticket`, no lever) | Cost |
|---|---|
| Whole run: tests, build, one review pass | **~$0.39** mean of 3 (range $0.36-$0.44) |
| of which `test-writer` (haiku) | ~$0.01 (~3%) |
| One `/review-pr` pass on its own | ~$0.20-0.25 |
| Cache hit rate | ~90% |

**The one lever: a PostToolUse hook (`hooks/trim-vitest.js`) that shows the model only the failing Vitest tests.** It replaces the tool output via `updatedToolOutput`; `TTM_TRIM_VITEST=0` disables it for the baseline. Verified live: the model saw 4 lines with the hook, 16 without. On a real failing run it cuts 34,958 characters to 6,915.

| Scenario | Baseline (hook off) | Lever (hook on) | Quality recheck |
|---|---|---|---|
| Full build, 3 interleaved pairs | $0.377 / $0.437 / $0.360, mean **$0.391** | $0.447 / $0.404 / $0.404, mean **$0.419** | 6/6 pass the reference tests and tsc |
| Fix loop from 21 failing tests, 2 pairs | $0.531 / $0.567, mean $0.549 | $0.549 / $0.420, mean $0.485 | 4/4 pass the reference tests and tsc |

**Result: no measurable saving.** In the build the lever was 7% *more* expensive, inside the run-to-run noise. In the fix loop the $0.420 trial skipped a review round (and had 3 permission denials), so its saving is not from trimming; the like-for-like pair was $0.531 vs $0.549. With n=3 and n=2 a saving under about 10% cannot be detected, and my rough bound from the tokens removed is under about 10%. Quality did not change: every trial passed the independent reference tests (the clean commit's tests, copied in as an oracle) and the typecheck, and touched only the allowed files.

Where the money actually goes: a review pass is ~$0.24, about 60% of a full run. A real lever would target the review stage (one reviewer instead of two, or a smaller diff), not Vitest output. I kept the agreed lever and report the null result.

## Design

- **Split by role, not by layer.** The ticket is one route and one query function; a backend/frontend split would hand two agents the same 17 lines. The split that matters is *who writes the tests* versus *who writes the code*: separate agents, tests locked while implementing, so green cannot be faked by editing a test. Reviewers are separate again so the author never grades its own work.
- **Models.** `test-writer` on **haiku**: tests from a precise SPEC are cheap, mechanical work and the orchestrator re-runs them to confirm red. `be-writer`, the orchestrator and both reviewers on **sonnet**: the diff is where a mistake costs the most, and reviewer precision depends on judgement. Haiku for reviewers was considered and rejected.
- **Orchestration lives in the skill.** Subagents cannot spawn subagents, so the orchestrator is the `/ship-ticket` skill running in the main thread. The earlier `orchestrator` agent was dropped for that reason.
- **Reviewer prompts favour precision:** only demonstrable defects, quoted evidence required, `SPEC.md` out-of-scope items excluded, an empty list explicitly allowed, no hints from the orchestrator.
- **What I'd cut.** (1) The `review-security` reviewer: in every planted run each bug was reported by both reviewers, so one reviewer would roughly halve review cost; I kept both because the brief names guardrails and security and the sample is too small to prove one is redundant. (2) The second review round: it only ever returned clean. (3) The trim hook, since it did not pay off here.

## Not done / not verified

- Stretch (+5): no learning reviewer with project memory and no `claude plugin eval` delta.
- Not pushed; no PR opened. The branch link needs your push.
- No manual `curl` against a running server, only supertest.
- `%` and `_` in `q` are not escaped (documented in `SPEC.md` as out of scope), so `q=%` matches every book.
- The test lock's Stop-hook gate never had to block in a live run (tests were green first time); it is covered by a scratch test only.
- `claude plugin validate` passes with one warning: no plugin icon.
