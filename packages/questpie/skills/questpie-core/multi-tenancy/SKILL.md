---
name: questpie-core-multi-tenancy
description: QUESTPIE multi-tenant scope context resolver header-based tenant isolation ScopeProvider ScopePicker request-scoped services data filtering access control workspace organization property
type: sub-skill
requires:
  - questpie-core
  - questpie-core-rules
  - questpie-core-business-logic
---

# QUESTPIE Multi-Tenancy

QUESTPIE supports multi-tenant applications through a **scope-based** architecture. A "scope" can represent anything: organizations, workspaces, properties, cities, brands — any entity that partitions data.

The pattern is simple: **HTTP header carries a scope ID, server extracts it into typed context, access rules filter data**.

## Architecture Overview

```text
Client                          Server
──────                          ──────
ScopeProvider                   context.ts (file convention)
  ↓ stores scopeId                ↓ extracts header → typed context
ScopePicker (UI)                appConfig({ context }) (types)
  ↓ user selects scope            ↓ available in every handler
useScopedFetch()                access rules / hooks
  ↓ injects HTTP header           ↓ filter data by scope
fetch("x-selected-city: id")   AsyncLocalStorage → getContext()
```

## Step 1: Define the Scope Collection

Create a collection that represents your tenant entity:

```ts
// collections/workspaces.ts
import { collection } from "#questpie";

export default collection("workspaces").fields(({ f }) => ({
	name: f.text({ label: "Name", required: true }),
	slug: f.slug({ label: "Slug", from: "name" }),
	owner: f.relation({ to: "user", label: "Owner" }),
}));
```

Other collections reference the scope via a relation:

```ts
// collections/projects.ts
import { collection } from "#questpie";

export default collection("projects").fields(({ f }) => ({
	title: f.text({ label: "Title", required: true }),
	workspace: f.relation({
		to: "workspaces",
		label: "Workspace",
		required: true,
	}),
}));
```

## Step 2: Create the Context Resolver

The `context.ts` file convention is a singleton that extracts custom properties from each incoming request. Codegen discovers it automatically.

```ts
// src/questpie/server/context.ts
import { context } from "#questpie";

export default context(async ({ request, session, db }) => {
	const workspaceId = request.headers.get("x-selected-workspace");

	// Optional: validate that the user has access to this workspace
	// if (workspaceId && session?.user) {
	//   const membership = await db.query.workspaceMembers.findFirst({
	//     where: and(
	//       eq(workspaceMembers.workspaceId, workspaceId),
	//       eq(workspaceMembers.userId, session.user.id),
	//     ),
	//   });
	//   if (!membership) throw new Error("No access to this workspace");
	// }

	return {
		workspaceId: workspaceId || null,
	};
});
```

### Context Resolver Parameters

| Parameter | Type                        | Description                                     |
| --------- | --------------------------- | ----------------------------------------------- |
| `request` | `Request`                   | The incoming HTTP request (Web API)             |
| `session` | `{ user, session } \| null` | Resolved auth session (null if unauthenticated) |
| `db`      | `Database`                  | Database client for validation queries          |

The object you return is merged into the request context and becomes available in **every** handler, hook, and access rule.

## Step 3: Filter Data with Access Rules

Use the typed context in access rules and hooks to enforce data isolation:

```ts
// collections/projects.ts
import { collection } from "#questpie";

export default collection("projects")
	.fields(({ f }) => ({
		title: f.text({ label: "Title", required: true }),
		workspace: f.relation({
			to: "workspaces",
			label: "Workspace",
			required: true,
		}),
	}))
	.access({
		// Only allow reads when a workspace is selected
		read: ({ ctx }) => {
			if (!ctx.workspaceId) return false;
			return { workspace: { equals: ctx.workspaceId } };
		},
		create: ({ ctx }) => !!ctx.workspaceId,
		update: ({ ctx }) => {
			if (!ctx.workspaceId) return false;
			return { workspace: { equals: ctx.workspaceId } };
		},
		delete: ({ ctx }) => {
			if (!ctx.workspaceId) return false;
			return { workspace: { equals: ctx.workspaceId } };
		},
	})
	.hooks({
		// Auto-assign workspace on create
		beforeCreate: async ({ data, ctx }) => {
			if (ctx.workspaceId) {
				data.workspace = ctx.workspaceId;
			}
		},
	});
```

### Access Rule Return Values

| Return                         | Meaning                                  |
| ------------------------------ | ---------------------------------------- |
| `true`                         | Allow all records                        |
| `false`                        | Deny all records                         |
| `{ field: { equals: value } }` | Where-clause filter (row-level security) |

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

## Request-Scoped Services

For advanced cases, create a request-scoped service that provides a tenant-aware database connection:

```ts
// services/scoped-db.ts
import { service } from "questpie";

export default service({
	lifecycle: "request",
	deps: ["db", "session"] as const,
	create: ({ db, session }) => {
		return createScopedDb(db, session?.user?.tenantId);
	},
	dispose: (scopedDb) => scopedDb.release(),
});
```

## Full Request Flow

```text
1. User selects "Acme Corp" in ScopePicker
2. ScopeProvider stores scopeId = "ws_123" in state + localStorage
3. useScopedFetch() creates fetch that adds header: x-selected-workspace: ws_123
4. Client makes API call → POST /api/collections/projects/find
5. Server: createAdapterContext() receives Request
6. Server: context.ts resolver extracts workspaceId = "ws_123" from header
7. Server: RequestContext created with { workspaceId: "ws_123", session, locale, ... }
8. Server: runWithContext() stores in AsyncLocalStorage
9. Server: Access rules evaluate → return { workspace: { equals: "ws_123" } }
10. Server: Query filtered to workspace = "ws_123"
11. Response: Only Acme Corp's projects returned
```

## Common Mistakes

### HIGH: Forgetting module augmentation

Without a `context` function in `appConfig()`, your custom context properties won't be available in handlers. Make sure to define `context` in your `config/app.ts`.

### HIGH: Not filtering in access rules

The context resolver only **extracts** the scope. You must still enforce isolation in `.access()` rules or `.hooks()`. Without access rules, all data is returned regardless of scope.

### MEDIUM: Hardcoding header names

Use the same header name in `ScopeProvider.headerName` and `context.ts`. A mismatch means the server never sees the scope ID.

```ts
// These MUST match:
// Client:
<ScopeProvider headerName="x-selected-workspace" />

// Server (context.ts):
request.headers.get("x-selected-workspace")
```

### MEDIUM: Not validating scope access

In production, validate that the authenticated user actually belongs to the selected scope. Otherwise any user can access any scope by sending the header manually.

```ts
export default context(async ({ request, session, db }) => {
	const workspaceId = request.headers.get("x-selected-workspace");

	if (workspaceId && session?.user) {
		const isMember = await db.query.workspaceMembers.findFirst({
			where: and(
				eq(workspaceMembers.workspaceId, workspaceId),
				eq(workspaceMembers.userId, session.user.id),
			),
		});
		if (!isMember) {
			throw new Error("Unauthorized access to workspace");
		}
	}

	return { workspaceId: workspaceId || null };
});
```

## Reference Example

See the **city-portal** example for a complete working implementation:

```text
examples/city-portal/
  src/questpie/server/context.ts       # Context resolver (x-selected-city header)
  src/routes/admin/$.tsx               # Admin with ScopeProvider + ScopePicker
```
