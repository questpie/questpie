---
"@questpie/admin": patch
"questpie": patch
"@questpie/workflows": minor
---

Add `@questpie/workflows` — durable workflow engine for QUESTPIE.

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
