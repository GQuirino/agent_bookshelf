#!/usr/bin/env node
// Cost A/B for the one lever (PostToolUse hook that trims Vitest output to failing tests).
//   node ticket-to-merge/evals/ab-cost.mjs [--pairs 3] [--out <dir>]
// Each trial: fresh worktree at the pre-feature commit, full /ship-ticket (tests, build, review,
// fix loop), then a quality recheck: the REFERENCE tests (from the clean commit) are copied in and
// run as an independent oracle, plus tsc. Baseline = TTM_TRIM_VITEST=0, lever = unset.
// Trials are sequential (the suite shares /tmp database paths) and interleaved (off,on,off,on...).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, '..');
const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: here, encoding: 'utf8' }).trim();
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const pairs = parseInt(arg('pairs', '3'), 10);
// scenario 'build' = full /ship-ticket from the pre-feature commit; 'fixloop' = /ship-ticket review on the
// planted-bug case (starts with 21 failing tests, the case where trimming Vitest output should matter).
const scenario = arg('scenario', 'build');
const outDir = path.resolve(arg('out', path.join(os.tmpdir(), `ab-cost-${Date.now()}`)));
fs.mkdirSync(outDir, { recursive: true });
const PRE = '4b5c1f8'; // plugin + SPEC.md, no tests, no implementation
const REF = '6fc26ca'; // reference implementation + tests
const sh = (cwd, cmd, args, env) => {
  try {
    return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

function claude(cwd, env) {
  return new Promise((resolve) => {
    const p = spawn(
      'claude',
      [
        '-p', scenario === 'fixloop' ? '/ticket-to-merge:ship-ticket review 4b5c1f8' : '/ticket-to-merge:ship-ticket', '--plugin-dir', pluginDir, '--permission-mode', 'acceptEdits',
        '--allowedTools', 'Skill', 'Bash(npm run test:run*)', 'Bash(npx vitest*)', 'Bash(npx tsc --noEmit*)',
        'Bash(touch .tests.lock)', 'Bash(rm -f .tests.lock)', 'Bash(git status*)', 'Bash(git diff*)',
        'Bash(git merge-base*)', 'Bash(git rev-parse*)', 'Bash(git add*)', 'Bash(git commit*)',
        '--output-format', 'json',
      ],
      { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', () => resolve(out));
  });
}

const trials = [];
for (let i = 1; i <= pairs; i++) {
  for (const config of ['baseline', 'lever']) {
    const wt = path.join(os.tmpdir(), `ttm-ab-${process.pid}-${config}-${i}`);
    sh(repo, 'git', ['worktree', 'add', '--detach', wt, scenario === 'fixloop' ? REF : PRE]);
    if (scenario === 'fixloop') {
      fs.cpSync(path.join(here, 'cases', 'planted', 'src'), path.join(wt, 'src'), { recursive: true });
      sh(wt, 'git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', 'commit', '-qam', 'planted bugs']);
    }
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(wt, 'node_modules'));
    const env = config === 'baseline' ? { TTM_TRIM_VITEST: '0' } : { TTM_TRIM_VITEST: '' };
    const t0 = Date.now();
    const raw = await claude(wt, env);
    let j = null;
    try {
      j = JSON.parse(raw);
    } catch {
      /* keep null */
    }
    // quality recheck: own tests first, then the reference tests as an independent oracle
    const ownTests = sh(wt, 'npm', ['run', 'test:run']);
    const refTests = sh(repo, 'git', ['ls-tree', '-r', '--name-only', REF, 'tests']).out.trim().split('\n');
    for (const f of refTests) {
      const dest = path.join(wt, f).replace(/\.test\.ts$/, '.oracle.test.ts');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, sh(repo, 'git', ['show', `${REF}:${f}`]).out);
    }
    const oracle = sh(wt, 'npx', ['vitest', 'run', 'oracle']);
    const tsc = sh(wt, 'npx', ['tsc', '--noEmit']);
    const touched = sh(wt, 'git', ['diff', '--name-only', PRE, '--', 'src']).out.trim().split('\n').filter(Boolean);
    const um = j?.modelUsage ?? {};
    const sum = (k) => Object.values(um).reduce((s, u) => s + (u[k] || 0), 0);
    const t = {
      trial: i, config, cost_usd: j?.total_cost_usd ?? null, turns: j?.num_turns ?? null, sec: Math.round((Date.now() - t0) / 1000),
      out_tokens: sum('outputTokens'), cache_read: sum('cacheReadInputTokens'), cache_write: sum('cacheCreationInputTokens'), in_tokens: sum('inputTokens'),
      models: Object.fromEntries(Object.entries(um).map(([m, u]) => [m, +u.costUSD.toFixed(4)])),
      subagents: j?.subagent_stats?.by_type ?? null, denials: j?.permission_denials?.length ?? null,
      quality: {
        own_tests_green: ownTests.ok && /Tests\s+\d+ passed/.test(ownTests.out),
        oracle_green: oracle.ok, oracle_tail: oracle.out.split('\n').slice(-8).join('\n'),
        tsc_clean: tsc.ok, src_touched: touched,
      },
      final_report: (j?.result || '').slice(0, 1500),
    };
    t.cache_hit = t.cache_read / Math.max(1, t.cache_read + t.cache_write + t.in_tokens);
    trials.push(t);
    fs.writeFileSync(path.join(outDir, 'trials.json'), JSON.stringify(trials, null, 2));
    console.log(`${config} #${i}: $${(t.cost_usd ?? 0).toFixed(3)} turns ${t.turns} oracle ${t.quality.oracle_green} own ${t.quality.own_tests_green} tsc ${t.quality.tsc_clean} src ${touched.join(',')}`);
    sh(repo, 'git', ['worktree', 'remove', '--force', wt]); // cleanup of this trial's temp worktree only
  }
}
const agg = (c) => {
  const x = trials.filter((t) => t.config === c && t.cost_usd != null);
  const avg = (k) => x.reduce((s, t) => s + t[k], 0) / Math.max(1, x.length);
  return {
    n: x.length, mean_cost: avg('cost_usd'), mean_out_tokens: avg('out_tokens'), mean_cache_read: avg('cache_read'), mean_cache_hit: avg('cache_hit'),
    costs: x.map((t) => +t.cost_usd.toFixed(3)), all_quality_ok: x.every((t) => t.quality.oracle_green && t.quality.tsc_clean),
  };
};
const summary = { baseline: agg('baseline'), lever: agg('lever') };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
