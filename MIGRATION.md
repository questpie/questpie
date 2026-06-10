# QuestPie v3 Migration Guide

## New Options

### Per-collection/global Postgres schema

Collections and globals now accept an optional `schema` option that places their
tables under a named Postgres schema instead of `public`. Unset (default) is
backward-compatible — existing apps need no changes.

```ts
import { collection, global } from "#questpie/factories";

export const user = collection("user")
	.fields(({ f }) => ({ email: f.text(255).required() }))
	.options({ schema: "auth" });

export const siteSettings = global("site-settings")
	.fields(({ f }) => ({ title: f.text(255) }))
	.options({ schema: "web" });
```

**What it does:**

- Generates tables via `pgSchema("auth").table(...)` so DDL is qualified
  (`CREATE TABLE "auth"."user" (...)`).
- Applies to all four variants per collection: main, i18n, versions, i18n
  versions. Globals get the same treatment.
- `migrate:generate` prepends `CREATE SCHEMA IF NOT EXISTS "<name>";` before the
  first table in that schema and appends `DROP SCHEMA IF EXISTS "<name>" CASCADE;`
  to the down migration for schemas that only contain tables from this migration.
- Cross-schema relations render as `REFERENCES "auth"."user"("id")` when the FK
  target is a table under a different schema — works for `.drizzle(c => c.references(...))`
  escape-hatch columns and for the framework's i18n-parent FKs on localized collections.

**Typical use case:** running multiple QUESTPIE apps against one Postgres
instance, partitioning tables by schema (`auth.*`, `web.*`, `brain.*`) to keep
migrations, dumps, and dashboards cleanly isolated.

**Note:** Existing admin-module auth tables (`user`, `session`, `account`) stay
on `public` — opt them into a schema manually if you want isolation.

## Breaking Changes

### `app.api` namespace removed (QUE-262)

The `app.api.collections.*` and `app.api.globals.*` accessors have been removed.
Use the top-level accessors directly:

```diff
- const posts = await app.api.collections.posts.find({ limit: 10 });
+ const posts = await app.collections.posts.find({ limit: 10 });

- const settings = await app.api.globals.settings.get();
+ const settings = await app.globals.settings.get();
```

**What changed:** The `app.api` proxy was an unnecessary indirection layer. All
collection and global operations are now available directly on the `app` instance
via `app.collections` and `app.globals`.

**Migration:** Find-and-replace `app.api.collections.` with `app.collections.`
and `app.api.globals.` with `app.globals.` across your codebase.

### 3.6.0 — Access honesty for uploads and introspection (SECURITY)

Deny-all now means deny-all. Two implicit grants were removed and replaced
with explicit, declarative access kinds (`serve`, `introspect`).

#### Anonymous listing of public-visibility upload collections no longer works by default

Previously, a hard-coded short-circuit granted public READ access to any
upload collection with `visibility: "public"` (the default) — ABOVE app-level
`defaultAccess`. A deny-all app still exposed `GET /api/assets` to anonymous
enumeration. That short-circuit is gone: upload-row reads resolve through the
normal chain (collection `.access()` → `defaultAccess` → session required).

What still works without any change:

- `GET /:collection/files/:key` — public-visibility file BYTES are still
  servable by key (serving is now its own `serve` access kind:
  `serve` → explicit collection `read` → `defaultAccess.serve` → visibility).
- Populated `f.upload()` fields — upload relations populate through the
  PARENT row's read decision, so e.g. a publicly readable gallery still shows
  its assets (including `url`) to anonymous readers. Field-level read rules on
  the upload collection still apply. Block prefetch declared-`with` expansion
  of upload fields inherits the same way. (Custom block prefetch FUNCTIONS run
  with the caller's access — fetch editor-curated asset ids with an explicit
  `{ accessMode: "system" }` context if anonymous pages need them.)
- Explicit `read: false` on an upload collection still blocks serving
  (back-compat: serve falls back to an explicitly defined collection `read`).

To restore the old world-listable behavior, say it explicitly:

```ts
collection("assets")
	.upload({ visibility: "public" })
	.access({ read: true });
```

#### Schema/meta introspection is gated through the access system

`GET /api/<collection>/{schema,meta}` (and the globals equivalents) were
anonymous-readable with no off-switch — deny-all apps leaked their entire
data-model shape. They are now visible iff at least one CRUD operation is
allowed for the current user (`401` anonymous / `403` authenticated
otherwise). A public contact form (`create: true`) keeps its validation schema
readable; a deny-all app exposes nothing.

Override per collection/global or app-wide with the new `introspect` kind:

```ts
collection("catalog").access({ introspect: true });   // shape public, data closed
collection("audit_log").access({
	read: ({ session }) => (session?.user as any)?.role === "admin",
	introspect: ({ session }) => (session?.user as any)?.role === "admin",
});
```

The admin UI is unaffected — it fetches schema/meta only with an
authenticated session, and authenticated admin users have allowed operations.
If you proxied these routes with your own auth middleware as a workaround, you
can delete it.
