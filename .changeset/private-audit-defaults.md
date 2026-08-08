---
"@questpie/admin": minor
"questpie": minor
---

Harden logging and audit defaults and add typed audit delivery, retention, legal-hold, workload identity, and append-only sink primitives.

After upgrading, run `questpie generate`, grant an explicit audit read policy to applications that expose audit history, review field classifications, choose best-effort or required delivery, and configure retention and an idempotent external sink where needed. Additional `logger.redact` paths now extend mandatory recursive credential and error redaction; validate any correlation IDs supplied through a trusted host `AdapterContext`.
