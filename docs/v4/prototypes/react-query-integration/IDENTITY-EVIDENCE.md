# Shared SSR identity and execution-owned live work

This Proposed checkpoint replaces the prototype's ordinal input registry with
computed keys and connects those keys to native hydration. It does not accept
the complete React integration or release beta.2.

The generated sibling accepts optional bootstrap material and an explicit
proof-only `ssr: true` mode. `adapter.dehydrate()` returns only that bootstrap;
TanStack still owns all Query-data dehydration. The bootstrap contains a version,
a client-visible random fingerprint seed and a scope fingerprint. Generated
application/contract identities and codec-canonical Context bind that scope.
Operation identity, ordinary/infinite mode and canonical input determine the
remaining key. No raw Context/input or seed appears in a Query key.

Different default bindings remain independent. An explicit resume verifies the
Context/contract binding before native hydration can find its data. Within one
adapter integration instance, a different generated scope cannot concurrently
consume the same bootstrap in one QueryClient. Same-scope rebinding remains
idempotent. This does not establish equivalent credentials: changing the
authentication lifetime requires retirement and fresh bootstrap material.
Separate adapter bundles must not resume the same bootstrap into one cache;
the owner index is intentionally module-local, not a global registry.

## Executed boundaries

`bun run test:hydration-identity` passes three tests / 11 assertions. The first
test failed before the bootstrap interface existed. Native hydration now finds
the server result even when the browser constructs options in the opposite
order. Different Context and conflicting active owner cases fail before use.
The abandoned-options test then failed at the old 128-capture ceiling; removing
the input registry made 1,000 unused ordinary options pass without creating a
native cache entry.

`bun run test:live` passes nine tests / 37 assertions. An additional 1,000 unused
live options open no transport or cache entries. An SSR loader makes one
generated one-shot request and opens no SSE stream. An active observer over
already hydrated data opens one shared watch without another one-shot request.
Native cache eviction releases work but permits reusable options to fetch again.
These tests substitute only the external generated transport peer.

The optional host-owned `liveReady` Promise defers watch activation while
hydrated data stays readable. A rejected gate or disposal while waiting opens
no late watch; there is no timeout bypass. The prototype projection version is
now v2. Its regression rejects the replaced v1 ordinal contract instead of
supporting a second identity path.

Independent adversarial review found one regression: a second equivalent
options object created before denial could open a new watch after the first
options object was retired. The added assertion reproduced that defect. A
terminal removal now retains an opaque-key retirement marker; normal eviction
detaches and deletes live work. The original hostile now returns
`SCOPE_RETIRED` for both references and opens only one watch. Finding-only
re-review and the independent test rerun found no remaining new finding.

The [native Router probe](start-upstream/EVIDENCE.md) connects the generated
bootstrap through actual Router hooks and its emitted Date-preserving
serializer. The [Start app](start-app/README.md) adds a production Start build
and real Firefox hydration. Its 37-assertion tracer passes twice consecutively:
two active Query keys share one SSE carrier, duplicate observers share their
binding, and a live `null` removes the SSR row after a delayed stream with the
server clock 60 seconds ahead. That successful-document handover is not proof
of failed scripts, truncated streams, navigation races or PostgreSQL Policy.

## Ownership cost and remaining work

Options creation canonicalizes and fingerprints its input; the returned
function owns its capture only while reachable. Live state is created on
execution and follows native Query cache lifetime. Failed-query markers retain
only opaque keys until adapter disposal. Their count is proportional to distinct
terminally failed Query keys, not a proved fixed memory bound. Removing them
earlier would lose permanent per-Query retirement; this checkpoint does not
silently replace that behavior with whole-adapter failure.

The optional adapter uses exact `@noble/hashes` 2.4.0; the generated core client
still bundles without React, TanStack or this hashing runtime. A local Bun
browser build of the complete candidate adapter measured 14,164 minified bytes
and 5,898 gzip bytes. This is a construction measurement, not a release budget
or browser latency measurement. No custom cryptography or serializer was added.

Affected generated, native React, infinite and renamed-cursor controls and
strict type projects pass. Repository formatting, zero-warning lint and
`git diff --check` pass. The combined parent controls pass 42 tests / 163
assertions, excluding the separate renamed-cursor consumer; the upstream
consumers pass six tests / 38 assertions. A repeat without the task-owned
`TMPDIR` hit the host's existing `/tmp` quota during compiler evaluation; the
same suite passed with the writable isolated directory. No product code changed
to bypass that failure.

Pending Mutation retirement, failed/interrupted hydration, complete lifecycle
budgets and PostgreSQL causal observation remain open; no R1/R2/SSR1 slice is
marked complete here.

## Independent review

An independent Codex Standards/Spec review found no blocker to this documented
limited checkpoint. It reran the six upstream tests / 38 assertions, the actual
37-assertion Firefox tracer, and `git diff --check`, then cleaned its browser
profile, host and temporary directory. This is ordinary review, not formal
architecture acceptance.

The review retains three release blockers: failed/interrupted hydration and
navigation; delayed SSR payloads racing newer ordinary or infinite one-shot
requests (the current gate covers watch activation only); and explicit adapter
retirement during credential changes or request abort. Native Query cache
cleanup alone does not prove all three. These are the next focused tests, not
reasons to replace TanStack's hydration system.
