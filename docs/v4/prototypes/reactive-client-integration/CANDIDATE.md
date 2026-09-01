# Reactive client integration candidate

Status: Proposed proof candidate; not Accepted authority

## Authority delta

The candidate preserves the accepted generated client, `.watch`, Context,
Policy, Live Query, Change Ledger, reconnect, and complete-result contracts. It
proposes only:

1. `.observe(input)` on compiler-proven watchable Query methods;
2. one scope-owned bounded Query Resource registry and closed snapshot state;
3. optional exact-peer `@questpie/react` as a `useSyncExternalStore` projection;
   and
4. a docs-only discriminated reference value recipe that is explicitly not a
   Relation.

ADR-0035 remains Proposed. `SPEC.md`, `CONTEXT.md`, `HANDOFF.md`, the live ADR
index, and finished public documentation remain unchanged until a committed
formal PASS and a separate authority-projection commit.

## Why this interface is small

The generated client already owns exact Query identity, codecs, Context scope,
the one-shot call, and the accepted watch transport. It is the only layer that
can identify equivalent Query resources without heuristic serialization or a
second registry contract.

`QueryResource` exposes only `getSnapshot` and `subscribe`. It does not expose
keys, bytes, input, Context, transport, invalidation, retry, mutation, cache
provider, or framework state. React consumes that interface and owns nothing
below it.

## Executable evidence

- `query-resource.test.ts` proves exact same-scope identity, cross-scope
  isolation, lazy first-subscriber start, shared watch, last-unsubscribe stop,
  stale-generation containment, complete replacement, reconnect retention,
  terminal clearing, recovery by fresh observation, bounded terminal idle
  eviction, retained-handle containment, and local capacity failure.
- `authoring-types.test.ts` proves exact output inference, `.observe` absence on
  one-shot Queries, immutable snapshots, and the React hook's generic
  projection.
- `discriminated-reference.test.ts` proves exact union construction and
  exhaustive matching while retaining an explicit negative Relation claim.
- `staging-check.ts` proves Proposed status, unchanged accepted authority,
  manifest hashes, exact package boundary text, and the absence of Accepted
  projection.

## Tracer pull after acceptance

Team Support Desk is the golden DX consumer. It replaces queue/detail request
generation guards and hand-authored Live Query state with Query Resources, then
uses `@questpie/react`. Mutation outcomes remain ordinary results; rendered
updates must arrive from a fresh watched Query result rather than echoed input.

Collaboration is the hostile consumer. It proves different Context scopes never
share, credential transition discards the old scope, authorization reset and
failure disclose no stale result, reconnect and late callbacks are contained,
rollback emits no update, and one failing subscriber does not affect another.

The discriminated reference recipe uses a message-event subject in type
evidence only. No Relation, SQL join, foreign key, Policy traversal, or Runtime
dispatch is generated from it.

## Explicit absence

No TanStack package, Suspense, SSR, hydration, global provider, mutation
invalidation metadata, optimistic update, normalized entity cache, background
refresh, cross-scope sharing, runtime fallback, polymorphic Relation,
`codec.variant`, or second realtime kernel is accepted here.
