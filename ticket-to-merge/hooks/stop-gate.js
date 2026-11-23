#!/usr/bin/env node
// Stop hook: while the implement phase is active (.tests.lock exists), the main
// session cannot stop until `npm run test:run` passes. Exit 2 sends the failure back to
// the agent. After MAX_BLOCKS consecutive blocks it lets go, so a genuinely stuck run
// reports instead of looping forever.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_BLOCKS = 3;
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const lock = path.join(root, '.tests.lock');
const counter = path.join(root, '.claude', 'stop-gate.count');

if (!fs.existsSync(lock)) process.exit(0);

const count = () => {
  try {
    return parseInt(fs.readFileSync(counter, 'utf8'), 10) || 0;
  } catch {
    return 0;
  }
};

const r = spawnSync('npm', ['run', 'test:run'], { cwd: root, encoding: 'utf8', timeout: 120000 });
if (r.status === 0) {
  fs.rmSync(counter, { force: true });
  process.exit(0);
}

const n = count() + 1;
if (n > MAX_BLOCKS) {
  fs.rmSync(counter, { force: true });
  process.stderr.write(`stop-gate: tests still failing after ${MAX_BLOCKS} attempts; letting the session stop. Report the failures honestly.\n`);
  process.exit(0);
}
fs.writeFileSync(counter, String(n));
const tail = `${r.stdout || ''}${r.stderr || ''}`.split('\n').slice(-40).join('\n');
process.stderr.write(
  `stop-gate (attempt ${n}/${MAX_BLOCKS}): npm run test:run is not green, so the implement phase is not done.\n` +
    `Fix the implementation in src/ (tests/ is locked) or report that a test looks wrong.\n\n${tail}\n`,
);
process.exit(2);
