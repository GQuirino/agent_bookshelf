# ticket-to-merge

A Claude Code plugin that ships one ticket test-first and reviews the result with read-only agents, behind a file guardrail.
Ticket: **BOOK-101, search books by title or author** (`GET /api/books/search?q=`).

| | |
|---|---|
| Branch | [`capstone/book-101`](https://github.com/GQuirino/agent_bookshelf/tree/capstone/book-101) on my fork `GQuirino/agent_bookshelf` |
| Contract | [`SPEC.md`](../SPEC.md) (interface, acceptance criteria, definition of done) |
| Project rules | [`CLAUDE.md`](../CLAUDE.md) |
| Plugin | `ticket-to-merge/` with `/ship-ticket` and `/review-pr` |

## Submission checklist

| Required line | Where | Status |
|---|---|---|
| Repo link: fork and branch | table above | done |
| How to run `/ship-ticket` and `/review-pr` | [Run it](#run-it) | done |
| `SPEC.md` and `CLAUDE.md` | table above | done |
| Plugin passes `claude plugin validate` | [Packaging](#packaging) | passes (one warning: no icon) |
| Test run, green | [Proof](#proof) | 43/43, `tsc` clean |
| Planted bugs: recall and precision over 3 runs | [Proof](#proof) | recall 12/12, precision 12/12, 0 false positives on clean code |
| Cost report with one lever, quality re-checked | [Cost report](#cost-report) | done; the lever gave no measurable saving (reported as such) |
| Design: why this split, which models, what I'd cut | [Design](#design) | done |
| Stretch (+5) | [Plugin eval Δ](#stretch-claude-plugin-eval-δ) | `claude plugin eval` with-without over 4 cases: **mean Δ 0.00** over 4 cases (no measurable gain on these easy cases; one precision miss found and fixed, see below) |

## Packaging

```
ticket-to-merge/
  .claude-plugin/plugin.json
  skills/{ship-ticket,review-pr}/SKILL.md
  agents/{test-writer,be-writer,review-security,review-correctness}.md
  hooks/{hooks.json,protect.js,stop-gate.js,trim-vitest.js}
  evals/            # planted bugs, clean cases, runners
```

```bash
claude plugin validate ./ticket-to-merge   # passes; only warning is the missing icon
claude --plugin-dir ./ticket-to-merge
```

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

Sources: interactive `/usage` for the priced-stage table above; `claude -p --output-format json` (`total_cost_usd`, `modelUsage`) for the headless Build numbers and every A/B trial.

**Priced stages (no lever, baseline).** Each stage was read from an interactive `/usage` right after one run (one reading per stage).

| Stage | Cost | Cache hit | Models | Source |
|---|---|---|---|---|
| Build: tests, implementation, one clean review pass (`/ship-ticket`) | **$0.62** (headless mean of 3: $0.39, range $0.36-$0.44) | 97% (headless ~90%) | haiku $0.0125 (`test-writer`), sonnet $0.61 | `/usage` |
| Review: `/review-pr` on the planted-bug branch | **$0.1956** | 89% | sonnet $0.1858 (+ haiku $0.0098, see note) | `/usage` |
| Fix loop: `/ship-ticket review` from 21 failing tests | **$0.56** | 97% | sonnet $0.56 | `/usage` |
| Total, one ticket | **~$0.62** if the first draft is clean; **~$0.98** if it needs the fix loop (estimate: Build minus its ~$0.20 review pass, plus Fix loop) | | | derived |

Headless runs measured Review at $0.20-0.25 and Fix loop at $0.53-0.55, so those two sources agree. Build does not: the interactive `/usage` reading ($0.62, 22 requests, 356 lines added) is about 60% above the headless mean ($0.39). It is one reading, and my interactive session also loads my own CLAUDE.md, MCP servers and hooks, which add context to every request; the headless runs are the cleaner, repeatable number and all A/B comparisons use them. Note: the `/usage` review reading shows $0.0098 of haiku. The reviewers are sonnet and no `test-writer` runs in `/review-pr`, so I cannot attribute it; it is under 5% of the cost.

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

- Stretch (+5): **no learning reviewer with project memory** (I screened for a bug the reviewer misses, found none, so did not build it; see the stretch section below). The **`claude plugin eval` Δ was measured** over 4 scored cases and is 0.00 after one prompt fix; it measures review of a supplied diff (git cannot run in the eval sandbox), not the full git flow, and both arms score 1.00, so it cannot show an advantage.
- The recall and precision numbers in Proof (12/12 and 12/12) were measured **before** the later change to `review-correctness` (it no longer reports test-coverage gaps) and were not re-run headless afterwards. The planted bugs there are not test-coverage findings, so I expect them unaffected, but I did not re-measure. The plugin-eval runs after the change (`review-subtle` 30/30, `review-clean-variant` 5/5 clean) are the only post-change evidence.
- Trade-off of that change: the reviewer no longer flags a genuinely missing test.
- One earlier planted run returned zero findings and I never confirmed why (see Proof).
- All eval cases and planted bugs are my own; none of this measures the graders' hidden bugs.
- No PR opened (branch is pushed to the fork only).
- No manual `curl` against a running server, only supertest.
- `%` and `_` in `q` are not escaped (documented in `SPEC.md` as out of scope), so `q=%` matches every book.
- The test lock's Stop-hook gate never had to block in a live run (tests were green first time); it is covered by a scratch test only.
- `claude plugin validate` passes with one warning: no plugin icon.

## Stretch: `claude plugin eval` Δ

Cases are in `plugin-evals/` (generated by `node ticket-to-merge/plugin-evals/make-cases.mjs`; the subtle-bug and screening sets were committed before their first run):
- `review-planted`: the 4 blatant planted bugs, one grader per bug (3 runs per arm).
- `review-subtle`: 6 subtler spec deviations (5 runs per arm, run twice).
- `review-clean`: the real implementation, one no-false-positives grader (3 runs per arm).
- `review-clean-variant`: a behaviour-identical refactor of the clean code (5 runs per arm, before and after the prompt fix).
- `review-screen`: 6 quiet SPEC/CLAUDE.md deviations, plugin arm only, used to look for a bug the reviewer misses (3 runs).

Each scored case runs both arms: with the plugin, and without it (`--ablation with-without`, the Δ is with minus without).

```bash
claude plugin eval ./ticket-to-merge --eval-dir plugin-evals --model claude-sonnet-5-5 --judge-model claude-sonnet-5-5 \
  --scaffold --trust-plugin --no-publish
```

**Result** (sonnet judge; with = plugin, without = plain Claude given the same diff; Δ = with minus without). The last two columns are after one prompt change described below.

| Case | What it tests | Runs per arm | With plugin | Without | Δ | Cost per run (with / without) |
|---|---|---|---|---|---|---|
| `review-planted` | 4 blatant bugs | 3 | 1.00 (12/12 bugs) | 1.00 (12/12) | 0.00 | ~$0.19 / ~$0.09 |
| `review-subtle` | 6 subtler spec deviations (order by id, author param without wildcards, limit checked before trim, bare array for empty query, wrong error text, repeated `q` coerced) | 5 (twice) | 1.00 (30/30 bugs, both times) | 1.00 (30/30) | 0.00 | ~$0.24-0.28 / ~$0.16-0.19 |
| `review-clean` | real implementation, no defects | 3 | 1.00 (3/3 clean) | 1.00 (3/3) | 0.00 | ~$0.12 / ~$0.11 |
| `review-clean-variant` | behaviour-identical refactor, no defects | 5 | **before fix 0.60** (3/5 clean), **after fix 1.00** (5/5) | 1.00 (5/5) | before **-0.40**, after **0.00** | ~$0.12-0.13 / ~$0.11 |
| **Mean Δ over the 4 cases** | | | | | **before fix -0.10, after fix 0.00** | |

**What happened, in order.**
1. First run: recall was saturated (both arms found every bug, even in the harder `review-subtle` set that I wrote and committed before running it, and did not edit afterwards). The only separation was against the plugin: on `review-clean-variant` it raised a finding in 2 of 5 runs and plain Claude in 0 of 5. Both findings were `low` severity and the same point, that the test named "orders matches by title" sends an empty query so it never exercises `searchBooks` ordering. That is accurate, but it is a test-coverage gap, not a defect in the change, and my judge rule counts any claimed gap as a fail.
2. Fix: I replaced the instruction in `agents/review-correctness.md` that told the reviewer to report criteria with no test. It now reads tests only as context and never reports test coverage ("a separate step writes and locks the tests"). I removed the matching "missing test goes to the test-writer" step in `/ship-ticket`, which can no longer fire. Cost of the fix: the reviewer will not flag a genuinely missing test.
3. Re-run of the same two cases, same settings: `review-clean-variant` 5/5 clean (Δ 0.00), `review-subtle` still 30/30 (Δ 0.00).

**Honest reading.**
- **Recall: no difference on these cases.** A score of 1.00 in both arms means the eval is too easy for the plugin to show an advantage, not that plain Claude and the plugin are equally good on hard bugs. A test that discriminates would need a larger diff or bugs that no line of `SPEC.md` gives away.
- **Precision: the 0.60 was real, and the fix was a prompt change made after seeing the score.** The "after" numbers are from 5 runs; the miss had happened in 2 of 5, so zero in 5 is encouraging, not proof. The fix is fitted to this failure and I did not test it on other clean refactors.
- **Cost:** the plugin arm costs more on planted cases (about $0.24-0.28 vs $0.16-0.19 on `review-subtle`, about $0.19 vs $0.09 on `review-planted`) and about the same on clean ones.
- The plugin fired in every plugin-arm run of the newer cases.
- The recall and precision numbers in [Proof](#proof) were measured before this prompt change and were not re-run headless; the planted bugs there (SQL built from a string, `>= 100`, missing trim, route order) are not test-coverage findings, so I expect them unaffected, but I did not re-measure.

Limits you should know about:
- **The diff is given in the prompt, for both arms.** Inside the eval's Bash sandbox on macOS, `/usr/bin/git` cannot write its xcrun cache under `/var/folders` and exits 72, so `/review-pr` cannot run git there. The eval therefore measures "review the diff I gave you" (the skill accepts a supplied diff). The git path of `/review-pr` was checked separately in a normal headless run after the last edits: 4/4 planted bugs, 0 permission denials, $0.25.
- **The judge matters.** With the default judge (haiku), one plugin-arm answer that clearly listed all four bugs was failed on the missing-trim check in 3 of 3 votes, which produced a false Δ of -0.17 on the planted case. I switched the judge to sonnet; both runs' traces are what I checked by hand. Any plugin-eval number depends on the judge.
- n = 3 per cell, graders are LLM judges, and I wrote the cases, so a Δ of 0 only says "no difference on easy bugs", not "no difference in general".

What the attempt surfaced and fixed in `skills/review-pr/SKILL.md`:
- **Discoverability:** with a natural prompt the skill fired in 1 of 6 plugin-arm runs; after rewording its description to start with "Use whenever the user asks to review a branch, PR, diff or recent changes before merging" it fired in 6 of 6.
- **Chained git commands:** `sha=$(git merge-base ...) && git diff ...` does not match `Bash(git ...)` allow-rules and was denied. The skill now runs each git command separately and must not answer with an empty list when git is denied or fails. I cannot confirm that this explains the one unexplained zero-findings run in the earlier eval.
- **Supplied diff:** if the message already contains the diff and changed paths, the skill uses them and skips git.

**Learning reviewer with project memory: screened, not built.** A learner needs a bug the current reviewer misses, so I first looked for one. I planted six quiet deviations from `SPEC.md` or `CLAUDE.md` (`review-screen`, committed before its first run): the search also matching `description`, an extra `count` field, 404 instead of an empty list on no match, a plain-text error instead of JSON, a missing `.js` import suffix (which `tsc` accepts under `moduleResolution: bundler`), and `router.all` instead of `router.get`. The plugin found all six in all three runs (18/18, $0.80), so there is nothing for a memory to learn on these. I stopped there rather than build the memory hook and skill for a bug that is never missed. A real attempt would need bugs the reviewer cannot see from `SPEC.md`/`CLAUDE.md` plus the diff (for example a multi-file change or behaviour that only shows at runtime), and a hook rule so a memory-enabled reviewer can write only to its memory folder.

Spend on the stretch: about $18 in total (several plugin-eval runs plus debugging and screening runs). Not done: a learning reviewer with project memory.
