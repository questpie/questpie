---
"@questpie/workflows": patch
---

Deny workflow routes unless the application supplies an access rule. A Better Auth role named admin no longer grants workflow access implicitly, including fallback operations omitted from a per-operation configuration. Applications that use these routes must configure `workflowsRuntime.access` (or legacy `config/workflows.ts` access) with their own authorization function. Existing operation overrides remain supported.
