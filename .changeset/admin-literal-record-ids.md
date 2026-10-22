---
"@questpie/admin": patch
---

Encode literal record IDs in admin workflow transitions, audit-history reads and form action endpoints. IDs containing percent signs, spaces or slashes now reach the same record after HTTP parameter decoding. Continue passing literal IDs rather than pre-encoding them.
