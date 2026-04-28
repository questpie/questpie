---
"@questpie/admin": patch
---

fix(admin): server action handling

- Add missing `"server"` handler type to form view's action execution (server actions like redirect were silently ignored)
- Handle `external: true` on redirect actions across all execution paths (form view, action button, row actions, form submit)
