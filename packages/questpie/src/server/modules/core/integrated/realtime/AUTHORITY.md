# Realtime authority and sharing

## Invariants

1. Collection and global live-query output is defined by the ordinary CRUD
   read pipeline: request query, resolved `AppContext`, read access, field
   access, output hooks, and `afterRead`. Realtime adds no tenant or authority
   filter of its own.
2. A resolved typed Channel is the complete authority target for that Channel.
   Its registry definition and validated params resolve to one transport-safe
   channel identity; no second scope is attached to it.
3. Channel authority invalidation is exact: one resolved Channel and one opaque
   subject. It advances the existing durable authority fence and re-runs the
   Channel subscribe rule with a fresh context.
4. Scheduler sharing is an optimization, never authorization. By default,
   equivalent live queries share only inside the same authenticated session,
   OAuth token, or anonymous edge connection.
5. `realtime.accessCacheKey` is an explicit proof that byte-identical output may
   be shared more widely. The effective authorized topic, locale, stage, access
   mode, and delivery mode remain part of the scheduler key.
6. `realtime.subscriptionScope` is not an authority primitive. It is deprecated
   in 3.x and removed in 4.0 after callers migrate tenant selection into
   `appConfig.context` and collection/global access.

## Canonical Channels interface

Parametric Channels resolve once and retain their validated params:

```ts
const conversation = channels.conversation({ sessionId });

await conversation.publish("message.persisted", data);
await conversation.invalidateAuthority({
	subject: { kind: "user", id: userId },
	idempotencyKey,
});
```

Channels without params are already resolved:

```ts
await channels.news.publish("published", data);
```

The client mirrors the same binding model. Authority invalidation remains
server-only.

The released root methods remain deprecated compatibility entry points
throughout 3.x. They use the same service and ledger.

## `accessCacheKey` contract

A valid explicit key replaces the default session/principal sharing identity.
It is a claim made by the collection/global author:

> For the same effective authorized topic and framework-owned dimensions,
> every context returning this key produces byte-identical output, including
> field access and `afterRead`.

This makes compute-once/fan-out possible:

```ts
collection("publicAnnouncements")
	.access({ read: true })
	.options({
		realtime: { accessCacheKey: () => "public-announcements:v1" },
	});
```

One server instance may then serve 100,000 equivalent subscribers with one
database computation per refresh. Multiple server replicas each own their
local scheduler group. Invalid, over-long, or throwing resolvers fail closed to
the default isolated identity.

## Transport truthfulness

SSE can close an exact logical binding. Shared providers such as Pusher may
only terminate every physical connection for a principal and let desired
topology reconnect and reauthorize. Public receipts call this
`transportEffect`, not `scope`, so it cannot be confused with data or OAuth
scope.

In a managed caller transaction, shared-provider termination and authority
acknowledgement run inline under a bounded call. Provider failure throws and
rolls back the database transaction; a conservative disconnect may survive a
later caller rollback. Standalone provider failure leaves the durable cut
pending for an idempotent retry. A fully rollback-safe provider effect would
require a provider-prepared opaque target plus a distributed claim/lease; this
patch intentionally does not introduce that second outbox contract.

No transport can retract bytes already accepted into a socket buffer. The
framework guarantee is that no new ordered frame is logically admitted under
an authority generation older than the committed fence.

## Non-goals

- No company, workspace, membership, role, ACL, or ABAC model in the framework.
- No scope-wide Channel or live-query invalidation.
- No app-side enumeration of active subscriptions.
- No second realtime event bus, authority ledger, or polling subsystem.
- Scoped Globals remain their existing data-model feature and are unrelated.

## Verification

- Server and client Channel handles infer params, events, and payloads.
- A handle cannot be constructed with missing or unknown params.
- Exact invalidation preserves allowed subscriptions and closes denied ones.
- A different resolved Channel or subject is untouched.
- Duplicate idempotency keys return the original generation; conflicting reuse
  fails.
- SSE reconciliation starts after commit; rollback does not change its local
  bindings.
- Shared-provider failure rolls back the database mutation; a completed
  conservative disconnect may survive a later caller rollback.
- SSE and Pusher report their real transport effect.
- Effective collection access remains part of every live-query scheduler key.
- Different sessions of one user do not share by default.
- A valid `accessCacheKey` collapses equivalent principals to one computation.
- Context-dependent output remains isolated without an explicit sharing key.
- Existing root Channel methods remain operational during 3.x.
