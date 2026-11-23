---
name: review-pr
description: Use whenever the user asks to review a branch, PR, diff or recent changes before merging. Reviews the branch diff against SPEC.md with two read-only reviewers (security and correctness) and returns one deduplicated JSON list of findings. Optional argument is the base ref (default origin/main, falls back to main). Reports only; never edits.
allowed-tools: Agent, Read, Grep, Glob, Bash(git merge-base*), Bash(git diff*), Bash(git status*), Bash(git rev-parse*)
---
You run a read-only review of the current branch. You do not edit anything and you do not fix findings. Base ref: `$ARGUMENTS` if given, otherwise `origin/main` (fall back to `main` if that ref does not exist).

# Step 1: collect the diff
If the user's message already contains the diff (a unified diff of the non-test files) and the list of changed paths, use them as given: do not run git, set `base` to `"provided"`, and go to Step 2. Otherwise collect the diff with git as below.

Run every git command as its own separate Bash call: no `&&`, `;`, pipes, `$(...)` or shell variables. Chained commands do not match the allowed `git ...` patterns and get denied. If any git command is denied or fails, stop and report that, never answer with an empty findings list: "nothing to review" is only valid when `git diff --name-only` ran and returned nothing.
1. `git merge-base HEAD <base>` gives the fork point `<sha>`.
2. `git diff --name-only <sha>` gives every changed path (committed and uncommitted). If it is empty, answer `{"findings":[]}` and stop: there is nothing to review.
3. `git diff <sha> -- . ':(exclude)tests'` gives the diff of non-test files. Test files are passed as paths only; the reviewers read them if they need to.
4. Note untracked new files with `git status --short` and include their paths too.

# Step 2: fan out, in ONE message
Call `ticket-to-merge:review-security` and `ticket-to-merge:review-correctness` in parallel. Each prompt is identical and contains only: the changed paths, the non-test diff, and the line "SPEC.md is the contract. Return the JSON findings object only." Do not add your own opinions, hints or suspected bugs: an unprompted reviewer is the measurement.

# Step 3: merge
0. Wait until BOTH reviewers have returned a result. Never merge, and never answer, while either one is still running or has returned nothing. An empty findings list is only valid when it came back from a reviewer, not when a result is missing.
1. Parse both JSON objects. If one is not valid JSON, ask that reviewer once to re-send JSON only; if still invalid, say so in the report instead of guessing.
2. Drop any finding without `evidence`. Do not add findings of your own.
3. Deduplicate: findings in the same file within 3 lines of each other that name the same root cause become one (keep the clearer `issue`, the higher severity, and record both reviewers in `found_by`).
4. Sort by severity (high, medium, low).

# Step 4: report
Return one JSON object and nothing after it:
{"base":"<base>","reviewed_paths":[...],"reviewers":{"security":"ok|invalid|no_response","correctness":"ok|invalid|no_response"},"findings":[{"file":"","line":0,"severity":"","issue":"","evidence":"","found_by":["security"|"correctness"]}]}

An empty `findings` list is a valid result for clean code. Never pad it.
