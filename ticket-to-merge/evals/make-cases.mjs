#!/usr/bin/env node
// Generates the review-eval cases from the clean BOOK-101 implementation (commit 6fc26ca).
// Each case is a set of full-file overlays under evals/cases/<case>/ plus evals/manifest.json
// listing the planted bugs (file + line range) used to score /review-pr output.
// Run from the repo root:  node ticket-to-merge/evals/make-cases.mjs
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CLEAN_COMMIT = '6fc26ca';
const FILES = ['src/routes/api.ts', 'src/models/book.ts'];
const out = path.join('ticket-to-merge', 'evals', 'cases');
const show = (f) => execSync(`git show ${CLEAN_COMMIT}:${f}`, { encoding: 'utf8' });
const clean = Object.fromEntries(FILES.map((f) => [f, show(f)]));

const write = (c, f, text) => {
  const p = path.join(out, c, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
};
const must = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`pattern not found: ${from}`);
  return text.replace(from, to);
};
const lines = (text, needle) => {
  const i = text.split('\n').findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`needle not found: ${needle}`);
  return i + 1;
};
fs.rmSync(out, { recursive: true, force: true });

// ---- case: clean (the real implementation, no overlay needed) ----
fs.mkdirSync(path.join(out, 'clean'), { recursive: true });
fs.writeFileSync(path.join(out, 'clean', '.keep'), '');

// ---- case: clean-variant (behaviour-identical refactor: must produce no findings) ----
let cv = clean['src/routes/api.ts'];
cv = must(cv, "router.get('/books/search', (req: Request, res: Response) => {",
  "const MAX_QUERY_LENGTH = 100;\n\nfunction parseSearchQuery(raw: unknown): { query: string } | { error: string } {\n  if (raw !== undefined && typeof raw !== 'string') return { error: 'Query must be a single string' };\n  const query = (raw ?? '').trim();\n  if (query.length > MAX_QUERY_LENGTH) return { error: 'Query must be 100 characters or fewer' };\n  return { query };\n}\n\nrouter.get('/books/search', (req: Request, res: Response) => {");
cv = must(cv, /  const q = req\.query\.q;[\s\S]*?  const books = query === '' \? Book\.getAllBooks\(\) : Book\.searchBooks\(query\);\n  res\.json\(\{ books \}\);/.exec(cv)[0],
  "  const parsed = parseSearchQuery(req.query.q);\n  if ('error' in parsed) {\n    return res.status(400).json({ error: parsed.error });\n  }\n\n  const books = parsed.query ? Book.searchBooks(parsed.query) : Book.getAllBooks();\n  res.json({ books });");
write('clean-variant', 'src/routes/api.ts', cv);

// ---- case: planted (4 bugs, tests would catch some, a reviewer must catch all) ----
let api = clean['src/routes/api.ts'];
let model = clean['src/models/book.ts'];
// P3 missing trim, P2 off-by-one
api = must(api, "const query = (q ?? '').trim();", "const query = (q ?? '');");
api = must(api, 'query.length > 100', 'query.length >= 100');
// P4 route shadowed: move the search route after /books/:id
const block = /router\.get\('\/books\/search'[\s\S]*?\n\}\);\n\n/.exec(api)[0];
api = api.replace(block, '');
api = must(api, "router.get('/books/:id'", "@@MOVED@@router.get('/books/:id'");
const idEnd = api.indexOf('\n});\n', api.indexOf("@@MOVED@@")) + 5;
api = api.slice(0, idEnd) + '\n' + block.trimEnd() + '\n' + api.slice(idEnd);
api = api.replace('@@MOVED@@', '');
// P1 string-built SQL
model = must(model, /export function searchBooks[\s\S]*?\n\}\n/.exec(model)[0],
  "export function searchBooks(query: string): Book[] {\n  return all(\n    `SELECT * FROM books WHERE title LIKE '%${query}%' OR author LIKE '%${query}%' ORDER BY title`\n  ) as unknown as Book[];\n}\n");
write('planted', 'src/routes/api.ts', api);
write('planted', 'src/models/book.ts', model);

const searchStart = lines(api, "router.get('/books/search'");
const idStart = lines(api, "router.get('/books/:id'");
const manifest = {
  base_ref: '4b5c1f8',
  clean_commit: CLEAN_COMMIT,
  cases: {
    clean: { bugs: [] },
    'clean-variant': { bugs: [] },
    planted: {
      bugs: [
        { id: 'P1-sql-injection', file: 'src/models/book.ts', lines: [lines(model, 'SELECT * FROM books WHERE title LIKE'), lines(model, 'SELECT * FROM books WHERE title LIKE')], what: 'search SQL built by string interpolation of user input' },
        { id: 'P2-off-by-one', file: 'src/routes/api.ts', lines: [lines(api, 'query.length >= 100'), lines(api, 'query.length >= 100')], what: 'length check is >= 100 so exactly 100 chars is rejected (spec: >100 is an error)' },
        { id: 'P3-no-trim', file: 'src/routes/api.ts', lines: [lines(api, "const query = (q ?? '');"), lines(api, "const query = (q ?? '');")], what: 'query is not trimmed before length check and search' },
        { id: 'P4-route-order', file: 'src/routes/api.ts', lines: [idStart, searchStart + 3], what: '/books/search registered after /books/:id, so :id shadows it' },
      ],
    },
  },
};
fs.writeFileSync(path.join('ticket-to-merge', 'evals', 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest.cases.planted.bugs.map((b) => [b.id, b.lines]), null, 0));
