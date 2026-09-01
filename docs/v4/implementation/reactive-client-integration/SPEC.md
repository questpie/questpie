# Reactive client integration implementation specification

- Status: Ready from Accepted ADR-0035
- Classification: Product projection under ADR-0027
- Authority: ADR-0012, ADR-0014, ADR-0019, ADR-0022, ADR-0027, and ADR-0035
- Delivery: tracer-led, test-first, no formal proof lane

## Product outcome

A developer defines a watchable Query once. The compiler-generated client
infers and emits its call, `.watch`, and `.observe` surfaces from the same Query
identity, input/output codecs, Context scope, and watchability result. The
developer does not repeat parameters, descriptions, cache keys, invalidation
metadata, or React configuration.

The generated framework-neutral Query Resource owns canonical identity,
bounded snapshot lifetime, and one shared accepted watch. The optional
`@questpie/react` package projects that resource with one hook and owns no
client or cache behavior.

## Existing facts are the only inputs

The implementation derives everything from compiler facts that already exist:

| Derived behavior                     | Existing owner                                  |
| ------------------------------------ | ----------------------------------------------- |
| `.observe` presence                  | compiler-proven Query watchability              |
| input validation and canonical bytes | generated Query input codec                     |
| output and delivery type             | generated Query output and Live Query contract  |
| resource identity                    | exact Query identity plus canonical input bytes |
| authority partition                  | immutable generated `withContext(input)` scope  |
| transport, reconnect, and stop       | existing generated `.watch` method              |
| Runtime invalidation                 | accepted Change Ledger and recomputation path   |

No authored `queryResource`, React, cache-key, Mutation-invalidation, OpenAPI,
or MCP metadata is added. Generated outputs and existing Runtime bundle/client
digests include the emitted code through their current canonical artifact
owners; this vertical creates no parallel digest or registry.

## Generated client contract

Only a watchable generated Query method adds:

```ts
observe(input: Input): QueryResource<Output>;
```

One-shot-only Queries have no `.observe`. `observe` validates and canonically
encodes input before registry mutation. It clones the accepted input snapshot
used when the underlying watch starts, so later caller mutation cannot change
the observed request.

Each immutable `const api = client.withContext(ctx)` value owns one private
registry of at most 128 identities. It remains an ordinary iterative API value:
it opens no resource by itself, accepts no callback, and has no `dispose` or
`using` contract.

Equivalent identity inside one scope returns the same Query Resource. Different
client or Context scopes never share. An idle LRU entry may be evicted;
subscribed entries are pinned. All-pinned exhaustion returns an unregistered
terminal `RESOURCE_LIMIT` resource without work. Eviction tombstones a retained
handle as terminal `RESOURCE_LIMIT`, invalidates its generation, and prevents
it from restarting or removing a later replacement.

## Query Resource lifetime

`QueryResource<Output>` exposes only stable callable `getSnapshot` and
`subscribe`. Observation is allocation-only. First subscribe starts exactly
one existing watch, later subscriptions share it, and every subscription gets
an independent token even when callbacks are referentially equal. Unsubscribe
is idempotent. Last unsubscribe invalidates the generation and stops once.

Initial, update, and reset deliveries atomically replace one complete decoded
output. Reconnect retains only a previously disclosed complete output and uses
the generated client's existing attempt. Subscriber exceptions go to the
frontend reporting owner without changing state, watch lifetime, or peer
notification.

The five accepted failures are terminal. Failure clears output, removes only
that exact resource entry, stops work, and exposes only the closed code. A
failed or evicted handle cannot restart. Recovery requires fresh observation.
There is no poller, one-shot fallback, alternate client, retry schedule,
background refresh, or detached work.

## Authority, transaction, and cancellation

Every delivered result still comes from the accepted Live Query path with
fresh Runtime Context and Policy. Query Resource retains no Policy evidence,
credentials, endpoint, headers, response body, stack, or canonical key in
public state or diagnostics.

Credentials stay application-owned. The application replaces the old immutable
Context scope on credential-lifetime transitions. Neither generated client nor
React inspects Auth state or shares across scopes.

Mutation results never update or invalidate resources. Only a committed Change
Ledger match and fresh authorized recomputation can publish an update. Rollback
publishes none. Independent resources converge independently; an atomic screen
uses one composite Query.

One unsubscribe cancels only that subscriber. Last unsubscribe delegates stop
and reconnect cancellation to the accepted watch owner. The resource adds no
shared `AbortSignal`, timeout, or cancellation authority.

## Optional React projection

`@questpie/react` `4.0.0-beta.1` has exact peer `questpie: 4.0.0-beta.1` and
React peer `react: ^19.2.0`. It exports only:

```ts
useQueryResource<Output>(
	resource: QueryResource<Output>,
): QueryResourceSnapshot<Output>;
```

The implementation is exactly
`useSyncExternalStore(resource.subscribe, resource.getSnapshot)`. Stable
resource callables require no binding wrapper. The package has no ReactDOM,
compiler, Runtime, PostgreSQL, generated application, TanStack, OpenTelemetry,
SSR, hydration, Suspense, transition, server-component, provider, cache,
transport, retry, invalidation, or fallback owner.

## Discriminated reference recipe

ADR-0037 supersedes only the copied declarations in this recipe. The finished
public guide imports `DiscriminatedValue`, `DiscriminatedReference`, and
`matchDiscriminated` from `questpie`; their production implementation belongs
to the separate ADR-0037 Product slice, not to QRI. No codec, Field, Relation,
SQL, foreign key, inverse, Policy traversal, dependency descriptor, or Runtime
polymorphic kernel is generated.

## Evidence and deletion

Team Support Desk is the beginner deletion consumer. It removes request
generation guards, duplicated Live Query state, late-delivery checks, and
post-Mutation refresh fan-out while retaining generated-client-only browser
traffic.

Collaboration is the hostile consumer. It proves Context and credential
isolation, current Policy replacement and clearing, rollback silence,
reconnect, stale callbacks, capacity, retained eviction, cancellation, and
subscriber-fault containment on PostgreSQL 17 and the browser path.

After production parity, delete the prototype Query Resource implementation and
duplicate prototype tests. No compatibility surface or parallel kernel remains.
Final closure runs focused packages and tracers, all workspace checks,
`quality:release`, release dry-runs, independent Standards and Spec reviews,
and `git diff --check` with clean resource cleanup.
