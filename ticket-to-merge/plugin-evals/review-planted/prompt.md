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
index 95ac844..288cab0 100644
--- a/src/models/book.ts
+++ b/src/models/book.ts
@@ -20,10 +20,8 @@ export function getBookById(id: number): Book | undefined {
 }
 
 export function searchBooks(query: string): Book[] {
-  const pattern = `%${query}%`;
   return all(
-    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY title',
-    [pattern, pattern]
+    `SELECT * FROM books WHERE title LIKE '%${query}%' OR author LIKE '%${query}%' ORDER BY title`
   ) as unknown as Book[];
 }
 
diff --git a/src/routes/api.ts b/src/routes/api.ts
index b542c2a..e71f523 100644
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -23,6 +23,23 @@ router.get('/books/:id', (req: Request, res: Response) => {
   res.json(book);
 });
 
+router.get('/books/search', (req: Request, res: Response) => {
+  const q = req.query.q;
+
+  if (q !== undefined && typeof q !== 'string') {
+    return res.status(400).json({ error: 'Query must be a single string' });
+  }
+
+  const query = (q ?? '');
+
+  if (query.length >= 100) {
+    return res.status(400).json({ error: 'Query must be 100 characters or fewer' });
+  }
+
+  const books = query === '' ? Book.getAllBooks() : Book.searchBooks(query);
+  res.json({ books });
+});
+
 router.post('/books', (req: Request, res: Response) => {
   const { title, author, isbn, cover_url, description, published_year } = req.body;
 
```
