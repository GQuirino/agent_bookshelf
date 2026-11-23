---
max_turns: 30
timeout_seconds: 900
runs: 3
allowed_tools: [Read, Glob, Grep, Skill, Agent]
---

I just finished the ticket in SPEC.md. The workspace has my branch checked out. Please review these changes before I open the PR. Report only real problems with the evidence for each, and nothing else.

Changed paths:
src/routes/api.ts
tests/models/book-search.test.ts
tests/routes/books-search.test.ts

Diff of the non-test files:

```diff
diff --git a/src/routes/api.ts b/src/routes/api.ts
index b542c2a..87149ea 100644
--- a/src/routes/api.ts
+++ b/src/routes/api.ts
@@ -12,6 +12,25 @@ router.get('/books', (req: Request, res: Response) => {
   res.json(books);
 });
 
+const MAX_QUERY_LENGTH = 100;
+
+function parseSearchQuery(raw: unknown): { query: string } | { error: string } {
+  if (raw !== undefined && typeof raw !== 'string') return { error: 'Query must be a single string' };
+  const query = (raw ?? '').trim();
+  if (query.length > MAX_QUERY_LENGTH) return { error: 'Query must be 100 characters or fewer' };
+  return { query };
+}
+
+router.get('/books/search', (req: Request, res: Response) => {
+  const parsed = parseSearchQuery(req.query.q);
+  if ('error' in parsed) {
+    return res.status(400).json({ error: parsed.error });
+  }
+
+  const books = parsed.query ? Book.searchBooks(parsed.query) : Book.getAllBooks();
+  res.json({ books });
+});
+
 router.get('/books/:id', (req: Request, res: Response) => {
   const bookId = parseInt(req.params.id as string, 10);
   const book = Book.getBookById(bookId);
```
