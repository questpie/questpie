---
"questpie": patch
---

Persist upload cleanup in the hard-delete transaction so storage outages after commit remain retryable. Immediate cleanup remains in place; the recurring storage cleanup job retries failures and preserves keys still referenced by any upload collection.
