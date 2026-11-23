#!/usr/bin/env node
// Bypass tests for protect.js. Run: node ticket-to-merge/hooks/protect.test.mjs
// Exit code 0 = every attack blocked and every legitimate call allowed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'protect.js');

// Throwaway project so hardlink/symlink cases are real and nothing real is touched.
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'protect-test-'));
fs.mkdirSync(path.join(proj, 'src', 'db'), { recursive: true });
fs.mkdirSync(path.join(proj, 'tests'), { recursive: true });
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
fs.writeFileSync(path.join(proj, 'src', 'db', 'seed.sql'), '-- seed');
fs.writeFileSync(path.join(proj, 'bookshelf.db'), 'db');
fs.writeFileSync(path.join(proj, '.env'), 'SECRET=1');
fs.symlinkSync(path.join(proj, '.env'), path.join(proj, 'notes.txt'));
fs.linkSync(path.join(proj, 'src', 'db', 'seed.sql'), path.join(proj, 'innocent.sql'));
const lockFile = path.join(proj, '.tests.lock');

function run(tool_name, tool_input, { lock = false, agent = false } = {}) {
  if (lock) fs.writeFileSync(lockFile, '');
  else fs.rmSync(lockFile, { force: true });
  const r = spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name, tool_input, cwd: proj, ...(agent ? { agent_id: 'a1', agent_type: 'ticket-to-merge:be-writer' } : {}) }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: proj },
    encoding: 'utf8',
  });
  return r.status;
}

const bash = (command, opts) => run('Bash', { command }, opts);
const edit = (file_path, opts) => run('Edit', { file_path, old_string: 'a', new_string: 'b' }, opts);
const write = (file_path, opts) => run('Write', { file_path, content: 'x' }, opts);

const cases = [];
const expectBlock = (name, status) => cases.push([name, status === 2, 'blocked (exit 2)', status]);
const expectAllow = (name, status) => cases.push([name, status === 0, 'allowed (exit 0)', status]);

// --- Edit / Write by path ---
expectBlock('Edit .env', edit('.env'));
expectBlock('Edit ./.env', edit('./.env'));
expectBlock('Edit absolute .env', edit(path.join(proj, '.env')));
expectBlock('Edit .env.local', edit('.env.local'));
expectBlock('Edit .env.production', edit('.env.production'));
expectBlock('Edit .ENV (case-insensitive fs)', edit('.ENV'));
expectBlock('Write bookshelf.db', write('bookshelf.db'));
expectBlock('Write bookshelf.db-wal', write('bookshelf.db-wal'));
expectBlock('Write bookshelf.db-shm', write('bookshelf.db-shm'));
expectBlock('Edit src/db/seed.sql', edit('src/db/seed.sql'));
expectBlock('Edit ../ traversal to seed.sql', edit('src/models/../db/seed.sql'));
expectBlock('Edit absolute seed.sql', edit(path.join(proj, 'src', 'db', 'seed.sql')));
expectBlock('Edit SEED.SQL', edit('src/db/SEED.SQL'));
expectBlock('Edit via symlink to .env', edit('notes.txt'));
expectBlock('Edit via hardlink to seed.sql', edit('innocent.sql'));
expectBlock('MultiEdit seed.sql', run('MultiEdit', { file_path: 'src/db/seed.sql', edits: [] }));
expectBlock('NotebookEdit .env', run('NotebookEdit', { notebook_path: '.env' }));
expectBlock('Read .env', run('Read', { file_path: '.env' }));
expectBlock('Read .env.local', run('Read', { file_path: '.env.local' }));
expectBlock('Read via symlink to .env', run('Read', { file_path: 'notes.txt' }));

// --- Bash: direct and redirected ---
expectBlock('echo > .env', bash('echo X > .env'));
expectBlock('echo >> .env', bash('echo X >> .env'));
expectBlock('cat .env', bash('cat .env'));
expectBlock('rm bookshelf.db', bash('rm bookshelf.db'));
expectBlock('rm -f bookshelf.db-wal', bash('rm -f bookshelf.db-wal'));
expectBlock('sed -i seed.sql', bash("sed -i 's/a/b/' src/db/seed.sql"));
expectBlock('perl -i seed.sql', bash("perl -pi -e 's/a/b/' src/db/seed.sql"));
expectBlock('cp over seed.sql', bash('cp /tmp/x.sql src/db/seed.sql'));
expectBlock('mv seed.sql away', bash('mv src/db/seed.sql /tmp/'));
expectBlock('tee .env', bash('echo X | tee .env'));
expectBlock('truncate db', bash('truncate -s 0 bookshelf.db'));
expectBlock('sqlite3 on db', bash('sqlite3 bookshelf.db "delete from books"'));
expectBlock('cd then relative', bash('cd src/db && echo x > seed.sql'));
expectBlock('chained with ;', bash('npm run test:run; rm .env'));
expectBlock('chained with &&', bash('ls && cat .env'));
expectBlock('in subshell', bash('(cat .env)'));
expectBlock('dd of=', bash('dd if=/dev/zero of=bookshelf.db'));
expectBlock('.env.local via cat', bash('cat .env.local'));
expectBlock('absolute path', bash(`cat ${path.join(proj, '.env')}`));
expectBlock('traversal path', bash('cat src/../.env'));
expectBlock('uppercase name', bash('cat .ENV'));

// --- Bash: obfuscation ---
expectBlock('quoted name', bash("cat '.env'"));
expectBlock('double quoted name', bash('cat ".env"'));
expectBlock('split quotes se""ed.sql', bash('cat src/db/se""ed.sql'));
expectBlock("split quotes '.e''nv'", bash("cat '.e''nv'"));
expectBlock('backslash escapes', bash('cat src/db/s\\eed.sql'));
expectBlock('glob *.db', bash('rm *.db'));
expectBlock('glob seed.s*', bash('cat src/db/seed.s*'));
expectBlock('glob .e*', bash('cat .e*'));
expectBlock('glob .en?', bash('cat .en?'));
expectBlock('glob bookshelf.d[b]', bash('rm bookshelf.d[b]'));
expectBlock('var-built name', bash('a=see; b=d.sql; cat src/db/$a$b'));
expectBlock('var-built .env', bash('f=.en; cat ${f}v'));
expectBlock('eval', bash('eval "cat .e""nv"'));
expectBlock('base64 payload', bash('echo Y2F0IC5lbnY= | base64 -d | sh # seed'));
expectBlock('sh -c', bash("sh -c 'cat .env'"));
expectBlock('node -e fs write', bash(`node -e "require('fs').writeFileSync('.env','x')"`));
expectBlock('python -c concat', bash(`python3 -c "open('see'+'d.sql','w')"`));
expectBlock('node -e concat', bash(`node -e "fs.rmSync('book'+'shelf.db')"`));
expectBlock('python chr() path', bash(`python3 -c "import os;open(os.getcwd()+chr(47)+chr(46)+chr(101)+chr(110)+chr(118)).read()"`));
expectBlock('node join() path', bash(`node -e "require('fs').readFileSync(['.','env'].join(''))"`));
expectBlock('printf \\x escape', bash(`printf '\\x2eenv' | xargs cat`));
expectBlock('$-quote escape', bash(`cat $'\\x2eenv'`));
expectBlock('octal escape', bash(`printf '\\056env' | xargs cat`));
expectBlock('ruby -e File', bash(`ruby -e "File.write('x'+'.env','')"`));
expectBlock('bash -c with cat', bash(`bash -c 'cat $(echo . )env'`));
expectBlock('xargs from find', bash('find . -maxdepth 1 -name ".env*" | xargs cat'));
expectBlock('rm src/db dir', bash('rm -rf src/db'));
expectBlock('rm src/db/ dir', bash('rm -rf src/db/'));
expectBlock('git checkout src/db', bash('git checkout -- src/db'));
expectBlock('git clean', bash('git clean -fdx'));
expectBlock('git restore src/db', bash('git restore src/db'));

// --- legitimate calls must pass ---
expectAllow('Edit src/routes/api.ts', edit('src/routes/api.ts'));
expectAllow('Edit src/models/book.ts', edit('src/models/book.ts'));
expectAllow('Write tests file (no lock)', write('tests/routes/search.test.ts'));
expectAllow('Edit .env.example', edit('.env.example'));
expectAllow('Edit schema.sql', edit('src/db/schema.sql'));
expectAllow('Read SPEC.md', run('Read', { file_path: 'SPEC.md' }));
expectAllow('Read .env.example', run('Read', { file_path: '.env.example' }));
expectAllow('npm run test:run', bash('npm run test:run'));
expectAllow('npx tsc --noEmit', bash('npx tsc --noEmit'));
expectAllow('git status', bash('git status --short'));
expectAllow('git diff', bash('git diff origin/main -- src/routes/api.ts'));
expectAllow('git log', bash('git log --oneline -5'));
expectAllow('grep in src', bash('grep -rn "searchBooks" src tests'));
expectAllow('ls src/db', bash('ls src/db'));
expectAllow('cat schema.sql', bash('cat src/db/schema.sql'));
expectAllow('process.env in node -e', bash(`node -e "console.log(process.env.NODE_ENV)"`));
expectAllow('vitest with 2>&1 (no lock)', bash('npx vitest run tests/ 2>&1 | tail -20'));
expectAllow('curl endpoint', bash('curl -s "localhost:3000/api/books/search?q=tolkien"'));
expectAllow('git commit message', bash('git commit -m "Add search endpoint"'));
expectAllow('dollar var without fragments', bash('git diff $(git merge-base HEAD origin/main)'));

// --- test lock (implement phase) ---
const L = { lock: true };
expectBlock('lock: Edit tests file', edit('tests/routes/api.test.ts', L));
expectBlock('lock: Write new test file', write('tests/routes/new.test.ts', L));
expectBlock('lock: absolute tests path', write(path.join(proj, 'tests', 'x.test.ts'), L));
expectBlock('lock: traversal into tests', write('src/../tests/x.test.ts', L));
expectBlock('lock: redirect into tests', bash('echo x > tests/a.test.ts', L));
expectBlock('lock: sed -i tests', bash("sed -i 's/a/b/' tests/a.test.ts", L));
expectBlock('lock: rm tests file', bash('rm tests/a.test.ts', L));
expectBlock('lock: git checkout tests', bash('git checkout -- tests/a.test.ts', L));
expectBlock('lock: tee tests', bash('echo x | tee tests/a.test.ts', L));
expectBlock('lock: cp into tests', bash('cp /tmp/a tests/a.test.ts', L));
expectAllow('lock: Edit src still ok', edit('src/routes/api.ts', L));
expectAllow('lock: run tests', bash('npm run test:run', L));
expectAllow('lock: vitest with 2>&1', bash('npx vitest run tests/ 2>&1 | tail -20', L));
expectAllow('lock: vitest one file', bash('npx vitest run tests/routes/api.test.ts', L));
expectAllow('lock: cat tests file', bash('cat tests/routes/api.test.ts', L));
expectAllow('lock: grep tests', bash('grep -rn search tests', L));
expectBlock('lock: protected still blocked', edit('.env', L));

// --- subagents may not flip the lock; the main thread may ---
const A = { lock: true, agent: true };
expectBlock('agent: rm lock', bash('rm -f .tests.lock', A));
expectBlock('agent: rm lock (quoted)', bash("rm -f '.tes''ts.lock'", A));
expectBlock('agent: touch lock', bash('touch .tests.lock', { agent: true }));
expectBlock('agent: write lock', write('.tests.lock', A));
expectBlock('agent: edit lock via ./', edit('./.tests.lock', A));
expectBlock('agent: mv lock', bash('mv .tests.lock /tmp/x', A));
expectAllow('agent: edit src while locked', edit('src/routes/api.ts', A));
expectAllow('agent: run tests while locked', bash('npm run test:run', A));
expectBlock('agent: still cannot edit tests', edit('tests/x.test.ts', A));
expectAllow('main: rm lock', bash('rm -f .tests.lock', L));
expectAllow('main: touch lock', bash('touch .tests.lock'));

let failed = 0;
for (const [name, ok, want, got] of cases) {
  if (!ok) {
    failed++;
    console.log(`FAIL  ${name}  (wanted ${want}, got exit ${got})`);
  }
}
fs.rmSync(proj, { recursive: true, force: true });
console.log(`${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
