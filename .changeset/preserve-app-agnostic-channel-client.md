---
"questpie": patch
---

Keep concrete generated clients assignable to app-agnostic `QuestpieClient<any>` consumers after adding typed channels, without forcing TypeScript to structurally expand the full client API during compatibility checks.
