#!/usr/bin/env node
// Measures /review-pr recall and precision on planted bugs.
//   node ticket-to-merge/evals/run-review-eval.mjs [--runs 3] [--out <dir>] [--cases planted,clean,clean-variant]
// For every run and case: throwaway git worktree at the clean implementation commit, overlay the
// case files, commit, run `claude -p /ticket-to-merge:review-pr <base>` inside it, score the JSON.
// Scoring is mechanical: a finding is "matched" when it is in a planted bug's file and within
// +/-3 lines of its range. Unmatched findings are listed for manual adjudication; they are NOT
// silently counted as real or fake.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, '..');
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim();
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const runs = parseInt(arg('runs', '3'), 10);
const outDir = path.resolve(arg('out', path.join(os.tmpdir(), `review-eval-${Date.now()}`)));
const caseNames = arg('cases', Object.keys(manifest.cases).join(',')).split(',');
fs.mkdirSync(outDir, { recursive: true });

const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function overlay(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name);
    const d = path.join(to, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      overlay(s, d);
    } else if (e.name !== '.keep') fs.copyFileSync(s, d);
  }
}

function extractJson(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

function runClaude(cwd) {
  return new Promise((resolve) => {
    const args = [
      '-p', `/ticket-to-merge:review-pr ${manifest.base_ref}`,
      '--plugin-dir', pluginDir,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Skill', 'Bash(git merge-base*)', 'Bash(git diff*)', 'Bash(git status*)', 'Bash(git rev-parse*)',
      '--output-format', 'json',
    ];
    const p = spawn('claude', args, { cwd });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });
}

async function runCase(run, name) {
  const wt = path.join(os.tmpdir(), `ttm-eval-${process.pid}-${name}-${run}`);
  git(repo, 'worktree', 'add', '--detach', wt, manifest.clean_commit);
  try {
    overlay(path.join(here, 'cases', name), wt);
    git(wt, 'add', '-A');
    git(wt, '-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-q', '--allow-empty', '-m', `case ${name}`);
    const raw = await runClaude(wt);
    let j = null;
    try {
      j = JSON.parse(raw);
    } catch {
      /* keep null */
    }
    const parsed = j ? extractJson(j.result || '') : null;
    const findings = parsed?.findings ?? [];
    const bugs = manifest.cases[name].bugs;
    const matchedBugs = new Set();
    const matchedFindings = [];
    const unmatched = [];
    for (const f of findings) {
      const hit = bugs.find((b) => b.file === f.file && f.line >= b.lines[0] - 3 && f.line <= b.lines[1] + 3);
      if (hit) {
        matchedBugs.add(hit.id);
        matchedFindings.push({ ...f, bug: hit.id });
      } else unmatched.push(f);
    }
    return {
      run, case: name, parsed_ok: Boolean(parsed), planted: bugs.length,
      found: [...matchedBugs], missed: bugs.map((b) => b.id).filter((id) => !matchedBugs.has(id)),
      findings_total: findings.length, matched_findings: matchedFindings.length, unmatched,
      cost_usd: j?.total_cost_usd ?? null, turns: j?.num_turns ?? null,
      usage: j?.modelUsage ?? null,
    };
  } finally {
    try { git(repo, 'worktree', 'remove', '--force', wt); } catch { /* best effort */ }
  }
}

const results = [];
for (let r = 1; r <= runs; r++) {
  const batch = await Promise.all(caseNames.map((c) => runCase(r, c)));
  results.push(...batch);
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`run ${r}: ` + batch.map((b) => `${b.case} found ${b.found.length}/${b.planted} findings ${b.findings_total} $${(b.cost_usd ?? 0).toFixed(2)}`).join(' | '));
}

const planted = results.filter((x) => x.planted > 0);
const foundSum = planted.reduce((s, x) => s + x.found.length, 0);
const plantedSum = planted.reduce((s, x) => s + x.planted, 0);
const total = results.reduce((s, x) => s + x.findings_total, 0);
const matched = results.reduce((s, x) => s + x.matched_findings, 0);
const summary = {
  runs, recall: plantedSum ? foundSum / plantedSum : null,
  precision_strict: total ? matched / total : null, findings_total: total, matched_findings: matched,
  unmatched_for_review: results.flatMap((x) => x.unmatched.map((f) => ({ run: x.run, case: x.case, ...f }))),
  cost_usd: results.reduce((s, x) => s + (x.cost_usd ?? 0), 0), out: outDir,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, unmatched_for_review: summary.unmatched_for_review.length }, null, 1));
