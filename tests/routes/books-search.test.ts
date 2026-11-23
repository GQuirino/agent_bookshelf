import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import request from 'supertest';
import app from '../../src/server.js';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Book from '../../src/models/book.js';

const DB_PATH = '/tmp/test-book-search-route.db';

// Known seed row (asserted in tests/models/book.test.ts and tests/routes/api.test.ts).
const PRAGMATIC_ID = 1;
const PRAGMATIC_TITLE = 'The Pragmatic Programmer';

const TOO_LONG = 'Query must be 100 characters or fewer';
const NOT_SINGLE = 'Query must be a single string';

const SEARCH = '/api/books/search';

beforeEach(async () => {
  await initDb(DB_PATH);
});

afterEach(() => {
  closeDb();
  try {
    unlinkSync(DB_PATH);
  } catch (e) {
    // ignore
  }
});

describe('API Routes', () => {
  describe('GET /api/books/search', () => {
    describe('match found', () => {
      it('returns 200 with a books array containing the matching book', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'Pragmatic' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.books)).toBe(true);
        expect(res.body.books.map((b: { id: number }) => b.id)).toContain(PRAGMATIC_ID);
      });

      it('matches a partial title case-insensitively', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'pragmatic' });
        expect(res.status).toBe(200);
        for (const b of res.body.books) {
          const hit =
            b.title.toLowerCase().includes('pragmatic') ||
            b.author.toLowerCase().includes('pragmatic');
          expect(hit).toBe(true);
        }
        expect(res.body.books.map((b: { id: number }) => b.id)).toContain(PRAGMATIC_ID);
      });

      it('matches a partial author', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'David Thomas' });
        expect(res.status).toBe(200);
        expect(res.body.books.map((b: { id: number }) => b.id)).toContain(PRAGMATIC_ID);
      });

      it('matches an uppercase author query', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'ANDREW HUNT' });
        expect(res.status).toBe(200);
        expect(res.body.books.map((b: { id: number }) => b.id)).toContain(PRAGMATIC_ID);
      });

      it('returns Book objects with the existing row shape', async () => {
        const res = await request(app).get(SEARCH).query({ q: PRAGMATIC_TITLE });
        expect(res.status).toBe(200);
        const book = res.body.books.find((b: { id: number }) => b.id === PRAGMATIC_ID);
        expect(book).toBeDefined();
        expect(book.title).toBe(PRAGMATIC_TITLE);
        for (const key of [
          'id',
          'title',
          'author',
          'isbn',
          'cover_url',
          'description',
          'published_year',
          'created_at',
        ]) {
          expect(book).toHaveProperty(key);
        }
      });

      it('orders matches by title', async () => {
        const res = await request(app).get(SEARCH).query({ q: '' });
        expect(res.status).toBe(200);
        const titles = res.body.books.map((b: { title: string }) => b.title);
        for (let i = 1; i < titles.length; i++) {
          expect(titles[i - 1] <= titles[i]).toBe(true);
        }
      });
    });

    describe('no match', () => {
      it('returns 200 with an empty books array', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'zzz-no-such-book-qqq' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ books: [] });
      });
    });

    describe('empty query', () => {
      it('returns all 50 seeded books when q is missing', async () => {
        const res = await request(app).get(SEARCH);
        expect(res.status).toBe(200);
        expect(res.body.books).toHaveLength(50);
        expect(res.body.books.map((b: { id: number }) => b.id)).toEqual(
          Book.getAllBooks().map((b) => b.id)
        );
      });

      it('returns all 50 seeded books when q is empty', async () => {
        const res = await request(app).get(SEARCH).query({ q: '' });
        expect(res.status).toBe(200);
        expect(res.body.books).toHaveLength(50);
      });

      it('returns all 50 seeded books when q is only whitespace', async () => {
        const res = await request(app).get(SEARCH).query({ q: '    ' });
        expect(res.status).toBe(200);
        expect(res.body.books).toHaveLength(50);
      });
    });

    describe('trimming', () => {
      it('trims surrounding whitespace before matching', async () => {
        const padded = await request(app).get(SEARCH).query({ q: '   pragmatic   ' });
        const plain = await request(app).get(SEARCH).query({ q: 'pragmatic' });
        expect(padded.status).toBe(200);
        expect(padded.body.books.map((b: { id: number }) => b.id)).toEqual(
          plain.body.books.map((b: { id: number }) => b.id)
        );
      });
    });

    describe('length limit', () => {
      it('accepts a query of exactly 100 characters', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'a'.repeat(100) });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ books: [] });
      });

      it('rejects a query of 101 characters with 400 and the exact error', async () => {
        const res = await request(app).get(SEARCH).query({ q: 'a'.repeat(101) });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: TOO_LONG });
      });

      it('measures the length after trimming: 100 characters padded with spaces is valid', async () => {
        const res = await request(app)
          .get(SEARCH)
          .query({ q: `   ${'b'.repeat(100)}   ` });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ books: [] });
      });

      it('rejects 101 characters after trimming with 400 and the exact error', async () => {
        const res = await request(app)
          .get(SEARCH)
          .query({ q: `   ${'b'.repeat(101)}   ` });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: TOO_LONG });
      });
    });

    describe('repeated or non-string q', () => {
      it('rejects a repeated q parameter with 400 and the exact error', async () => {
        const res = await request(app).get(`${SEARCH}?q=a&q=b`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: NOT_SINGLE });
      });

      it('rejects an array-style q[] parameter with 400 and the exact error', async () => {
        const res = await request(app).get(`${SEARCH}?q[]=a`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: NOT_SINGLE });
      });

      it('rejects an object-style q[x] parameter with 400 and the exact error', async () => {
        const res = await request(app).get(`${SEARCH}?q[x]=a`);
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: NOT_SINGLE });
      });
    });

    describe('SQL injection', () => {
      it("treats ' OR '1'='1 as data and returns no books", async () => {
        const res = await request(app).get(SEARCH).query({ q: "' OR '1'='1" });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ books: [] });
      });

      it('does not execute a DROP TABLE payload', async () => {
        const res = await request(app)
          .get(SEARCH)
          .query({ q: "'; DROP TABLE books; --" });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ books: [] });

        const after = await request(app).get('/api/books');
        expect(after.body).toHaveLength(50);
      });
    });
  });
});
