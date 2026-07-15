---
"questpie": patch
"create-questpie": patch
---

Always tear down the application after `questpie push` so adapter handles cannot keep deployment init containers running after the schema is applied. Keep the development-only warning visible with `--force`, and make generated project guidance explicit that production deployments must use committed migrations.
