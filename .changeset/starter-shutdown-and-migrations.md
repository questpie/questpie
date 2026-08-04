---
"create-questpie": minor
---

Fix two things every scaffolded project inherited.

**Shutdown.** Only the TanStack Start template released what the app opened.
Hono, Elysia and Next shipped no hook at all, so service `dispose` callbacks
never fired, `destroyApp()` never ran, and every buffered observability span was
lost on each deploy. Each template now gets the hook its own server offers.
Elysia holds its server so it drains first. Hono and Next have no handle, so
they release resources without draining, and say so.

**Migrations.** All four templates set `cli.migrations.directory`, which is the
only place `migrate:create` writes when present. Codegen only ever scans the
server root, so `questpie migrate` answered "No migrations found" on a fresh
project, and the search adapter's index migrations were skipped with it. The key
is gone, so both commands resolve the same directory.
