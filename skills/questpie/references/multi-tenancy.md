---
name: questpie-core-multi-tenancy
description: QUESTPIE multi-tenant scope context resolver header-based tenant isolation appConfig context ScopeProvider ScopePicker request-scoped derived context data filtering access control workspace organization property
  - questpie-core
  - questpie-core-rules
  - questpie-core-business-logic
---

# QUESTPIE Multi-Tenancy

QUESTPIE supports multi-tenant applications through a **scope-based** architecture. A "scope" can represent anything: organizations, workspaces, properties, cities, brands — any entity that partitions data.

The pattern is simple: **HTTP header carries a scope ID, the `appConfig({ context })` resolver derives typed context once per request, access rules filter data**.

## Architecture Overview

```text
Client                          Server
──────                          ──────
ScopeProvider                   config/app.ts → appConfig({ context })
  ↓ stores scopeId                ↓ resolver runs ONCE per HTTP request
ScopePicker (UI)                  ↓ result travels with the request
useScopedFetch()                access rules / hooks / routes / getContext()
  ↓ injects HTTP header           ↓ read it flat: ({ workspaceId }) => ...
fetch("x-selected-city: id")    AsyncLocalStorage carries it into nested CRUD
```

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

The context resolver lives in `config/app.ts`. It runs **once per HTTP request** at the single derivation point (`app.createContext()`), and the returned object travels with the request — flat-merged into every access rule ctx, hook ctx, route handler args, field access ctx, and `getContext()`.

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

The resolver receives the base request params plus the full system-mode service surface (typed via codegen — `Questpie.ContextResolverContext`):

| Parameter     | Type                        | Description                                      |
| ------------- | --------------------------- | ------------------------------------------------ |
| `request`     | `Request`                   | The incoming HTTP request (Web API)              |
| `session`     | `{ user, session } \| null` | Resolved auth session (null if unauthenticated)  |
| `db`          | `Database`                  | Raw database client                              |
| `collections` | `CollectionsAPI`            | Typed collections (system mode, hooks/i18n run)  |
| `globals`     | `GlobalsAPI`                | Typed globals                                    |
| `logger`      | `LoggerService`             | App logger                                       |
| `kv`          | `KVService`                 | Key-value store                                  |
| `queue`       | `QueueClient`               | Queue client                                     |
| `t`           | `(key, params?) => string`  | Translations                                     |
| `services`    |                             | User services from `services/`                   |

### Lifecycle Rules

- **Once per HTTP request.** Admin and REST calls alike. Nested CRUD, relation hydration, and hooks within the same request never re-run the resolver.
- **No request → no resolver.** Jobs, workflows, seeds, and `createContext()` without a `request` skip it. Extension types are `Partial<…>` — **always narrow** (`if (!workspaceId) return false`).
- **Collections inside the resolver run system mode** — the resolver IS trusted derivation. If you explicitly pass `accessMode: "user"` to a CRUD call inside the resolver, rules evaluated from there see no extensions (they don't exist yet) — rules must already tolerate absence.
- **Throwing fails the request** before any rule or handler runs. Throw `ApiError.*` for structured error responses (the tenant-validation case).
- **Reserved keys warn in dev.** Returning `session`, `db`, `locale`, `accessMode`, `collections`, … from the resolver logs a warning — framework keys cannot be shadowed.

### Request-Level Memoization = Closures

The resolver's closure scope lives exactly one request — expensive lookups become lazy functions, no `WeakMap`, no cache keys, no framework machinery:

```ts
// config/app.ts
export default appConfig({
	context: async ({ session, collections }) => {
		const userId = session?.user?.id ?? null;

		// Resolved at most once per request, only when first awaited
		let memberships: Promise<string[]> | null = null;
		const loadMemberships = () =>
			(memberships ??= (async () => {
				if (!userId) return [];
				const rows = await collections.workspace_members.find({
					where: { user: userId },
				});
				return rows.docs.map((r) => r.workspace);
			})());

		return { userId, memberships: loadMemberships };
	},
});
```

Rules then call `await memberships()` — the underlying query runs once per request no matter how many rules, hooks, and relation hydrations evaluate.

## Step 3: Filter Data with Access Rules

The resolved context arrives **flat** on the rule ctx — destructure it directly (no `ctx` wrapper). Extensions are optional types: narrow before use.

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
		// Auto-assign workspace on create — extensions are flat on hook ctx too
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

Wrap your admin with `ScopeProvider` to enable scope selection. It manages the selected scope ID and persists it to localStorage.

```tsx
// routes/admin/$.tsx
import {
	AdminLayout,
	AdminRouter,
	ScopePicker,
	ScopeProvider,
} from "@questpie/admin/client";

function AdminPage() {
	return (
		<ScopeProvider
			headerName="x-selected-workspace"
			storageKey="admin-selected-workspace"
		>
			<AdminContent />
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

A dropdown for selecting the current scope. Place it in the sidebar:

```tsx
function AdminContent() {
	return (
		<AdminLayout
			admin={admin}
			basePath="/admin"
			slots={{
				afterBrand: (
					<div className="px-3 py-2 border-b">
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
			<AdminRouter basePath="/admin" />
		</AdminLayout>
	);
}
```

#### ScopePicker Props

| Prop          | Type                           | Default       | Description                                |
| ------------- | ------------------------------ | ------------- | ------------------------------------------ |
| `collection`  | `string`                       | —             | Collection to fetch options from           |
| `labelField`  | `string`                       | `"name"`      | Field to display as label                  |
| `valueField`  | `string`                       | `"id"`        | Field to use as value                      |
| `options`     | `ScopeOption[]`                | —             | Static options (alternative to collection) |
| `loadOptions` | `() => Promise<ScopeOption[]>` | —             | Async options loader                       |
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

## Full Request Flow

```text
1. User selects "Acme Corp" in ScopePicker
2. ScopeProvider stores scopeId = "ws_123" in state + localStorage
3. useScopedFetch() creates fetch that adds header: x-selected-workspace: ws_123
4. Client makes API call → POST /api/collections/projects/find
5. Server: app.createContext() runs the appConfig({ context }) resolver ONCE
6. Server: resolver extracts workspaceId = "ws_123", validates membership
7. Server: result travels with the request (flat keys + internal bundle)
8. Server: access rules read ({ workspaceId }) → return { workspace: "ws_123" }
9. Server: hooks, nested CRUD, getContext() all see the same workspaceId
10. Server: query filtered to workspace = "ws_123"
11. Response: Only Acme Corp's projects returned
```

## Common Mistakes

### HIGH: Wrapping context access in `ctx`

Extensions arrive **flat** on rule and hook contexts. There is no `ctx` sub-object:

```ts
// WRONG — there is no ctx wrapper
read: ({ ctx }) => ({ workspace: ctx.workspaceId })

// RIGHT — destructure flat
read: ({ workspaceId }) => (workspaceId ? { workspace: workspaceId } : false)
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

In production, validate that the authenticated user actually belongs to the selected scope — otherwise any user can access any scope by sending the header manually. Throw from the resolver to fail the request before any handler runs (see Step 2).

### MEDIUM: Using `extendContext` for tenant scope

`AdapterConfig.extendContext` is a transport-level hook: its result is flat-merged for route handlers and the CRUD context param only — it does NOT reach access rules or hooks. Derived context that rules must see belongs in `appConfig({ context })`.

## Reference Example

See the **city-portal** example for a complete working implementation:

```text
examples/city-portal/
  src/questpie/server/config/app.ts    # appConfig({ context }) — x-selected-city header
  src/routes/admin/$.tsx               # Admin with ScopeProvider + ScopePicker
```
