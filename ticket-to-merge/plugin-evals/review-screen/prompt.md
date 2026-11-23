---
max_turns: 30
timeout_seconds: 900
runs: 3
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

I just finished the ticket in SPEC.md. The workspace has my branch checked out. Please review these changes before I open the PR. Report only real problems with the evidence for each, and nothing else.

Changed paths:
src/models/book.ts
src/routes/api.ts
tests/models/book-search.test.ts
tests/routes/books-search.test.ts

Diff of the non-test files:

```diff
diff --git a/src/models/book.ts b/src/models/book.ts
index 95ac844..007d762 100644
--- a/src/models/book.ts
+++ b/src/models/book.ts
@@ -22,8 +22,8 @@ export function getBookById(id: number): Book | undefined {
 export function searchBooks(query: string): Book[] {
   const pattern = `%${query}%`;
   return all(
-    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY title',
-    [pattern, pattern]
+    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? OR description LIKE ? ORDER BY title',
+    [pattern, pattern, pattern]
   ) as unknown as Book[];
 }
 
diff --git a/src/routes/api.ts b/src/routes/api.ts
index b542c2a..d573f8b 100644
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -1,5 +1,5 @@
 import { Router, Request, Response } from 'express';
-import * as Book from '../models/book.js';
+import * as Book from '../models/book';
 import * as User from '../models/user.js';
 import * as Review from '../models/review.js';
 import * as Shelf from '../models/shelf.js';
@@ -12,6 +12,26 @@ router.get('/books', (req: Request, res: Response) => {
   res.json(books);
 });
 
+router.all('/books/search', (req: Request, res: Response) => {
+  const q = req.query.q;
+
+  if (q !== undefined && typeof q !== 'string') {
+    return res.status(400).json({ error: 'Query must be a single string' });
+  }
+
+  const query = (q ?? '').trim();
+
+  if (query.length > 100) {
+    return res.status(400).send('Query must be 100 characters or fewer');
+  }
+
+  const books = query === '' ? Book.getAllBooks() : Book.searchBooks(query);
+  if (books.length === 0) {
+    return res.status(404).json({ error: 'No books found' });
+  }
+  res.json({ books, count: books.length });
+});
+
 router.get('/books/:id', (req: Request, res: Response) => {
   const bookId = parseInt(req.params.id as string, 10);
   const book = Book.getBookById(bookId);
```
