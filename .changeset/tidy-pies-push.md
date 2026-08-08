---
"questpie": patch
---

Apply every `questpie push` schema statement in one PostgreSQL transaction so a
late DDL failure cannot leave a partially updated development database.
