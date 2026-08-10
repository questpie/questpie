---
"@questpie/admin": minor
"questpie": patch
---

Add typed audit persistence, retention, field-classification, workload identity, and canonical after-commit sink policies. Required persistence shares the protected mutation transaction; best-effort persistence uses a fresh post-commit transaction; external sink delivery is explicitly non-durable and post-commit only.

Credential-like fields are omitted from new diffs unless explicitly classified. The 3.x audit collection keeps its public-read default for compatibility; applications should opt into a restricted merged access policy before a future major release changes that default. Regenerate factories and migrate `config/audit.ts` to the new `persistence` and `export` shape.
