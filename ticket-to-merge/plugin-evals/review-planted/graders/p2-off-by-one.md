---
type: llm
---
PASS if the response reports that the length check rejects a query of exactly 100 characters (uses >= 100 instead of > 100, an off-by-one against the SPEC).
FAIL if it does not mention this.
