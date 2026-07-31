---
name: questpie-core-multi-tenancy
description:
  QUESTPIE multi-tenant scope context resolver header-based tenant isolation appConfig context ScopeProvider ScopePicker request-scoped derived context data filtering access control workspace organization property
  - questpie-core
  - questpie-core-rules
  - questpie-core-business-logic
---

# QUESTPIE Multi-Tenancy

QUESTPIE supports multi-tenant applications through a **scope-based** architecture. A "scope" can represent anything: organizations, workspaces, properties, cities, brands, any entity that partitions data.

The whole pattern is one pipeline: **the client injects an HTTP header carrying a scope ID, the `appConfig({ context })` resolver reads it and derives typed context once per request, and access rules filter data with it.**

```text
Client                          Server
──────                          ──────
ScopePicker → ScopeProvider     appConfig({ context }) resolver
  → useScopedFetch                runs ONCE per HTTP request, reads the header,
  injects header                  result flat-merges into every access rule,
  x-selected-workspace: ws_123    hook, route handler, and getContext()
```

## Contents

- [Step 1: Define the Scope Collection](#step-1-define-the-scope-collection)
- [Step 2: Derive Context in `appConfig({ context })`](#step-2-derive-context-in-appconfig-context-)
- [Step 3: Filter Data with Access Rules](#step-3-filter-data-with-access-rules)
- [Step 4: Read Derived Context Anywhere](#step-4-read-derived-context-anywhere)
- [Step 5: Set Up the Admin UI](#step-5-set-up-the-admin-ui)
- [Common Mistakes](#common-mistakes)
- [Reference Example](#reference-example)

## Step 1: Define the Scope Collection

Create a collection that represents your tenant entity:

```ts
// collections/workspaces.ts
import { collection } from "#questpie/factories";

export default collection("workspaces").fields(({ f }) => ({
	name: f.text().label("Name").required(),
	slug: f.text().label("Slug").inputOptional(),
	owner: f.relation("user").label("Owner"),
}));
```

Other collections reference the scope via a relation:

```ts
// collections/projects.ts
import { collection } from "#questpie/factories";

export default collection("projects").fields(({ f }) => ({
	title: f.text().label("Title").required(),
	workspace: f.relation("workspaces").label("Workspace").required(),
}));
```

## Step 2: Derive Context in `appConfig({ context })`

The context resolver lives in `config/app.ts`. It runs **once per HTTP request** at the single derivation point (`app.createContext()`), and the returned object travels with the request, flat-merged into every access rule ctx, hook ctx, route handler args, field access ctx, and `getContext()`.

```ts
// config/app.ts
import { appConfig } from "questpie/app";

export default appConfig({
	context: async ({ request, session, collections }) => {
		const workspaceId = request.headers.get("x-selected-workspace");

		// Validate membership with the typed collections API (system mode)
		if (workspaceId && session?.user) {
			const member = await collections.workspace_members.findOne({
				where: { workspace: workspaceId, user: session.user.id },
			});
			if (!member) throw new Error("No access to this workspace");
		}

		return { workspaceId: workspaceId || null };
	},
});
```

### Context Resolver Parameters

The resolver receives the base request params plus the full system-mode service surface (typed via codegen, `Questpie.ContextResolverContext`):

| Parameter     | Type                        | Description                                     |
| ------------- | --------------------------- | ----------------------------------------------- |
| `request`     | `Request`                   | The incoming HTTP request (Web API)             |
| `session`     | `{ user, session } \| null` | Resolved auth session (null if unauthenticated) |
| `db`          | `Database`                  | Raw database client                             |
| `collections` | `CollectionsAPI`            | Typed collections (system mode, hooks/i18n run) |
| `globals`     | `GlobalsAPI`                | Typed globals                                   |
| `logger`      | `LoggerService`             | App logger                                      |
| `kv`          | `KVService`                 | Key-value store                                 |
| `queue`       | `QueueClient`               | Queue client                                    |
| `t`           | `(key, params?) => string`  | Translations                                    |
| `services`    |                             | User services from `services/`                  |

### Lifecycle Rules

- **Once per HTTP request.** Admin and REST calls alike. Nested CRUD, relation hydration, and hooks within the same request reuse the same result, never re-run the resolver.
- **No request → no resolver.** Jobs, workflows, seeds, and `createContext()` without a `request` skip it, so extension types are `Partial<…>` (see [narrowing](#high-not-narrowing-optional-extensions)).
- **Collections inside the resolver run system mode**, the resolver IS trusted derivation. If you explicitly pass `accessMode: "user"` to a CRUD call inside the resolver, rules evaluated from there see no extensions (they don't exist yet), rules must already tolerate absence.
- **Throwing fails the request** before any rule or handler runs. Throw `ApiError.*` for structured error responses (the tenant-validation case).
- **Reserved keys are dropped and warn in dev.** Returning `session`, `db`,
  `locale`, `accessMode`, `collections`, `channels`, `services`, or another
  framework/service namespace key logs a warning in development and the
  extension value is not projected. Framework keys cannot be shadowed.

## Step 3: Filter Data with Access Rules

The resolved context arrives **flat** on the rule ctx, destructure it directly (no `ctx` wrapper). Extensions are optional types: narrow before use.

```ts
// collections/projects.ts
import { collection } from "#questpie/factories";

export default collection("projects")
	.fields(({ f }) => ({
		title: f.text().label("Title").required(),
		workspace: f.relation("workspaces").label("Workspace").required(),
	}))
	.access({
		// Only allow reads when a workspace is selected
		read: ({ workspaceId }) => {
			if (!workspaceId) return false;
			return { workspace: workspaceId };
		},
		create: ({ workspaceId }) => !!workspaceId,
		update: ({ workspaceId }) => {
			if (!workspaceId) return false;
			return { workspace: workspaceId };
		},
		delete: ({ workspaceId }) => {
			if (!workspaceId) return false;
			return { workspace: workspaceId };
		},
	})
	.hooks({
		// Auto-assign workspace on create, extensions are flat on hook ctx too
		beforeChange: async ({ data, operation, workspaceId }) => {
			if (operation === "create" && workspaceId) {
				data.workspace = workspaceId;
			}
		},
	});
```

### Access Rule Return Values

| Return             | Meaning                                  |
| ------------------ | ---------------------------------------- |
| `true`             | Allow all records                        |
| `false`            | Deny all records                         |
| `{ field: value }` | Where-clause filter (row-level security) |

## Step 4: Read Derived Context Anywhere

Inside any code running within the request (hooks, services, utils), `getContext()` exposes the resolved extensions flat and typed:

```ts
import { getContext } from "questpie";
import type { App } from "#questpie";

async function currentWorkspaceOrThrow() {
	const { workspaceId } = getContext<App>(); // typed: string | null | undefined
	if (!workspaceId) throw new Error("No workspace selected");
	return workspaceId;
}
```

## Step 5: Set Up the Admin UI

### ScopeProvider

Wrap your admin with `ScopeProvider` to enable scope selection. It manages the selected scope ID and persists it to localStorage. Place it in the admin layout route, around `AdminLayoutProvider`.

```tsx
// routes/admin.tsx
import { Outlet } from "@tanstack/react-router";
import {
	AdminLayoutProvider,
	ScopePicker,
	ScopeProvider,
} from "@questpie/admin/client";

function AdminLayout() {
	return (
		<ScopeProvider
			headerName="x-selected-workspace"
			storageKey="admin-selected-workspace"
		>
			<AdminLayoutProvider
				admin={admin}
				client={client}
				LinkComponent={AdminLink}
				basePath="/admin"
			>
				<Outlet />
			</AdminLayoutProvider>
		</ScopeProvider>
	);
}
```

#### ScopeProvider Props

| Prop           | Type             | Required | Description                       |
| -------------- | ---------------- | -------- | --------------------------------- |
| `headerName`   | `string`         | Yes      | HTTP header name for the scope ID |
| `storageKey`   | `string`         | No       | localStorage key for persistence  |
| `defaultScope` | `string \| null` | No       | Default scope if none stored      |

### ScopePicker

A dropdown for selecting the current scope. Render it into the sidebar through the `afterBrand` slot, passed via `sidebarProps` (a `Partial<AdminSidebarProps>`):

```tsx
<AdminLayoutProvider
	admin={admin}
	client={client}
	LinkComponent={AdminLink}
	basePath="/admin"
	sidebarProps={{
		afterBrand: (
			<div className="border-b px-3 py-2">
				<ScopePicker
					collection="workspaces"
					labelField="name"
					placeholder="Select workspace..."
					allowClear
					clearText="All Workspaces"
					compact
				/>
			</div>
		),
	}}
>
	<Outlet />
</AdminLayoutProvider>
```

#### ScopePicker Props

| Prop          | Type                           | Default       | Description                                |
| ------------- | ------------------------------ | ------------- | ------------------------------------------ |
| `collection`  | `string`                       | none          | Collection to fetch options from           |
| `labelField`  | `string`                       | `"name"`      | Field to display as label                  |
| `valueField`  | `string`                       | `"id"`        | Field to use as value                      |
| `options`     | `ScopeOption[]`                | none          | Static options (alternative to collection) |
| `loadOptions` | `() => Promise<ScopeOption[]>` | none          | Async options loader                       |
| `placeholder` | `string`                       | `"Select..."` | Placeholder text                           |
| `allowClear`  | `boolean`                      | `false`       | Show "All" option to clear scope           |
| `clearText`   | `string`                       | `"All"`       | Label for the clear option                 |
| `compact`     | `boolean`                      | `false`       | Render smaller (no label)                  |

### Three Data Sources

```tsx
// 1. From a collection
<ScopePicker collection="workspaces" labelField="name" />

// 2. Static options
<ScopePicker options={[
  { value: "ws_1", label: "Workspace 1" },
  { value: "ws_2", label: "Workspace 2" },
]} />

// 3. Async loader
<ScopePicker loadOptions={async () => {
  const res = await fetch("/api/my-workspaces");
  return res.json();
}} />
```

### useScopedFetch

When you need to create the API client, use `useScopedFetch()` to automatically inject the scope header into all requests:

```tsx
import { useScopedFetch } from "@questpie/admin/client";

function AdminContent() {
	const scopedFetch = useScopedFetch();

	const client = useMemo(
		() => createClient<typeof app>({ baseURL: "/api", fetch: scopedFetch }),
		[scopedFetch],
	);

	return <AdminProvider client={client} />;
}
```

### createScopedFetch (Non-React)

For use outside React components:

```ts
import { createScopedFetch } from "@questpie/admin/client";

let currentScopeId: string | null = null;

const scopedFetch = createScopedFetch(
	"x-selected-workspace",
	() => currentScopeId,
);
```

## Common Mistakes

### HIGH: Wrapping context access in `ctx`

Extensions arrive **flat** on rule and hook contexts. There is no `ctx` sub-object:

```ts
// WRONG, there is no ctx wrapper
read: ({ ctx }) => ({ workspace: ctx.workspaceId });

// RIGHT, destructure flat
read: ({ workspaceId }) => (workspaceId ? { workspace: workspaceId } : false);
```

### HIGH: Not filtering in access rules

The context resolver only **derives** the scope. You must still enforce isolation in `.access()` rules or `.hooks()`. Without access rules, all data is returned regardless of scope.

### HIGH: Not narrowing optional extensions

Extensions are typed `Partial<…>` because non-HTTP contexts (jobs, seeds, scripts) never run the resolver. Always handle absence:

```ts
read: ({ workspaceId }) => {
	if (!workspaceId) return false; // job/script/no-header case
	return { workspace: workspaceId };
};
```

### HIGH: Forgetting cross-scope relation leakage

Filtering the scoped collection is **not enough**. A `find` that hydrates relations (`with: { ... }`) re-reads each related collection, and that nested read only applies the **target** collection's own `.access().read` rule. If the relation target has no scoping rule, hydrating it surfaces other tenants' rows even though the parent query was scoped:

```ts
// projects is scoped, but a project's `customer` relation is NOT
await app.collections.projects.find({
	with: { customer: true }, // hydrates ANY tenant's customer row
});
```

Every collection reachable as a relation target needs its own scoped `.access()`, scope the relation collections, not just the entry collection:

```ts
// collections/customers.ts
export default collection("customers")
	.fields(({ f }) => ({
		name: f.text().required(),
		workspace: f.relation("workspaces").required(),
	}))
	.access({
		read: ({ workspaceId }) =>
			workspaceId ? { workspace: workspaceId } : false,
	});
```

### HIGH: Assuming the user/auth collection is scoped

The scope resolver and access rules only scope what **you** scope. The built-in `user` collection (and the `account` / `session` / `apikey` auth tables) ships with no scope field and no tenant `.access()` rule, it is shared globally across every tenant. A `find` on `user`, or a relation pointing at `user`, returns the whole user table regardless of the selected scope. If users belong to tenants, model that membership explicitly (e.g. a `workspace_members` join collection) and scope it yourself; do not rely on `user` being partitioned.

### MEDIUM: Hardcoding header names

Use the same header name in `ScopeProvider.headerName` and the resolver. A mismatch means the server never sees the scope ID.

```ts
// These MUST match:
// Client:
<ScopeProvider headerName="x-selected-workspace" />

// Server (config/app.ts):
request.headers.get("x-selected-workspace")
```

### MEDIUM: Not validating scope access

In production, validate that the authenticated user actually belongs to the selected scope, otherwise any user can access any scope by sending the header manually. Throw from the resolver to fail the request before any handler runs (see Step 2).

### MEDIUM: Using `extendContext` for tenant scope

`AdapterConfig.extendContext` is a transport-level hook: its result is flat-merged for route handlers and the CRUD context param only, it does NOT reach access rules or hooks. Derived context that rules must see belongs in `appConfig({ context })`.

## Reference Example

See the **city-portal** example for a complete working implementation:

```text
examples/city-portal/
  src/questpie/server/config/app.ts    # appConfig({ context }), x-selected-city header
  src/routes/admin.tsx                 # ScopeProvider + AdminLayoutProvider w/ sidebarProps.afterBrand ScopePicker
  src/routes/admin/$.tsx               # AdminRouter catch-all (renders the resolved view)
```
