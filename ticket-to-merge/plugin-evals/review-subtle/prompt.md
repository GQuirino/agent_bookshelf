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
index 95ac844..cc73175 100644
--- a/src/models/book.ts
+++ b/src/models/book.ts
@@ -22,8 +22,8 @@ export function getBookById(id: number): Book | undefined {
 export function searchBooks(query: string): Book[] {
   const pattern = `%${query}%`;
   return all(
-    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY title',
-    [pattern, pattern]
+    'SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY id',
+    [pattern, query]
   ) as unknown as Book[];
 }
 
diff --git a/src/routes/api.ts b/src/routes/api.ts
index b542c2a..8db5c77 100644
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -12,6 +12,22 @@ router.get('/books', (req: Request, res: Response) => {
   res.json(books);
 });
 
+router.get('/books/search', (req: Request, res: Response) => {
+  const raw = String(req.query.q ?? '');
+
+  if (raw.length > 100) {
+    return res.status(400).json({ error: 'Query must be less than 100 characters' });
+  }
+
+  const query = raw.trim();
+
+  if (query === '') {
+    return res.json(Book.getAllBooks());
+  }
+
+  res.json({ books: Book.searchBooks(query) });
+});
+
 router.get('/books/:id', (req: Request, res: Response) => {
   const bookId = parseInt(req.params.id as string, 10);
   const book = Book.getBookById(bookId);
```
