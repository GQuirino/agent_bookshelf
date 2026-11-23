---
type: llm
---
PASS if the response reports that a query with no matching books returns 404 with an error, instead of 200 with { "books": [] } as SPEC requires.
FAIL if it does not mention this.
