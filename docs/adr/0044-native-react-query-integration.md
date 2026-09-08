# ADR-0044: Native React Query integration

- Status: Accepted
- Date: 2026-09-08

## Context

The owner requires native TanStack Query, Suspense, forward infinite Queries,
safe credential/Context lifetime and TanStack Start SSR/hydration before beta.2.
ADR-0035's thin React hook intentionally supplies none of those native options.
Applications would otherwise build another integration around the generated
client, repeating keys, codecs and lifetime rules.

The [confirmed scope cut](../v4/research/react-tanstack-integration-2026-09-08/BETA2-SCOPE-DECISION.md)
keeps optimistic intent in userland. Framework-owned layers, rollback/rebase,
TanStack DB, live infinite lists, offline/persistence and causal
commit-to-observation guarantees are not part of this beta.

This decision does not change server execution or reopen lifecycle design.
Its construction evidence lives in
`docs/v4/prototypes/react-query-integration`; that prototype is not the public
package. The committed [review record](../v4/prototypes/react-query-integration/REVIEW.json)
verifies PASS. Production extraction and release gates remain pending.

## Decision

Expose one optional `createQueryAdapter` factory from `questpie/react-query`.
It binds a generated Context scope to a host-owned native QueryClient. The
generated scope supplies exact Query, Mutation, codec, declared-error and
compiler-proven forward-page information through a fixed internal capability.
Applications author no descriptor, endpoint registry, DTO or key map. There is
no generated sibling adapter import or public descriptor getter.

The capability is compatibility plumbing, not a security boundary against
same-realm JavaScript or a provider SPI. It must work across independently
bundled generated clients and adapters without a shared module-instance
registry. An incompatible version fails closed; there is no old-version path.

Each Query offers native `options(input)` and error narrowing. Only a
compiler-proven root forward-cursor Query also offers `infiniteOptions(input)`;
the compiler supplies its cursor parameter and continuation rule. A result
that merely looks like a page is insufficient. Ordinary and infinite cache
identities remain disjoint. Native selectors, enabled state, Suspense and
forward pagination consume these options without a second hook catalogue.

Each Mutation offers native `options()` and declared-error narrowing. Every
invocation gets its own Call Identity. Retrying a domain command or deduplicating
an application nonce is not inferred from reusing the variables object.
Native error types remain `unknown` until narrowed: transport failure is not a
declared Operation error. Application callbacks, including inferred `onMutate`
context, remain native TanStack behavior.

Generated transport functions, key identity, pagination continuation and retry
defaults are integration-owned options. Replacing them or manually restoring
protected cache state is application code outside these guarantees. This does
not claim that a plain TypeScript options object prevents arbitrary mutation.

### One cache and the existing watch

TanStack owns this adapter's cache, observers, native fetch state and React
integration. QUESTPIE owns codec-derived identity, scoped lifetime and use of
the existing generated transport. A browser ordinary watchable Query resolves
its finite fetch at the first snapshot and shares one watch among active
observers. Later deliveries replace the complete result, including omission
of a row or Field. No normalization, patch merge or second realtime kernel is
introduced. Infinite Queries are one-shot page fetches, not live page unions.

Native cache removal, last active observer and scope retirement release watch
ownership. Generated carrier reconnection remains the only reconnect owner.
Terminal watch failure clears retained native data and fences old options.
Native status is not a new promise of Query Resource connection/delivery metadata.
Independent Queries do not become an atomic composite view.

Keep ADR-0035's framework-neutral `.observe` and Query Resource contract for its
existing non-React consumers. Do not put Query Resource between the native cache
and `.watch`. An application chooses one owner for a displayed result; it must
not create both merely to feed one into the other.

### Scope retirement and initial hydration

The host creates a fresh generated scope and retires the old adapter when its
credential or Context lifetime changes. Equal Context input does not imply
equal credentials. QUESTPIE does not inspect cookies or infer an Auth lifecycle.
Default scoped owners do not share keys. Rebinding the same scope/QueryClient
pair is idempotent; conflicting binding options fail closed.

Options capture canonical codec input without starting transport or retaining
an input registry. Public keys contain scoped fingerprints, Operation identity
and execution mode, not raw Context/input or credentials. SSR transfers one
request-local identity bootstrap through the host's ordinary hydration payload.
That client-visible seed is not authorization, a deployment secret or protection
against a reader of the HTML. Do not log or persist it as an authentication token.

Server rendering uses a fresh per-request QueryClient and finite generated
calls, never a continuing SSE subscription. TanStack Start's official Router
Query integration owns serialization, pending Query streaming, hydration and
provider composition. The adapter's `dehydrate()` returns only identity
bootstrap, not another Query cache serialization.

The browser host supplies the existing first-document readiness Promise before
fresh ordinary, infinite or live execution. It accounts for native hydration
setup, document load and queued hydration work. No timeout bypass or second
deserializer is added. Hydrated results can render while fresh execution waits.
This ordering delays execution behind unrelated assets; document load does not
prove document integrity. Failed scripts, interrupted streams and navigation
must be tested, not relabelled successful hydration.

Disposal terminally fences retained options, cancels Query work, stops watches
and clears attached Query/Mutation state for that owner. A late Mutation result
cannot republish protected data. A scope retired during initial streaming must
also reject late native hydration under its old keys: a cache hit must not
bypass the retired query function. Any temporary cache guard ends at the owned
initial-delivery boundary; it adds no transport, poller or serializer.

An adapter-local `SCOPE_RETIRED` Mutation failure preserves the disposition:
not dispatched, committed, rejected, or unknown. After dispatch it retains the
Call Identity and, only when supplied by the correlated validated decoder, the
Transaction Identity. It exposes no suppressed domain result, error payload or
underlying cause. A validated success remains a known commit after retirement;
a declared rejection stays rejected; an unproven transport outcome stays
unknown. Disposal neither cancels nor replays an already-dispatched write.
An application callback failure is not evidence of rollback.

Already-disclosed application copies and already-running native callbacks
cannot be erased or cancelled by disposal. The host removes the old
credential subtree rather than continuing to call its retired factories.
Manually replayed hydration, persistence restore and bfcache recovery are not
automatic recovery guarantees in this beta.

### Commit outcome is not Query freshness

Successful decoded local Mutations and decoder-proven, correlated
`COMMITTED_RESULT_UNAVAILABLE` trigger conservative invalidation. The compiler
does not currently establish arbitrary handler write-sets. Derive a shared
superset from every public Query family, including possible opaque dependencies;
emit no private Policy graph and require no authored invalidation maps.

Within the binding, cancel older matching non-live reads, mark their cache
entries stale and refetch active native Queries. Ordinary browser-live families
are excluded, including inactive hydrated entries; existing watches or their
next activation own fresh results. Infinite and server modes remain one-shot
targets. Native disabled/static semantics remain native. This may refetch more
families than necessary; it is not precise dependency inference.

Query refresh failure cannot replace a Mutation result or relabel commit as
rollback. Declared rejection, unknown transport outcome and fabricated error
objects are not commit evidence. Scope retirement and later commits fence older
refreshes. No automatic Mutation retry or cross-view observation receipt is
added. Remote writes, other bindings and later Job effects need their existing
watch or explicit application refresh policy.

Ship a typed native pending-intent recipe alongside this interface. It renders
pending intent separately from the current successful authorized result and
hides it when that result disappears or fails. It never restores a saved whole
cache after error. Native Mutation completion may precede the next snapshot;
temporary visual reversion is not prohibited by a no-flicker guarantee.

### Packaging and migration

Keep exactly two npm packages: `questpie` and `questpie-opentelemetry`.
`questpie/react-query` is an optional export, not a third package. Core and
generated clients must remain React/TanStack-runtime-free. The supplied native
QueryClient and consuming React hooks require compatible dependencies; a
type-only peer import does not imply that importing the factory alone fails
when React is absent. Exact peer metadata and packed-consumer checks are
production gates, not inferred from the prototype install.

The candidate uses `@noble/hashes` for synchronous cache fingerprints. Package
that implementation dependency inside `questpie`'s optional adapter build;
do not add a third public package or a new caller-authored peer. Root and
generated-client imports do not reach it. The production relocation gate must
verify the packed adapter and a separate core-only install/import/build, not
infer isolation from a successful prototype install.

Migrate Team Support Desk to the native factory with credential-owned cache and
provider lifetime. Then delete `questpie/react`, `useQueryResource` and their
obsolete hook tests; retain the neutral Query Resource implementation and its
non-React evidence. Add no forwarding export or legacy-name fallback.
Replace prototype string instrumentation with compiler-owned rendering, then
delete generated sibling adapters and duplicate prototype algorithms/tests
after their production consumers pass. Preserve historical evidence.

## Supersession and acceptance

This decision supersedes only ADR-0035's React recommendation,
React-adapter exclusions of TanStack/Suspense/SSR and non-live invalidation,
and ADR-0042's old React subpath/peer clauses. It preserves framework-neutral
Query Resource, two-package identity, Policy, server Query/Mutation ordering,
Change Ledger, Operation Wire, Call Identity and post-commit outcomes.

Required evidence includes public-factory inference and bundle isolation,
native ordinary/Suspense/infinite behavior, credential-switch during streamed
SSR, real PostgreSQL Policy omission/reconnect and distinct-family invalidation.
The existing kernel proofs remain controls rather than being reimplemented.
Review the narrow superseding public architecture through the repository's
manifest-bound acceptance protocol after deterministic candidate gates pass.

The manifest-bound Opus review returned PASS; its committed record passes
`review:accept:verify`. Authority projection is separate from that record and
from production extraction. Public examples, agent skills, packed consumers
and the complete release gates must follow the production migration.
ADR-0039's aggregate acceptance remains separate. No decision or PASS here
authorizes tag creation, publication or registry deprecation.
