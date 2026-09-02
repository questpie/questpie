# ADR 0035: Freeze Query Resource and React client integration

- Status: Accepted
- Date: 2026-09-01

## Context

ADR-0012 gives a compiler-proven watchable Query one generated `.watch` method.
ADR-0014 keeps frontend applications framework-neutral and makes the generated
client the exact input, output, error, Context, and transport authority.
ADR-0019 rejects a second realtime Definition or generic event transport.

Team Support Desk proves the remaining client problem. Its React browser owns
request-generation guards, loading and error records, late-response checks, and
post-Mutation refresh fan-out even though the generated client already knows the
exact Query identity, codec, Context scope, and Live Query transport. Putting
that state machine directly in React would repeat it for every frontend
framework. Letting an optional package infer identity from function or object
identity would make cache correctness depend on render allocation and would not
bind canonical Query input.

The useful boundary is a generated, framework-neutral Query Resource. React can
project that resource without becoming another client or cache owner.

## Decision

### Generated watchable Query surface

Only a compiler-proven watchable generated Query method gains:

```ts
interface WatchableQueryMethod<Input, Output> {
	(input: Input, options?: CallOptions): Promise<Output>;
	watch(
		input: Input,
		callback: (result: Output, delivery: QueryDelivery) => void,
		options?: WatchOptions,
	): () => void;
	observe(input: Input): QueryResource<Output>;
}
```

A one-shot-only Query remains callable and has neither `.watch` nor `.observe`.
`observe` validates and canonically encodes input with the same generated codec
as the call and watch paths. Invalid input fails before registry mutation,
transport, task, or timer creation through the existing generated-client input
failure boundary.

One generated `withContext(input)` scope owns one private Query Resource
registry. A resource identity is the exact Query identity plus canonical input
bytes inside that one scope. The Context value, credential material, canonical
bytes, and identity key are never exposed. Equivalent observations in the same
scope return the same resource object. Different client instances or Context
scopes never share a resource, including scopes with byte-equal Context input.

The registry retains at most 128 resource identities. A newly observed identity
evicts the least-recently-used resource with no subscribers. If every retained
resource has a subscriber, the new observation returns an unregistered resource
in terminal `RESOURCE_LIMIT` state. It opens no watch. Registry capacity is a
client-memory bound, not a server watch-authority or Policy decision.

Eviction invalidates the idle resource's generation and leaves that retained
handle in terminal `RESOURCE_LIMIT` state. Subscribing the evicted handle cannot
reopen work, re-enter the registry, or remove a later resource with the same
identity. Recovery requires a fresh `observe` call.

Calling `observe` is deterministic allocation only. It performs no I/O and
starts no task, watch, reconnect loop, or timer. This makes an idempotent
`observe` call safe during a frontend render even when that render is abandoned.

### Query Resource contract

```ts
type QueryResourceConnection =
	| Readonly<{ kind: "idle" }>
	| Readonly<{ kind: "connecting" }>
	| Readonly<{ kind: "connected" }>
	| Readonly<{ kind: "reconnecting"; attempt: number }>;

type QueryResourceSnapshot<Output> =
	| Readonly<{
			kind: "pending";
			connection: QueryResourceConnection;
	  }>
	| Readonly<{
			kind: "ready";
			value: Output;
			delivery: QueryDelivery;
			connection: QueryResourceConnection;
	  }>
	| Readonly<{ kind: "failed"; failure: WatchFailure }>;

interface QueryResource<Output> {
	getSnapshot(): QueryResourceSnapshot<Output>;
	subscribe(notify: () => void): () => void;
}
```

The resource returns the same frozen snapshot object until an observable state
change occurs. `subscribe` immediately makes the subscriber eligible for later
notifications and returns an idempotent unsubscribe function. Consumers read
the current state with `getSnapshot`; `subscribe` does not invoke the listener
as an initial-value side channel.

The first subscriber opens exactly one underlying `.watch`. Further subscribers
share it. The last unsubscribe synchronously invalidates that watch generation
and calls its stop function once. A callback saved by the old generation cannot
publish after the last unsubscribe or after a later generation starts. The
resource retains its last snapshot while idle and may reopen on a later first
subscriber.

An initial connection uses `pending/connecting`. The accepted watch callback
atomically publishes a complete decoded result as `ready` with its exact
`initial`, `update`, or `reset` delivery. Query Resource never merges, patches,
normalizes, or partially publishes application data.

On a retryable carrier interruption, the resource reflects the generated
client's existing reconnect attempt. A ready resource retains its last
previously disclosed complete value and changes only its connection to
`reconnecting`; a resource without a value remains pending. A successful
delivery replaces the complete value. Query Resource adds no retry schedule and
never retries Query or Mutation application work.

`AUTHORIZATION_FAILED`, `OUTPUT_INVALID`, `RESOURCE_LIMIT`,
`TRANSPORT_FAILED`, and `VERSION_INCOMPATIBLE` are terminal resource failures.
The resource clears any retained value, stops its watch, removes itself from the
scope registry, and publishes only the existing closed `WatchFailure`. A later
`observe` call creates a fresh resource. Failure never includes input, Context,
credential, response, Policy evidence, endpoint, or transport detail.

One subscriber callback failure does not alter the resource, stop the watch, or
prevent notification of other subscribers. It remains ordinary application
failure reported by the frontend host.

### Context, credentials, cancellation, and authority

The generated Context scope is the cache partition. A host creates and uses a
new scope when application Context changes. Credentials remain application-
composed and are not part of generated Query input. A host must discard the old
scope and its resources on sign-in, sign-out, account switch, or another
credential-lifetime transition. QUESTPIE does not inspect cookies or Auth state
to guess that transition.

Retaining an idle or reconnecting value retains bytes already disclosed to the
same application scope. It is not an authorization decision. Every server
initial evaluation, update, and reset still creates fresh Context and evaluates
current Policy under ADR-0012. An authority-change reset replaces the complete
value. A terminal authorization failure clears it.

A subscriber cancels only its subscription. One subscriber cannot cancel the
shared resource for another. Last unsubscribe stops the watch and its reconnect
work through the accepted generated-client stop function. Query Resource adds
no `AbortSignal`, timeout, detached work, Mutation retry, or background refresh
API. One-shot calls retain their existing `CallOptions`; watch cancellation
retains its existing `WatchOptions` for callers that use `.watch` directly.

### Optional React package

The optional public `@questpie/react` package exports only:

```ts
export function useQueryResource<Output>(
	resource: QueryResource<Output>,
): QueryResourceSnapshot<Output>;
```

It uses React `useSyncExternalStore` with the resource's `subscribe` and
`getSnapshot`. It owns no identity, cache, transport, retry, invalidation,
credential, Context, or error translation. React Strict Mode subscribe,
unsubscribe, and resubscribe therefore exercise the resource's idempotent
lifetime without opening concurrent watches.

Release `4.0.0-beta.1` declares exact peer `questpie: 4.0.0-beta.1` and React
peer `react: ^19.2.0`. The package has no ReactDOM, compiler, Runtime,
PostgreSQL, TanStack, OpenTelemetry, or generated-application dependency. Core
`questpie`, generated clients, and applications without this package contain no
React import. Package/version/export mismatch fails installation or import; no
runtime fallback, global provider, alternate client, or silent disable exists.

Version 1 is client-rendering only. It adds no Suspense contract, server
snapshot, SSR, hydration, transition, error-boundary, or server-component
behavior.

### Mutation behavior and observability

Query Resource observes only the accepted Live Query path. A committed change
updates a watch when the Change Ledger and dependency plan say it can change the
Query. The client does not guess writes from a Mutation name, invalidate all
Queries after a Mutation, echo Mutation input, or promise immediate cache
replacement. A screen that needs one atomic view authors and observes one
composite Query. A one-shot-only Query remains explicitly re-called by the
application.

Resource allocation, subscriber count, connection state, reconnect attempt,
terminal failure code, and eviction may be reported as bounded operational
client diagnostics. Diagnostics contain no Query input, Context, credential,
result value, Policy evidence, endpoint, header, or stack.

### Discriminated reference values

This decision also publishes a recipe for an ordinary TypeScript discriminated
reference value and exhaustive matcher. The recipe may represent `{ kind, id }`
in application input, output, or stored scalar fields. It is not a Relation and
has no foreign key, inverse, join, cascade, Policy traversal, nondisclosure, or
Live Query dependency meaning. Applications resolve each variant through an
explicit named Query or Mutation whose current Policy remains authoritative.

The recipe does not add `codec.variant`, a public helper export, a generated
polymorphic descriptor, or a Runtime polymorphic kernel. A later public helper
or codec requires its own consumer and decision.

## Consequences

- Team Support Desk can delete framework-neutral request racing and Live Query
  state code before the React adapter removes hook wiring.
- Collaboration can prove Context isolation, authorization reset, reconnect,
  stale-callback, terminal-failure, and subscriber-lifetime behavior without a
  second server or realtime kernel.
- Other frontend frameworks consume the same Query Resource directly.
- React remains optional and replaceable without weakening generated-client
  identity or Live Query authority.

## Acceptance

ADR-0027 classifies this generated-client and optional React integration as a
Product projection over the accepted Live Query kernel. The exact clean
candidate `e909a8e14dc4b5e9f294f27df6bb9f27ef859efe` passed an independent
read-only replacement review after its retained-eviction hostile was repaired.
All eight deterministic candidate gates passed, including 13 focused tests with
50 assertions, strict TypeScript, staging, lint, formatting, architecture, and
both diff checks.

## Supersession ledger

This decision adds one projection to ADR-0012's generated watchable Query
method and one optional frontend package to ADR-0014's framework-neutral client
boundary. It preserves ADR-0012's result, reset, reconnect, limits, Context,
Policy, Change Ledger, and stop semantics; ADR-0014's one generated client and
wire authority; ADR-0019's exact exports and absence of a generic event
transport; ADR-0022's Resource Identity; and ADR-0027's tracer-led Product
delivery.

Because this decision postdates ADR-0033, it supersedes only ADR-0033's
then-current release-cardinality wording: `@questpie/react` is the third public
package alongside `questpie` and `@questpie/opentelemetry`. The current beta
publishable set is exactly those three packages. ADR-0033's requirement to ship
and verify the optional exact-peer OpenTelemetry adapter remains unchanged.

It does not supersede Query execution, Operation Wire, Policy, Context,
credentials, Mutation, transaction, Change Ledger, server cache, or Runtime
capability ownership.

## Deletion ledger

- The Query Resource core lands before the optional React package. Production
  code replaces the executable prototype; it does not preserve a compatibility
  resource or a second cache.
- Team Support Desk deletes request-generation guards, hand-authored Live Query
  loading/error state, late-delivery checks, and post-Mutation refresh fan-out
  as each production tracer slice takes ownership.
- Collaboration adds hostile coverage for Context isolation, authority reset,
  rollback silence, reconnect, capacity, eviction, cancellation, and subscriber
  lifetime. It adds no application cache or alternate client.
- The discriminated reference example remains an ordinary TypeScript recipe.
  No production helper, codec, Relation descriptor, or Runtime polymorphic
  kernel is created by this decision.
- After production and fixture parity, the prototype implementation and its
  duplicate tests are deleted. The ADR and ordinary repository history retain
  the decision and review evidence.

## Rejected alternatives

- A React-owned cache, transport, retry loop, or generated-client replacement.
- Function identity, render object identity, or generic JSON serialization as
  Query Resource identity.
- Static invalidation claims for arbitrary named Mutations.
- A TanStack, Suspense, SSR, hydration, or global-provider contract in v1.
- Cross-Context, cross-client, process-global, or credential-guessing cache.
- Calling an unchecked discriminated `{ kind, id }` value a Relation.
