---
"@questpie/admin": patch
---

Improve admin form sidebar responsiveness by reducing unnecessary dialog/sheet work during relation-cell interactions.

- Keep heavy dialog/sheet components unmounted until they are opened.
- Reuse already-fetched collection schema across validation and server action hooks to avoid duplicate observers and schema processing.
- Reduce lock-refresh event listener overhead during form editing.
- Add optional non-animated/non-overlay sheet rendering for nested sidebars.
