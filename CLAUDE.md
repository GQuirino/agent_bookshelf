# Agent Bookshelf

Goodreads-lite teaching app. Express 4, sql.js, EJS + htmx, TypeScript (ESM), Vitest.

## Commands
- Run all tests: `npm run test:run` (never bare `npm test`, it watches).
- Type-check: `npx tsc --noEmit`
- Dev server: `npm run dev`

## Layout
- `src/routes/`: Express routers. `api.ts` is JSON, `books.ts` is HTML.
- `src/models/`: data access through `src/db/index.ts` helpers (`all`, `get`, `run`). Parameterised SQL only.
- `src/views/`, `src/public/`: EJS and CSS. Not touched by BOOK-101.
- `tests/models/`, `tests/routes/`: Vitest. Route tests use supertest against `src/server.ts`.

## Conventions
- ESM: relative imports end in `.js` (`'../models/book.js'`).
- JSON errors: `res.status(4xx).json({ error: '...' })`.
- Literal SQL strings with `?` placeholders. Never build SQL with template strings or concatenation.
- Test files init a fresh db: `initDb('/tmp/<name>.db')` in `beforeEach`, `closeDb()` in `afterEach`. Seed has 50 books.

## Rules that must hold
- Never touch `bookshelf.db`, `src/db/seed.sql` or `.env`. A hook blocks it. Do not try to work around it.
- No schema changes and no new dependencies.
- Read `SPEC.md` first. It is the source of truth for the interface and the definition of done.
- While implementing, `tests/` is read-only. If a test looks wrong, report it, do not edit it.
- Done means `npm run test:run` output shows green. Quote the command and its result, do not just say it passes.

## Ticket workflow (plugin `ticket-to-merge`)
- `/ticket-to-merge:ship-ticket`: tests first (red), lock tests, implement (green), review, fix.
- `/ticket-to-merge:review-pr`: read-only reviewers audit a diff and return JSON findings.
