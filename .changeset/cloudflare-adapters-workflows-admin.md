---
"questpie": major
"@questpie/admin": major
"@questpie/workflows": major
---

Move concrete integrated adapter implementations out of the root `questpie` entrypoint and expose them through dedicated `questpie/adapters/*` subpaths. Adapter imports such as `pgBossAdapter`, `pgNotifyAdapter`, `redisStreamsAdapter`, `SmtpAdapter`, `ConsoleAdapter`, and BullMQ should now come from their adapter entrypoints. The root entrypoint keeps framework APIs, factories, interfaces, and shared types so optional adapter dependencies are not pulled into unrelated server or Worker bundles.

Add Cloudflare-compatible runtime infrastructure for QUESTPIE apps. This includes custom Drizzle database configuration via `db: { drizzle }` and `db: { create }`, lazy loading for the default Bun SQL driver, Cloudflare Worker handlers for fetch/queue/scheduled entrypoints, Cloudflare Queues/KV/realtime adapters, runtime compatibility validation for explicit Cloudflare adapter configuration, FlyDrive S3/R2 deployment docs, and Worker-oriented docs for Hyperdrive, Queues, Cron Triggers, Durable Objects, KV, and storage.

Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes, so fresh databases can apply generated search migrations without manual `pg_trgm` or `vector` setup.

Add built-in HTTP mailer adapters for Resend and Plunk, including support for Resend-compatible API base URLs.

Improve queue runtime compatibility and type safety. Queue clients now expose jobs by both generated registry key and literal job name, so module code can publish internal jobs such as `questpie-wf-execute` without app-level alias wrappers. Cloudflare Queues now maps delayed jobs and retry delays to platform `delaySeconds`, handles permanent decode/handler errors deterministically, and respects retry limits from Cloudflare delivery attempts.

Harden durable workflows. Workflow admin/trigger routes now default to logged-in admin access and can be configured through `config/workflows.ts` with `workflowsConfig()`. Workflow execution now uses a database-backed per-instance lease with heartbeat renewal, making duplicate queue deliveries idempotent across at-least-once queue runtimes. Stale workflow execution leases are recovered by `wf-maintenance`, and retry/cancel/timeout paths clear execution locks.

Improve admin form and table responsiveness by reducing broad form subscriptions, scoping table relation expansion to visible columns, and using compact default table columns for unconfigured list views. Form sidebars now scroll more smoothly, and history sidebars include structured diffs for block, object, and array fields.

Add a public `logAuditEntry` helper exported from `@questpie/admin/server` for writing custom audit events from jobs, actions, webhooks, and other server workflows. Audit entries now support actor overrides, resource metadata, locale, resource IDs, and structured changes. Audit log titles are localized at read time using the viewer locale, including localized action/resource labels and unnamed-resource fallbacks.
