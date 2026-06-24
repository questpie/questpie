---
"questpie": patch
---

Add a field-level `not` where operator — a typed alias for `ne` (not-equal) on every scalar field type (text, number, boolean, date/datetime, select, relation id), where `not: null` maps to SQL `IS NOT NULL`. e.g. `{ where: { status: { not: "draft" } } }` or `{ where: { publishedAt: { not: null } } }`.
