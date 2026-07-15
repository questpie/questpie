---
"questpie": patch
---

Always destroy the loaded app after migration CLI commands so production
deployment init containers exit even when configured adapters keep event-loop
resources open.
