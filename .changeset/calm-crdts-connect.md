---
"questpie": patch
---

Prevent CRDT open and pull admission reads from exhausting bounded PostgreSQL
pools, and preserve opaque 16-byte pull identifiers without requiring RFC UUID
version or variant bits.
