# Start hydration without another hydration system

Proposed construction decision, 2026-09-08. The owner requires Start
SSR/hydration before beta.2. This file selects the next executable experiment,
not accepted product behavior.

Use `setupRouterSsrQueryIntegration` and a fresh native `QueryClient` for each
server request. TanStack owns dehydration, streaming, hydration, provider
wrapping and request cleanup. Its integration calls the application's original
Router hydrate callback before hydrating Query data. That is the bootstrap seam
to test; QUESTPIE does not need another serializer or cache.
Sources: [official integration guide][guide], [integration source][integration].

The preceding generated adapter missed hydrated data because it created random
scope/binding IDs and input ordinals independently in each process. The
[executed diagnostic](diagnose-hydration.ts) demonstrates that miss between
independent bindings. The [identity checkpoint](IDENTITY-EVIDENCE.md) now proves
an explicit bootstrap repair. Native hydration was not the defect.

## Computed identity candidate

Compare two ways to preserve the existing absence of raw Context/input in keys:

1. Transfer the input-to-ordinal registry. This preserves current keys but
   retains abandoned options, requires serializing another registry, and makes
   server/browser construction order part of correctness. Reject it.
2. Transfer one request-local fingerprint seed and compute keys from generated
   contract identity, canonical Context, Operation, ordinary/infinite mode and
   canonical input. Prefer this: there is no input registry and no new authored
   DTO or key mapping. Browser-only scopes create their own fresh seed.

The seed is client-visible bootstrap material, not a deployment secret or
authorization token. The server passes it only in that response's ordinary
Router dehydration payload. Keep it out of Query keys, logging and persistence.
It protects neither same-realm JavaScript nor a reader of that HTML. Possession
never replaces Policy checks. A plain public hash/salt must not be described as
dictionary-resistant; a server-only signing key cannot compute future browser
keys without an unwanted new endpoint.

Use the synchronous HMAC dependency already investigated in
[the fingerprint research](FINGERPRINT-RESEARCH.md), but explicitly replace that
note's browser-only, never-serialized seed assumption for this experiment.
Measure the actual browser increment before selecting production dependency
placement. No hand-written cryptography.

An explicit resume must bind to the same generated contract and canonical
Context, and may be consumed by only one active owner in a QueryClient. Default
bindings remain independent. A different authentication lifetime must retire
the old owner and create new material; matching Context values alone do not
prove matching credentials. No persistent/global server QueryClient is allowed.
The current experiment enforces concurrent ownership within one integration
instance. It does not add cross-bundle global state: resuming the same bootstrap
from separate adapter copies into one QueryClient is unsupported.

## Native handover to test

Server Query execution uses the existing one-shot call, never a continuing SSE
watch. Hydrated data stays in native Query cache. A browser observer then opens
one shared watch, whose complete authorized result replaces the server result.
No new server cursor, receipt, realtime kernel or serializer is proposed.

Delayed streamed hydration must not replace a newer live result. Query 5.102.8
compares hydration timestamps, not causal generations; its source therefore
does not establish safety under server/browser clock skew. The test must send
an older server result with a later wall-clock timestamp after a live result
that removes a protected field. Prefer consuming the native pending/success
hydration before live activation over inventing cross-process timestamp order.
Source: [published Query 5.102.8][query], `package/src/hydration.ts`.

The published integration has no public all-streamed-Queries-settled client
callback. Its hydrate callback starts a stream reader without awaiting it, and
stream EOF may precede transferred pending Promise settlement. The next
experiment therefore uses a host-owned first-document readiness Promise:
native hydrate setup has returned, the browser document has loaded, and a task
boundary has drained already-queued hydration work. The optional adapter waits
for that `liveReady` Promise before opening a watch, consumes cancellation while
waiting, and never uses a timeout to bypass a failed barrier. SSR uses one-shot
reads and does not wait for browser readiness. Ordinary native hydrated data
remains visible while the live handover waits.

This deliberately delays initial live activation behind unrelated page assets.
It is a supported browser-lifecycle experiment, not proof that `load` covers
every failed-script or truncated-response case. The actual browser tracer must
establish the supported handover conditions before this becomes public behavior.
Do not inspect private Router bootstrap globals or implement a second stream
deserializer to avoid that test.

The tracer must cover simultaneous users, matching keys despite reordered
options construction, decoded Date round trips through Start's serializer,
forward infinite pages, streamed Suspense, a single browser watch, credential
switch and aborted SSR cleanup. Native-cache tests are not real-browser proof.
These are explicit R1/R2/SSR1 blockers; optional DB, live infinite and offline
persistence are outside beta.2.

[guide]: https://raw.githubusercontent.com/TanStack/router/main/docs/router/integrations/query.md
[integration]: https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts
[query]: https://registry.npmjs.org/@tanstack/query-core/-/query-core-5.102.8.tgz
