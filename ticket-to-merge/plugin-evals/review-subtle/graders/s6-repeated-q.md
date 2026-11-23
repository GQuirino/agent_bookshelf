---
type: llm
---
PASS if the response reports that a repeated or non-string q (for example ?q=a&q=b) is coerced with String() and searched, instead of returning the 400 "Query must be a single string" required by SPEC.
FAIL if it does not mention this.
