---
type: llm
---
PASS if the response reports that the 100-character limit is checked on the untrimmed input, before trimming (SPEC says the trimmed query is measured) in src/routes/api.ts.
FAIL if it does not mention this.
