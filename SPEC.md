# BOOK-101: Search books by title or author

## Outcome
One deliverable: a JSON endpoint `GET /api/books/search?q=<text>` that returns the books whose title or author contains the query.

## Context
- Express 4 + sql.js (SQLite in WebAssembly), TypeScript, ESM (`.js` import suffixes), Vitest + supertest.
- `src/models/book.ts` already exports `searchBooks(query)`: parameterised `LIKE` on title and author, ordered by title. It does no trimming and no length check.
- `src/routes/api.ts` has `/api/books` and `/api/books/:id`, and no search route. The new route must be registered **before** `/books/:id`, or `search` is read as an id.
- `src/routes/books.ts` has an HTML `GET /books/search` stub ("coming soon"). Leave it alone.
- Error style in `api.ts`: `res.status(400).json({ error: '...' })`.
- Tests: `tests/models/*.test.ts` and `tests/routes/*.test.ts`. Each file calls `initDb('/tmp/<name>.db')` in `beforeEach` and `closeDb()` in `afterEach`. The seed has 50 books.

## Interface (exact, do not change)
`GET /api/books/search?q=<text>`

| Case | Status | Body |
|---|---|---|
| Match found | 200 | `{ "books": [Book, ...] }` ordered by title |
| No match | 200 | `{ "books": [] }` |
| `q` missing or empty after trim | 200 | `{ "books": [<all books>] }` ordered by title |
| `q` longer than 100 chars after trim | 400 | `{ "error": "Query must be 100 characters or fewer" }` |
| `q` repeated (`?q=a&q=b`) or not a string | 400 | `{ "error": "Query must be a single string" }` |

`Book` is the existing row shape: `id, title, author, isbn, cover_url, description, published_year, created_at`.

## Acceptance criteria
1. The query matches title or author, partially and case-insensitively.
2. An empty query returns all books.
3. Input is trimmed. A trimmed query over 100 characters returns the 400 above. Exactly 100 characters is valid.
4. SQL is parameterised. No string-built queries.
5. Vitest covers each criterion above (model and route level), and `npm run test:run` passes.

## Constraints
- No schema changes. No new dependencies.
- Never touch `bookshelf.db` (and its `-wal`/`-shm`), `src/db/seed.sql`, or `.env`.
- Keep the interface exactly as specified.
- Stay in scope: no changes to the HTML views, other routes, or other models.

## Out of scope
- HTML or htmx search UI, pagination, ranking, and escaping of `%` and `_` (they act as LIKE wildcards; a known limitation, not a bug for this ticket).

## Definition of done
`npm run test:run` is green, `npx tsc --noEmit` is clean, and the diff touches only `src/routes/api.ts`, `src/models/book.ts` (only if needed) and `tests/`.

## Verification path
```
npm run test:run
npx tsc --noEmit
```
