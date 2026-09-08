# Start hydration without another hydration system

Proposed construction decision, 2026-09-08. The owner requires Start
SSR/hydration before beta.2. This file records the current executable candidate,
not Accepted product behavior or beta.2 completion. The current
[lifetime evidence](SSR-LIFETIME-EVIDENCE.md) separates native-cache tests from
the actual Start/Firefox consumer.

Use `setupRouterSsrQueryIntegration` and a fresh native `QueryClient` for each
server request. TanStack owns dehydration, streaming, hydration, provider
wrapping and request cleanup. Its integration calls the application's original
Router hydrate callback before hydrating Query data. The connected consumer now
uses that bootstrap seam; QUESTPIE does not add another serializer or cache.
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

## Native handover candidate and evidence

Server Query execution uses the existing one-shot call, never a continuing SSE
watch. Hydrated data stays in native Query cache. A browser observer then opens
one shared watch, whose complete authorized result replaces the server result.
No new server cursor, receipt, realtime kernel or serializer is proposed.

Delayed streamed hydration must not replace a newer live result. Query 5.102.8
compares hydration timestamps, not causal generations; its source therefore
does not establish safety under server/browser clock skew. The upstream probe
reproduces an older server result restoring an omitted field after a newer
result. The connected Firefox consumer instead holds fresh execution until
initial delivery ends, then replaces a +60-second-skewed SSR row with `null`.
Both components observing that key lose the old row. Consume native initial
hydration before fresh execution instead of inventing cross-process timestamp
order.
Source: [published Query 5.102.8][query], `package/src/hydration.ts`.

The published integration has no public all-streamed-Queries-settled client
callback. Its hydrate callback starts a stream reader without awaiting it, and
stream EOF may precede transferred pending Promise settlement. The candidate
therefore uses a host-owned first-document readiness Promise:
native hydrate setup has returned, the browser document has loaded, and a task
boundary has drained already-queued hydration work. The optional adapter waits
for that `ready` Promise before dispatching a Query, consumes cancellation while
waiting, and never uses a timeout to bypass a failed barrier. SSR uses one-shot
reads and does not wait for browser readiness. Ordinary native hydrated data
remains visible while the live handover waits.

This deliberately delays fresh execution behind unrelated page assets. It uses
public browser lifecycle, but `load` is not a document-integrity or successful
script-execution signal. Actual Firefox fault tests confirm that both clean
truncation and a failed response stream can reach `load` and permit execution.
The terminated response cannot deliver its omitted bytes later; current live
results replace the old rows without observed resurrection. Failed application
modules leave static SSR HTML with no framework execution. These results narrow
the claim rather than justify a private completion flag or second deserializer.

The successful-document Firefox checkpoint now passes. Independent review
identified the same ordering obligation for newer ordinary and infinite
one-shot browser reads. The candidate now extends that one boundary to every Query
execution, not just watch opening: delayed native hydration must finish before
a newer generated request can publish. Native hydrated cache hits still need
no request. The proof-only option is `ready`, since the boundary is no longer
live-specific; the old spelling has no alias. Focused tests establish ordinary,
infinite and live readiness ordering, rejection and retirement without late
dispatch. This is a candidate correction, not a second hydration implementation.

The actual native Router navigation test now leaves the pending Query route,
finishes the old SSR response, and keeps the destination visible. A
never-committed Suspense fetch performs one temporary first-result binding after
readiness and closes it; zero active bindings remain. Do not promise that route
navigation eliminates every native speculative fetch. A shared owner is not
disposed merely because one route unmounts.

Completed evidence includes request-local bootstraps, reordered options/native
key hits, native Date serialization, finite and streamed Suspense rendering,
shared watch ownership, full-result replacement, the four browser faults, and
native-cache forward infinite/readiness controls. It does not make native-cache
tests into browser proof for every execution mode.

Remaining R1/R2/SSR1 work includes the production/golden consumer, actual
credential-scope change during an initial stream, and browser coverage of any
remaining claimed execution modes. Replayed or manually repaired serialization
scripts, bfcache restoration and indefinitely held resources are not established
as automatically recovered. Keep these limitations explicit through review and
ratification. Optional DB, live infinite and offline persistence remain outside
beta.2.

[guide]: https://raw.githubusercontent.com/TanStack/router/main/docs/router/integrations/query.md
[integration]: https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts
[query]: https://registry.npmjs.org/@tanstack/query-core/-/query-core-5.102.8.tgz
