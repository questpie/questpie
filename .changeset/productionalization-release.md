---
"questpie": minor
"@questpie/admin": minor
"@questpie/observability": minor
"@questpie/openapi": minor
"@questpie/workflows": minor
---

Productionalization release: legacy removal, real bug fixes, observability, and
CI gates that keep the cleanup from rotting.

**Released as a minor despite the removals below.** There are no published
consumers yet, so the removals are folded in rather than held for a major. They
are still listed here in full, because a changelog that hides a removal is worse
than a version number that surprises someone.

## Removed

- `createAdapterRoutes` and the legacy route closure factories. Routes are
  defined with the `route()` builder; the framework no longer ships two ways to
  mount a handler.
- `client.crdt` — use `createCrdtClient(client)` from `questpie/crdt`.
- `AdminTypeRegistry` and the four `Registered*` types derived from it. The
  interface was never exported, so no application could reach it to augment;
  every derived type resolved to a constant and every consumer conditional was
  a dead branch.
- The last `@deprecated` API inside `questpie` and `@questpie/admin`
  (`formatFieldLabel`, `useBlockDefinition`, six re-export shims). Internal
  imports of the framework's own deprecated API are now **zero**, down from 166.

## Fixed

- `.validation()` silently narrowed what a collection accepted. It built its own
  schema without the id, timestamp and soft-delete columns the constructor adds,
  and because both paths end in a stripping Zod object the loss was invisible:
  calling it removed the ability to pass a custom id on create and turned
  restore's `deletedAt` write into a no-op.
- Collection access rules now **fail closed** on a rule shape the type system
  does not admit. Both evaluators previously ended in an unconditional allow —
  on the enforcement path.
- A global access rule returning a non-boolean now denies instead of allowing.
- `f.upload().multiple()` returned a field with no state, losing its type,
  metadata and target collection.
- `crdt`, `observability` and `executor` config leaked into `app.state` instead
  of being consumed by the runtime.
- Observability never flushed on shutdown — the last batch of spans, metrics and
  logs was lost on every clean exit.
- `observability` was silently dropped from the runtime config entirely.
- `questpie dev` stripped module-contributed codegen on every file save, and
  `questpie generate` silently repaired it — the worst possible debugging signal.
- The `locale` and `localeFallback` options were declared and then ignored.
- A field now publishes the same validation on a global as on a collection.
  Globals had no field-schema overlay, so `f.email()` shipped as a bare string.
- Custom dashboard widgets rendered "component not found".
- The workflows sidebar section and dashboard widgets were missing.
- `{{ param }}` with spaces now interpolates in server messages.
- `generateModule` is now actually exported from `questpie/codegen`.
- OpenAPI schema component names match the rest of the framework.

## Added

- **Observability**: tracing and metrics through a framework seam plus the new
  `@questpie/observability` package — database query and transaction spans on
  every `db` variant, metrics and logs signals, and inbound trace-context
  continuation.
- **Per-field component slots**: `.admin({ components: { field, cell } })` lets
  one field instance point at its own components without registering a whole new
  field type.
- `/health` performs real subsystem checks; `/health/live` is added for liveness
  separate from readiness.

## Performance

- Field builder chains typecheck about **twice as fast** — field methods now
  live on the class instead of a 27-key mapped type.
- The client no longer bundles `qs`: **−90 KB** from the browser bundle.

## Internal

CI ratchets that make the cleanup durable rather than a one-off: `dead-modules`,
`lint-census`, `deprecated-imports`, `clone-census`, alongside the existing
any-census, type-budget and size budgets. Each fails on an increase, so the
counts above can only go down.
