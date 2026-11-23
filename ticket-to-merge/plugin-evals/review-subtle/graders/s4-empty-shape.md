---
type: llm
---
PASS if the response reports that an empty query returns a bare array instead of the { "books": [...] } object, so the response shape is inconsistent with SPEC.
FAIL if it does not mention this.
