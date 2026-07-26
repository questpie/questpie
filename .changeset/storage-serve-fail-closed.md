---
"questpie": minor
---

Make upload-byte serving disclosure-safe and fail closed.

- Compile filtered `serve` access through the canonical collection WHERE engine
  with full principal, actor, request, locale, and context-extension authority.
- Re-check the exact current row, localization joins, relations, and soft-delete
  state before reading storage.
- Return one not-found outcome for denied, absent, deleted, or invalid private
  signed-URL requests so file keys cannot be used as existence probes.
