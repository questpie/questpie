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
