# Collaborative documents

Use QUESTPIE's collaborative aggregate when concurrent actors must edit fields
of one collection record or global. It is a framework data primitive, not a UI
editor integration.

## Definition

```ts
import { collection } from "#questpie/factories";
import { z } from "zod";

export default collection("articles")
	.fields(({ f }) => ({
		title: f
			.text({ mode: "text" })
			.default("")
			.required()
			.crdt({ format: "text" }),
		tags: f
			.text({ mode: "text" })
			.array()
			.default([])
			.required()
			.crdt({ format: "set", conflict: "add-wins" }),
		body: f.textarea().default("").required().crdt({ format: "text" }),
		status: f.text().default("draft"),
	}))
	.collaborative({
		awareness: z.object({ name: z.string().max(64) }).strict(),
	});
```

Both `.collaborative()` and at least one `.crdt()` field are required. V1
qualifies required, empty-default identity text and required string-array
add-wins sets. Do not mark localized, bounded, relation, upload, ordered-list,
object/map, transformed, or custom-codec fields.

CRDT-managed fields may be seeded during create but are absent from ordinary
update types. Never bypass that guard with system access, raw CRUD, hooks, bulk
update, or version restore.

## Runtime

```ts
import { yjsServerEngine } from "@questpie/crdt-yjs/server";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	db: { url: process.env.DATABASE_URL! },
	realtime: true,
	crdt: {
		namespace: "my-app",
		allowedOrigins: [process.env.APP_URL!],
		engines: { text: yjsServerEngine() },
	},
});
```

```ts
import { yjsClientEngine } from "@questpie/crdt-yjs/client";
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

export const client = createClient<AppConfig>({
	baseURL: window.location.origin,
	crdt: { engines: { text: yjsClientEngine() } },
});
```

`createFetchHandler()` already exposes `/realtime/crdt/open` and
`/realtime/crdt/exchange`. Never add an Elysia host, WebSocket route, second
Pusher connection, sidecar, or another process. CRDT bytes use bounded Fetch.
The existing client-wide SSE or Pusher session carries only opaque dirty hints.
Missed hints reconcile from PostgreSQL.

The server Yjs engine uses bounded in-process worker threads for untrusted CPU
work. That is private runtime machinery, not another deployable worker service.

## Generated client

```ts
const article = client.crdt.collections.articles.document({ id });
await article.connect({ mode: "edit", fallback: "view" });

article.transaction(({ fields }) => {
	fields.title.text.apply([{ type: "insert", index: 0, value: "Shared " }]);
	fields.tags.set.add("news");
	fields.body.text.apply([{ type: "insert", index: 0, value: "Opening." }]);
});

article.awareness.set({ name: "Ada" }, { activeField: "body", cursor: 8 });

await article.disconnect();
```

Construction and SSR are inert. `connect()` opens IndexedDB and transport.
Subscribe to lifecycle state and surface `recovery-required`; never silently
discard or replay recovery bundles. Use `export()` or an explicit user-approved
`discard()`.

Client failures are typed. Handle `CrdtConnectError`, `CrdtMutationError`, and
`CrdtReadError` by their stable `code` rather than parsing messages.
`CRDT_OFFLINE_HORIZON_MS` is the framework's 30-day acknowledged-offline
retention horizon; a bundle older than that requires the explicit recovery
flow. `RealtimeCrdtBindingRejectedError` reports that the optional dirty-hint
lease was rejected; it never grants data authority.

## Security and lifecycle

- Reuse normal collection/global and field access rules.
- Rebuild authority on open and every exchange.
- Cookie requests require an exact allowed HTTP(S) Origin.
- OAuth retains stable credential identity; agents require explicit
  authentication and `crdt:edit`.
- Soft delete retires an epoch; restore starts a fresh epoch; purge removes the
  retired collaboration state transactionally.
- Hidden fields reveal no data, cursor, or aggregate head.
- A visible realtime binding grants delivery only, never data authority.

## Generation and operations

After definitions or manifests change:

1. run `questpie generate`;
2. run `questpie crdt:manifest`;
3. generate a migration through the CLI and review it;
4. run `crdt:manifest` and migration generation a second time and require no
   diff;
5. apply committed migrations in production.

Never hand-edit manifest identity, package exports, or migration SQL.
QUESTPIE requires PostgreSQL 15+. Pusher documents event data as limited to
10 KB; QUESTPIE measures the canonical JSON envelope in UTF-8 and enforces an
exact 10,000-byte cap. CRDT documents do not ride Channels: exchange payloads
allow 256 KiB per field, 1 MiB per request, and a 64 MiB verified bootstrap
artifact.

For normative soundness details, inspect
`packages/questpie/src/server/modules/core/integrated/collaboration/CONTRACT.md`.
