---
"questpie": patch
---

Read registered collection and global definitions when discovering relation locks and retained references. Avoid generating every collection's CRUD API for metadata-only scans while preserving source-table locks, target key-share locks and purge validation.
