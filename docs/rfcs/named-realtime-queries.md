# RFC: named realtime queries

Status: proposed, non-blocking, no implementation in Realtime v3.

## Decision to evaluate

QUESTPIE should eventually add a server-declared, code-generated realtime query primitive for bounded read models that cannot be expressed safely or efficiently as arbitrary client collection `find` topics.

This RFC does not authorize implementation. Generic collection realtime, typed channels, and ordinary refetch remain the supported choices until the API and query-plan contract are ratified.

## Why a distinct primitive

A route owns input validation and access but has request/response lifetime and no declared invalidation plan. A service owns reusable server logic but is not a public typed subscription contract. A collection live query exposes a client-owned query plan, which is intentionally too broad for rankings, personalized graphs, or application-specific materializations.

A named realtime query needs all three:

- validated public or internal arguments;
- a server-owned query and authorization plan;
- a declared, reviewable invalidation/candidate plan.

It should therefore be a definition/codegen primitive that may call routes/services internally, not a magic realtime flag on an arbitrary route.

## Strawman API

The example is illustrative syntax, not shipped API:

```ts
// realtime-queries/activity-feed.ts
import { realtimeQuery } from "questpie/realtime";
import { z } from "zod";

export default realtimeQuery("activity-feed")
	.input(
		z.object({
			scopeId: z.string().max(128),
			bucketId: z.string().max(128),
		}),
	)
	.public()
	.identity(({ input, principal, locale }) => ({
		principalId: principal.user.id,
		scopeId: input.scopeId,
		bucketId: input.bucketId,
		locale,
	}))
	.watch(({ input }) => [
		{ collection: "activityInbox", where: { scopeId: input.scopeId } },
	])
	.query(async ({ input, collections }) =>
		collections.activityInbox.find({
			where: {
				scopeId: input.scopeId,
				bucketId: input.bucketId,
			},
			limit: 100,
		}),
	);
```

Possible generated client:

```ts
const stop = client.realtimeQueries.activityFeed.subscribe(
	{ scopeId, bucketId },
	(result) => render(result.docs),
);
```

An internal definition would be callable only from trusted server code and would not appear in browser discovery:

```ts
realtimeQuery("rebuild-progress").input(schema).internal();
```

## Security model

- Public/internal visibility is explicit. Internal is fail-closed and absent from public codegen/discovery.
- Input is parsed before identity, admission, watch-plan allocation, or query execution.
- The server derives principal and subscription scope from authenticated request context. A client argument never becomes authority merely because it is named `scopeId`.
- Query execution uses the normal `AppContext`, collection access, field access, relation hydration, and hooks. No realtime-only access system exists.
- A watch predicate is a candidate optimization only. It cannot grant rows or replace query authorization.
- Missing or invalid relation metadata fails closed exactly as it does for normal reads.
- Public rejection payloads contain the query name, stable reason, and bounded limits, never arguments, identity, watch keys, or results.

## Cache and group identity

The group key is a canonical tuple:

1. definition name and version;
2. validated/canonical arguments selected by the definition;
3. explicit access-equivalence identity, otherwise stable principal identity;
4. frozen server subscription scope;
5. locale, stage, and access mode;
6. output-affecting definition revision.

Definitions may deliberately omit an argument from identity only when tests prove it cannot change output or authority. Materialized membership/permission id sets are forbidden in the key. Mutable authorization is re-evaluated from current database state.

Changing scope or an identity-bearing argument opens a new group and bootstraps a fresh result. Deployment revision changes force a reset rather than sharing old output across incompatible query code.

## Admission and execution

Every definition declares or inherits finite:

- subscriptions per principal/session;
- validated argument bytes;
- candidate/watch anchors and maximum dependency count;
- bootstrap rows and serialized bytes;
- computation concurrency and timeout;
- refresh/delta queue count and bytes;
- optional cache lifetime.

The initial implementation should support snapshot recomputation only. Native deltas require a separate proof that the server-owned plan maps authoritative row changes into keyed output operations. An arbitrary handler return value is not delta-eligible.

## Delivery boundary

| Need                                                     | Use                                                        |
| -------------------------------------------------------- | ---------------------------------------------------------- |
| Bounded normalized collection rows                       | Generic collection realtime                                |
| Bounded server-owned read model with validated arguments | Future named realtime query                                |
| Transient fanout, presence, progress, or invalidation    | Typed channel                                              |
| Personalized ranking/page with no durable push need      | Normal query/refetch                                       |
| Durable per-recipient feed                               | Materialized inbox collection, optionally generic realtime |

A named query is not a substitute for materializing a 100,000-recipient fanout. Its declared watch plan and diagnostics must still surface a high candidate blast.

## Codegen and discovery

If approved:

- add a plugin-driven `realtimeQueries` category and registry;
- generate server definition maps and typed public client handles;
- expose public definitions through bounded introspection/OpenAPI only if existing generic policy allows it;
- keep internal definitions absent from public artifacts;
- generate package entrypoints through `tsdown` and `src/exports`, never manual ad-hoc exports.

MCP discovery should follow the same public/internal and capability policy as other generated operations. No automatic MCP tool should be added merely because a realtime definition exists.

## Migration path

1. Keep existing collection live queries unchanged.
2. Ratify definition identity, watch plan, observability, and public/internal discovery.
3. Land snapshot-only named queries behind additive codegen.
4. Migrate only high-cost hand-built collection topics whose server-owned plan is demonstrably bounded.
5. Consider native deltas per definition in a later RFC.

No wire migration should reinterpret an existing collection topic as a named query.

## Non-goals

- Arbitrary incremental SQL.
- Running arbitrary client query text or route handlers as subscriptions.
- Automatic fanout/materialization architecture.
- Treating client filters or watch plans as access control.
- Replacing typed channels.
- Shipping this API as part of the current Realtime v3 delta emitter.

## Acceptance cases before implementation

- Public and internal definitions have non-confusable generated surfaces.
- Invalid input performs no group allocation, query, or watch registration.
- Two principals, scopes, locales, or output-affecting arguments cannot collide.
- Current database-backed membership revocation triggers targeted reset and removes unauthorized output.
- A watch miss only skips a definitely unrelated change; unknown continues to authoritative execution.
- Missing/mismatched relational access metadata denies or rejects.
- Admission bounds bootstrap rows/bytes, compute concurrency, and queues.
- Diagnostics expose candidates, DB executions, snapshot bytes, resets, and stable reasons without raw argument/identity labels.
- A 100,000 personalized-relation adversary is reported as high blast rather than marketed as scalable.
- Collection realtime, named queries, typed channels, and refetch have explicit migration examples and no silent behavior changes.
