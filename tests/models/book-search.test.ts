import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { initDb, closeDb } from '../../src/db/index.js';
import * as Book from '../../src/models/book.js';

const DB_PATH = '/tmp/test-book-search-model.db';

// Known seed row (asserted in tests/models/book.test.ts and tests/routes/api.test.ts).
const PRAGMATIC_ID = 1;
const PRAGMATIC_TITLE = 'The Pragmatic Programmer';
const PRAGMATIC_AUTHOR = 'Andrew Hunt and David Thomas';

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

describe('Book Model', () => {
  describe('searchBooks', () => {
    it('matches a partial title', () => {
      const books = Book.searchBooks('Pragmatic');
      expect(books.map((b) => b.id)).toContain(PRAGMATIC_ID);
      for (const b of books) {
        const hit =
          b.title.toLowerCase().includes('pragmatic') ||
          b.author.toLowerCase().includes('pragmatic');
        expect(hit).toBe(true);
      }
    });

    it('matches a partial author', () => {
      const books = Book.searchBooks('David Thomas');
      expect(books.map((b) => b.id)).toContain(PRAGMATIC_ID);
      for (const b of books) {
        const hit =
          b.title.toLowerCase().includes('david thomas') ||
          b.author.toLowerCase().includes('david thomas');
        expect(hit).toBe(true);
      }
    });

    it('is case-insensitive on title and author', () => {
      expect(Book.searchBooks('the PRAGMATIC programmer').map((b) => b.id)).toContain(PRAGMATIC_ID);
      expect(Book.searchBooks('ANDREW HUNT').map((b) => b.id)).toContain(PRAGMATIC_ID);
    });

    it('returns the full Book row shape', () => {
      const [book] = Book.searchBooks(PRAGMATIC_TITLE);
      expect(book).toBeDefined();
      expect(book).toHaveProperty('id', PRAGMATIC_ID);
      expect(book).toHaveProperty('title', PRAGMATIC_TITLE);
      expect(book).toHaveProperty('author', PRAGMATIC_AUTHOR);
      for (const key of [
        'isbn',
        'cover_url',
        'description',
        'published_year',
        'created_at',
      ]) {
        expect(book).toHaveProperty(key);
      }
    });

    it('returns results ordered by title', () => {
      const titles = Book.searchBooks('').map((b) => b.title);
      expect(titles.length).toBeGreaterThan(1);
      for (let i = 1; i < titles.length; i++) {
        expect(titles[i - 1] <= titles[i]).toBe(true);
      }
    });

    it('returns an empty list when nothing matches', () => {
      expect(Book.searchBooks('zzz-no-such-book-qqq')).toEqual([]);
    });

    it('returns all 50 seeded books for an empty query', () => {
      expect(Book.searchBooks('')).toHaveLength(50);
    });

    it('treats a SQL injection string as data and returns no rows', () => {
      expect(Book.searchBooks("' OR 1=1 --")).toEqual([]);
    });

    it('does not execute SQL carried in the query', () => {
      Book.searchBooks("x'; DROP TABLE books; --");
      expect(Book.getAllBooks()).toHaveLength(50);
    });
  });
});
