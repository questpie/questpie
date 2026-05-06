# @questpie/workflows

## 3.3.0

### Minor Changes

- [`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Move concrete integrated adapter implementations out of the root `questpie` entrypoint and expose them through dedicated `questpie/adapters/*` subpaths. Adapter imports such as `pgBossAdapter`, `pgNotifyAdapter`, `redisStreamsAdapter`, `SmtpAdapter`, `ConsoleAdapter`, and BullMQ should now come from their adapter entrypoints. The root entrypoint keeps framework APIs, factories, interfaces, and shared types so optional adapter dependencies are not pulled into unrelated server or Worker bundles.

  Add Cloudflare-compatible runtime infrastructure for QUESTPIE apps. This includes custom Drizzle database configuration via `db: { drizzle }` and `db: { create }`, lazy loading for the default Bun SQL driver, Cloudflare Worker handlers for fetch/queue/scheduled entrypoints, Cloudflare Queues/KV/realtime adapters, runtime compatibility validation for explicit Cloudflare adapter configuration, FlyDrive S3/R2 deployment docs, and Worker-oriented docs for Hyperdrive, Queues, Cron Triggers, Durable Objects, KV, and storage.

  Emit required PostgreSQL search extensions in generated migrations before extension-backed indexes, so fresh databases can apply generated search migrations without manual `pg_trgm` or `vector` setup.

  Add built-in HTTP mailer adapters for Resend and Plunk, including support for Resend-compatible API base URLs.

  Improve queue runtime compatibility and type safety. Queue clients now expose jobs by both generated registry key and literal job name, so module code can publish internal jobs such as `questpie-wf-execute` without app-level alias wrappers. Cloudflare Queues now maps delayed jobs and retry delays to platform `delaySeconds`, handles permanent decode/handler errors deterministically, and respects retry limits from Cloudflare delivery attempts.

  Harden durable workflows. Workflow admin/trigger routes now default to logged-in admin access and can be configured through `config/workflows.ts` with `workflowsConfig()`. Workflow execution now uses a database-backed per-instance lease with heartbeat renewal, making duplicate queue deliveries idempotent across at-least-once queue runtimes. Stale workflow execution leases are recovered by `wf-maintenance`, and retry/cancel/timeout paths clear execution locks.

  Improve admin form and table responsiveness by reducing broad form subscriptions, scoping table relation expansion to visible columns, and using compact default table columns for unconfigured list views. Form sidebars now scroll more smoothly, and history sidebars include structured diffs for block, object, and array fields.

  Add a public `logAuditEntry` helper exported from `@questpie/admin/server` for writing custom audit events from jobs, actions, webhooks, and other server workflows. Audit entries now support actor overrides, resource metadata, locale, resource IDs, and structured changes. Audit log titles are localized at read time using the viewer locale, including localized action/resource labels and unnamed-resource fallbacks.

### Patch Changes

- Updated dependencies [[`d0c97e8`](https://github.com/questpie/questpie/commit/d0c97e81c48acc107d5186c1c2407728a9aa0434)]:
  - questpie@3.3.0
  - @questpie/admin@3.3.0

## 3.2.7

### Patch Changes

- Updated dependencies [[`724bf2f`](https://github.com/questpie/questpie/commit/724bf2f27cdb16a6474d3a41b5ff403701ba3577)]:
  - @questpie/admin@3.2.7
  - questpie@3.2.7

## 3.2.6

### Patch Changes

- Updated dependencies [[`40768c4`](https://github.com/questpie/questpie/commit/40768c4dc634dce6fa8c71ce1f23e0c7080ab1a9)]:
  - questpie@3.2.6
  - @questpie/admin@3.2.6

## 3.2.5

### Patch Changes

- Updated dependencies [[`6e8e51a`](https://github.com/questpie/questpie/commit/6e8e51ab609cb76ff6bff4025af0bc186d3dc60d)]:
  - @questpie/admin@3.2.5
  - questpie@3.2.5

## 3.2.4

### Patch Changes

- Updated dependencies [[`ebee6b1`](https://github.com/questpie/questpie/commit/ebee6b161d46d2d6955d5c1839864bbc8d67cd69), [`7bd0604`](https://github.com/questpie/questpie/commit/7bd0604b4b0290f2b5d67c6fd4d3ab57a923aa85)]:
  - questpie@3.2.4
  - @questpie/admin@3.2.4

## 3.2.3

### Patch Changes

- Updated dependencies [[`7607322`](https://github.com/questpie/questpie/commit/7607322cf6bbc0d933dd2c593edd3de618827b06)]:
  - questpie@3.2.3
  - @questpie/admin@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [[`91d2a67`](https://github.com/questpie/questpie/commit/91d2a67a565593256032183dd1d9d960979376e8)]:
  - @questpie/admin@3.2.2
  - questpie@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [[`1174029`](https://github.com/questpie/questpie/commit/11740292c29c444adcdece8aa152f4c1eff2bdab), [`f2b8496`](https://github.com/questpie/questpie/commit/f2b849642ffa2f9b37f429fac3a30377a9fd7851)]:
  - @questpie/admin@3.2.1
  - questpie@3.2.1

## 3.2.0

### Minor Changes

- [#28](https://github.com/questpie/questpie/pull/28) [`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add `@questpie/workflows` — durable workflow engine for QUESTPIE.

  **Core Engine**

  - `workflow()` identity factory for type-safe workflow definitions
  - Replay-based execution engine with step caching and non-determinism detection
  - Step primitives: `step.run()`, `step.sleep()`, `step.sleepUntil()`, `step.waitForEvent()`, `step.invoke()`, `step.sendEvent()`
  - Duration parser (s/m/h/d/w), 5 error types, structured workflow logger

  **System Collections**

  - `wf_instance` — workflow instance tracking with status, input/output, timeout
  - `wf_step` — step execution records with replay memoization and match_hash index
  - `wf_event` — event persistence for JSONB-containment matching
  - `wf_log` — structured log entries queryable in admin UI

  **Events & Compensation**

  - Event matching engine with JSONB containment semantics (forward + retroactive)
  - Saga-pattern compensation with reverse LIFO order
  - Child workflow invocation with cascading timeouts
  - `onFailure` handler with `completedSteps` inspection

  **Cron Triggers & Retention**

  - `cron` field on workflow definitions for recurring execution
  - `cronOverlap` policy: `skip` (default), `allow`, `cancel-previous`
  - `RetentionPolicy` for automatic cleanup of old instances/steps/events/logs
  - `match_hash` optimization for O(1) event matching via FNV-1a indexed column

  **Workflow Client**

  - `trigger()`, `cancel()`, `getInstance()`, `getHistory()`, `sendEvent()`
  - `cancelAll()`, `retryAll()` batch operations
  - Idempotency key support, delayed start, parent-child relationships
  - Typed collection/global `transitionStage()` client calls now accept `scheduledAt`

  **Admin UI**

  - Workflow list page with status filters, auto-refresh, trigger dialog
  - Workflow detail page with step timeline, action buttons, log viewer
  - Dashboard stats widget showing active/completed/failed counts
  - Sidebar contribution for navigation

  **Docs & Type Safety**

  - Full durable workflow documentation with typed route, event, cron, admin, and client examples
  - Documented durable workflow instance and step lifecycle transitions with Mermaid diagrams
  - Expanded versioning workflow transition references across CRUD, global, hooks, and HTTP route docs
  - Mermaid architecture diagrams for workflow and docs architecture pages
  - Runtime workflow helpers and admin client routes are strongly typed without unsafe casts

  **Integration**

  - `workflowsPlugin()` codegen plugin for file-convention discovery
  - `workflowsModule` server module with collections, jobs, service, functions
  - `workflowsClientModule` for admin UI pages and widgets
  - Service at `ctx.workflows` via `namespace(null)`
  - `@questpie/admin/client` now exports `page()` and `PageDefinition` for module-provided admin pages

### Patch Changes

- Updated dependencies [[`652f6b7`](https://github.com/questpie/questpie/commit/652f6b79e9a70004bc7318464e4ca1d7a4a5bead)]:
  - @questpie/admin@3.2.0
  - questpie@3.2.0
