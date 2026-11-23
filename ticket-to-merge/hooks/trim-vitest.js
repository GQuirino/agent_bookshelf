#!/usr/bin/env node
// PostToolUse cost lever: when a Bash call ran Vitest, replace the output the model sees with
// the failing tests only (names, one-line reasons, short failure blocks) plus the summary.
// Passing tests are dropped, stack traces are capped. Real output on disk is unchanged.
// Anything that is not a Vitest run, or has an unexpected shape, is left alone (exit 0, no output).
import fs from 'node:fs';

const MAX_BLOCK_LINES = 10;
const MAX_TOTAL_LINES = 120;

// Baseline switch for the cost A/B: TTM_TRIM_VITEST=0 disables the lever.
if (process.env.TTM_TRIM_VITEST === '0') process.exit(0);

let input;
try {
  input = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}
if (input.tool_name !== 'Bash') process.exit(0);
const cmd = String(input.tool_input?.command || '');
if (!/\bvitest\b|\btest:run\b|\bnpm\s+(run\s+)?test\b/.test(cmd)) process.exit(0);

const resp = input.tool_response;
const original = typeof resp === 'string' ? resp : resp && typeof resp.stdout === 'string' ? resp.stdout : null;
if (original === null || !/Test Files|Tests\s+\d/.test(original)) process.exit(0); // not a finished vitest report

const text = original.replace(/\x1b\[[0-9;]*m/g, '');
const lines = text.split('\n');
const out = [];
let block = 0;
let inBlock = false;
let failures = 0;
for (const l of lines) {
  if (/^\s*✓/.test(l)) continue;
  if (/^⎯{3,}/.test(l.trim()) || /^\s*⎯{3,}/.test(l)) {
    inBlock = false;
    if (/Failed Tests|Failed Suites/.test(l)) out.push(l.trim());
    continue;
  }
  if (/^\s*FAIL\s/.test(l)) {
    inBlock = true;
    block = 0;
    failures++;
    out.push(l.trim());
    continue;
  }
  if (inBlock) {
    if (block++ < MAX_BLOCK_LINES && l.trim() !== '' && !/^\s*❯\s+\S+:\d+/.test(l) && !/node_modules/.test(l)) out.push(l);
    continue;
  }
  if (/^\s*(×|→)/.test(l) || /^\s*❯\s+tests\//.test(l)) {
    out.push(l);
    if (/^\s*×/.test(l)) failures = failures || 1;
    continue;
  }
  if (/^\s*(Test Files|Tests|Duration|Errors?)\b/.test(l)) out.push(l.trim());
}

let body = out;
if (!/×|FAIL/.test(out.join('\n'))) body = ['All tests passed.', ...out];
let truncated = false;
if (body.length > MAX_TOTAL_LINES) {
  const tail = body.slice(-6);
  body = [...body.slice(0, MAX_TOTAL_LINES - 6), '...', ...tail];
  truncated = true;
}
body.push(`[ticket-to-merge: vitest output trimmed to failing tests (${lines.length} -> ${body.length} lines)${truncated ? ', capped' : ''}. Passing tests omitted; run \`npx vitest run <file>\` for full detail.]`);

const updated = typeof resp === 'string' ? body.join('\n') : { ...resp, stdout: body.join('\n'), stderr: '' };
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: updated } }));
process.exit(0);
