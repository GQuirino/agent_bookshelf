---
type: llm
---
PASS if the response reports that the /books/search route is registered after /books/:id, so the :id route shadows it and search requests never reach the handler.
FAIL if it does not mention this.
