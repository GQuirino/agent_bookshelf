#!/usr/bin/env node
// PreToolUse guardrail for ticket-to-merge.
//   1. Always: block touching bookshelf.db (+ -wal/-shm/-journal), seed.sql, .env, .env.*
//      (.env.example is allowed). Edit/Write/MultiEdit/NotebookEdit are checked by path
//      (resolved, symlink-resolved, inode-compared). Bash is checked by command text.
//      Read is blocked for .env only.
//   2. While <project>/.claude/tests.lock exists: block edits to tests/ (implement phase).
// Exit 2 blocks the call; stderr is shown to the agent.
import fs from 'node:fs';
import path from 'node:path';

const NAME = String.raw`(?:bookshelf\.db(?:-wal|-shm|-journal)?|seed\.sql|\.env(?:\.(?!example(?![\w.-]))[\w.-]*)?)`;
const PROTECTED_BASENAME = new RegExp(`^${NAME}$`, 'i');
const ENV_BASENAME = /^\.env(?:\.(?!example(?![\w.-]))[\w.-]*)?$/i;
const GLOB_TARGETS = ['bookshelf.db', 'bookshelf.db-wal', 'bookshelf.db-shm', 'seed.sql', '.env'];

function block(reason) {
  process.stderr.write(`BLOCKED by ticket-to-merge guardrail: ${reason}\n`);
  process.exit(2);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

let input;
try {
  input = JSON.parse(readStdin());
} catch {
  block('could not parse hook input (failing closed).');
}

const tool = input.tool_name || '';
const ti = input.tool_input || {};
const cwd = input.cwd || process.cwd();
const root = process.env.CLAUDE_PROJECT_DIR || cwd;
const locked = fs.existsSync(path.join(root, '.claude', 'tests.lock'));

// ---- protected files by identity (hardlinks) ----
function knownProtectedFiles() {
  const dirs = new Set([root, cwd]);
  const files = [];
  for (const d of dirs) {
    files.push(path.join(d, 'src', 'db', 'seed.sql'), path.join(d, '.env'));
    for (const s of ['', '-wal', '-shm', '-journal']) files.push(path.join(d, `bookshelf.db${s}`));
  }
  return files;
}

function sameInodeAsProtected(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return false;
  }
  return knownProtectedFiles().some((f) => {
    try {
      const o = fs.statSync(f);
      return o.ino === st.ino && o.dev === st.dev;
    } catch {
      return false;
    }
  });
}

function isProtectedPath(p, { envOnly = false } = {}) {
  if (!p) return false;
  const re = envOnly ? ENV_BASENAME : PROTECTED_BASENAME;
  const abs = path.resolve(cwd, p);
  if (re.test(path.basename(abs))) return true;
  let real = abs;
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* file may not exist yet */
  }
  if (re.test(path.basename(real))) return true;
  return !envOnly && sameInodeAsProtected(abs);
}

function isUnderTests(p) {
  if (!p) return false;
  const abs = path.resolve(cwd, p);
  const rel = path.relative(path.resolve(root, 'tests'), abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ---- Bash analysis ----
function globToRegex(word) {
  let out = '';
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const j = word.indexOf(']', i + 1);
      if (j === -1) out += '\\[';
      else {
        out += word.slice(i, j + 1);
        i = j;
      }
    } else out += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

function analyzeBash(cmd) {
  // Normalise quoting tricks: line continuations, backslashes, quotes, backticks.
  const flat = cmd
    .replace(/\\\n/g, '')
    .replace(/\\(.)/g, '$1')
    .replace(/["'`]/g, '');

  const nameRe = new RegExp(`(?:^|[\\s/=:;&|<>()\\[\\]{},@])(${NAME})(?=$|[\\s;&|<>()\\]},])`, 'i');
  const m = flat.match(nameRe);
  if (m) return `command mentions protected file "${m[1]}".`;

  // Split-quote / escaped fragments: se''ed.sql, "see"d.sql, ...
  const squashed = cmd.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (squashed.includes('seedsql') || squashed.includes('bookshelfdb')) {
    return 'command builds a protected file name out of fragments.';
  }

  // Globs that could expand to a protected file (*.db, seed.s*, .e*, .en?, ...).
  for (const word of flat.split(/[\s;&|<>()]+/)) {
    if (!/[*?[]/.test(word)) continue;
    const seg = word.split('/').pop();
    if (seg.replace(/[*?[\]]/g, '').length < 2) continue;
    const re = globToRegex(seg);
    if (GLOB_TARGETS.some((t) => re.test(t) && (!t.startsWith('.') || seg.startsWith('.')))) {
      return `glob "${word}" could expand to a protected file.`;
    }
  }

  // Dynamic construction: variables / eval / base64 plus a protected fragment.
  const dynamic = /\$\{?[A-Za-z_]|\$\(|\beval\b|\bbase64\b|\bxxd\b|\\x[0-9a-f]{2}/i.test(cmd);
  if (dynamic && /seed|bookshelf|\.sql|\.db|\/\.e|\s\.e|\.en/i.test(cmd)) {
    return 'command builds a path dynamically and references a protected-file fragment.';
  }

  // Byte-escape encoding ($'\x2e', printf '\x2eenv', octal) can spell any name.
  if (/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}|\\[0-7]{3}|\$'[^']*\\/i.test(cmd)) {
    return 'command uses escape-encoded characters, which can hide a protected file name.';
  }

  // Inline interpreter code (python -c, node -e, ...) that touches files or assembles strings
  // can reach any path. Block it; use the Edit/Write tools or plain commands instead.
  if (
    /\b(python3?|node|ruby|perl|php|deno|bun)\s+(?:-\w+\s+)*(-c|-e|-p|--eval|--print|-r)\b|\b(ba|z|da)?sh\s+-c\b/.test(flat) &&
    /\b(open|fs|readFile\w*|writeFile\w*|appendFile\w*|rm\w*|unlink\w*|rename\w*|copyFile\w*|subprocess|system|exec\w*|spawn\w*|popen|chr|fromCharCode|join|Buffer|atob|b64decode|decode|getcwd|glob|listdir|readdir|require|import|File|IO)\b|cat\b|>/.test(flat)
  ) {
    return 'inline interpreter code that touches files or builds strings is not allowed (it can bypass the file guard).';
  }

  // Destroying or reverting the directory that holds seed.sql, or wiping ignored files.
  if (/\bgit\s+clean\b/.test(flat)) return '"git clean" can delete ignored files such as .env and bookshelf.db.';
  if (
    /(^|[\s/])src\/db(\/?$|\/?[\s;&|<>])/.test(flat) &&
    /\b(rm|mv|cp|rsync|truncate|shred|ln|install|dd|tee)\b|\bgit\s+(checkout|restore|reset|stash)\b|\bsed\s+-i|\bperl\s+-\w*i/.test(flat)
  ) {
    return 'command modifies the src/db directory.';
  }

  if (locked) {
    const writeish =
      /\b(tee|rm|mv|cp|touch|truncate|install|patch|dd|ln)\b|\bsed\s+-i|\bperl\s+-\w*i|\bgit\s+(checkout|restore|apply|stash|reset|clean)\b|\b(node|python3?|ruby)\s+-[ec]\b/;
    const noFdRedirects = flat.replace(/\d*>&\d+|\d*>\s*\/dev\/null/g, '');
    const redirect = />>?\s*[^\s&]/.test(noFdRedirects);
    if (/(^|[\s/=])tests(\/|$|\s)/.test(flat) && (writeish.test(flat) || redirect)) {
      return 'tests/ is read-only during the implement phase (.claude/tests.lock exists).';
    }
  }
  return null;
}

// ---- dispatch ----
const pathTools = {
  Edit: ti.file_path,
  Write: ti.file_path,
  MultiEdit: ti.file_path,
  NotebookEdit: ti.notebook_path,
};

if (tool in pathTools) {
  const p = pathTools[tool];
  if (isProtectedPath(p)) block(`${tool} on "${p}" (bookshelf.db, seed.sql and .env are off limits).`);
  if (locked && isUnderTests(p)) block(`${tool} on "${p}": tests/ is read-only during the implement phase. Report the problem instead.`);
} else if (tool === 'Read') {
  if (isProtectedPath(ti.file_path, { envOnly: true })) block(`Read on "${ti.file_path}" (secrets).`);
} else if (tool === 'Bash') {
  const why = analyzeBash(String(ti.command || ''));
  if (why) block(why);
}
process.exit(0);
