---
type: llm
---
PASS if the response reports that the over-100-characters error is sent as plain text with .send() instead of the JSON { "error": "..." } body required by SPEC.md and CLAUDE.md.
FAIL if it does not mention this.
