# Query Resource and React integration specification

- Status: Proposed executable contract; not product authority
- Scope: generated browser client and optional React projection only

## Ownership

| Concern                                         | Owner                                 |
| ----------------------------------------------- | ------------------------------------- |
| Query identity, input codec and canonical bytes | generated client                      |
| Context partition                               | one generated `withContext` scope     |
| authorization and result disclosure             | Runtime Context and Policy            |
| invalidation and recomputation                  | accepted Live Query and Change Ledger |
| resource registry and snapshot state            | generated client scope                |
| rendering subscription                          | optional `@questpie/react`            |
| credentials and credential transition           | application-composed Auth host        |
| application domain data                         | named Query and Mutation contracts    |

## Public generated shape

Only `WatchableQueryMethod<Input, Output>` adds
`observe(input: Input): QueryResource<Output>`. Existing callable and `.watch`
members do not change. A one-shot-only Query has no `observe` member.

`QueryResource<Output>` has exactly:

```ts
getSnapshot(): QueryResourceSnapshot<Output>;
subscribe(notify: () => void): () => void;
```

The snapshot is exactly `pending`, `ready`, or `failed`. Pending and ready carry
one connection value: `idle`, `connecting`, `connected`, or `reconnecting` with
a positive integer attempt. Ready also carries the complete output and exact
accepted delivery value. Failed carries only one accepted `WatchFailure`.

Every returned object and nested state is frozen. `getSnapshot` preserves object
identity until a state change. A listener observes only that state-change edge
and reads the value separately.

## Identity and bounds

`observe` first validates and canonically encodes input with the generated
Query codec. Failure creates no registry entry or work.

One scope registry keys by exact Query identity and canonical input bytes. The
key is private and cannot be logged or read. Same scope and key returns the same
resource. Client instances and Context scopes never share.

The registry holds 128 identities. It evicts only an idle least-recently-used
resource. Subscribed resources are pinned. Exhaustion with all entries pinned
returns one unregistered terminal `RESOURCE_LIMIT` resource and starts no work.

## Lifetime and concurrency

Observation alone is lazy. First subscription changes the resource to
connecting and opens one generated watch. Every later subscription shares that
watch. Unsubscribe is idempotent.

The last unsubscribe synchronously invalidates the active generation and calls
the watch stop function exactly once. A callback from an invalid generation is
ignored. The final snapshot stays retained while idle. A later first subscriber
opens a fresh watch generation.

Generated watch callbacks, state callbacks, and failures are serialized before
snapshot publication. A listener exception is isolated from other listeners
and from resource state. The frontend host owns reporting that exception.

## Delivery and reconnect

Initial, update, and reset callbacks replace the complete output atomically.
No partial value, patch, entity normalization, or input echo is published.

Retryable carrier interruption uses the generated client's accepted reconnect
schedule. A ready resource retains the previous complete value and publishes
reconnecting state. Pending remains pending. A later delivery replaces the
complete value and returns connected state. Query Resource creates no retry
timer or application retry.

The five accepted watch failures are terminal. Terminal failure clears output,
invalidates and stops the active generation, removes the resource from the
registry, and publishes a failure containing only its closed code. A subsequent
observation creates a new resource.

## Context, credentials and disclosure

The resource registry is local to one immutable generated Context scope.
Byte-equal Context in another scope is still isolated. Runtime recomputation
continues to resolve fresh Context and Policy for every result.

Credentials are not Query input and the generated client does not inspect Auth
state. The application must discard old client scopes and resources on every
credential-lifetime transition. The React adapter supplies no global cache or
provider that could retain them across that boundary.

Previously ready data may remain visible while idle or retryably reconnecting in
the same resource. It is previously disclosed application memory, not fresh
authority. An authorization reset atomically replaces it with a fresh result.
An authorization failure clears it before failure publication.

No diagnostic or failure contains Query input, Context, credential, output,
Policy evidence, canonical key, endpoint, header, response body, or stack.

## Cancellation and failure

One unsubscribe cancels only that subscriber. Last unsubscribe stops the shared
watch and reconnect activity. The resource exposes no shared AbortSignal because
one consumer cannot cancel another. Direct `.watch` and one-shot calls retain
their accepted signal and timeout options.

Query Resource does not retry Query handlers, Mutations, transport calls, or
terminal failures. It does not convert a failure into an empty or stale success.
No fallback cache, poller, one-shot call, or alternate client activates when
watching fails.

## React package

`@questpie/react` version `4.0.0-beta.1` has exact peer
`questpie: 4.0.0-beta.1` and peer `react: ^19.2.0`. It exports only
`useQueryResource`. It has no dependency on ReactDOM, compiler, Runtime,
PostgreSQL, generated application code, TanStack, or another cache.

The hook calls `useSyncExternalStore(resource.subscribe,
resource.getSnapshot)`. It does not translate state or failures. Strict Mode
may subscribe and unsubscribe repeatedly without overlapping underlying
watches. Version 1 has no server snapshot and promises no SSR, hydration,
Suspense, transition, server-component, or error-boundary behavior.

Core `questpie`, generated clients, and applications that do not install the
package contain no React import. Package, peer, or export mismatch fails without
a runtime fallback.

## Mutation and transaction boundary

The resource observes accepted Query recomputation only. A committed Mutation
may lead to an update only through durable Change Ledger matching. Rollback and
zero-row work do not. The client publishes no static Mutation invalidation map,
automatic refetch-all rule, optimistic write, or post-Mutation refresh promise.

Independent resources converge independently. An application needing one
atomic view authors one composite Query. One-shot-only Query refresh remains an
explicit application call.

## Discriminated reference recipe

A docs recipe defines a generic TypeScript discriminated union and exhaustive
matcher. It is ordinary application code. `{ kind, id }` is a discriminated
reference value, not a Relation. Its target is resolved by explicit named
Operations under current Policy.

The recipe adds no codec, Field, constraint, foreign key, inverse, join, cascade,
Policy evidence, Live Query dependency, generated descriptor, or Runtime kernel.

## Tracer and deletion criteria

Team Support Desk must delete its request-generation guards, duplicated
loading/error records, and post-Mutation Query refresh fan-out without adding a
parallel browser client. Collaboration must prove Context and credential
isolation, authorization replacement and clearing, reconnect retention, stale
generation containment, rollback silence, capacity, and subscriber-fault
isolation.

The implementation does not begin until the Proposed ADR receives formal PASS
and Accepted projection is committed separately.
