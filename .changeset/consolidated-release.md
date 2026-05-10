---
"questpie": minor
"@questpie/admin": minor
"@questpie/workflows": minor
---

Move concrete adapter implementations to dedicated `questpie/adapters/*` subpaths so optional adapter dependencies are not pulled into unrelated bundles.

Add Cloudflare-compatible runtime infrastructure: custom Drizzle database configuration, lazy Bun SQL driver loading, Cloudflare Worker handlers, Queues/KV/realtime adapters, runtime compatibility validation, and Worker-oriented deployment docs.

Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes.

Add built-in HTTP mailer adapters for Resend and Plunk with Resend-compatible API base URLs.

Improve queue runtime compatibility and type safety. Queue clients expose jobs by registry key and literal name. Cloudflare Queues maps delayed jobs to platform `delaySeconds` and handles permanent errors deterministically.

Harden durable workflows with database-backed per-instance lease and heartbeat renewal. Workflow admin/trigger routes default to logged-in admin access via `workflowsConfig()`. Stale execution leases are recovered by `wf-maintenance`.

Improve admin form and table responsiveness. Reduce broad form subscriptions, scope table relation expansion to visible columns, and use compact default table columns. History sidebars include structured diffs for block, object, and array fields.

Add `logAuditEntry` helper from `@questpie/admin/server` for custom audit events with actor overrides, resource metadata, locale, and structured changes.

Fix admin server actions against the current runtime app shape. Action routes now resolve collection definitions through `app.getCollections()` and CRUD APIs through `app.collections`.

Strip undefined values from admin config response before SuperJSON serialization.
