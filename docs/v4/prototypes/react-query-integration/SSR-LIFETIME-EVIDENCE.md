# Native Start readiness and interrupted-document evidence

Research/prototype evidence, 2026-09-08. The generated candidate is
`questpie.client-projection.prototype.v3`; this is not an acceptance record, production
support declaration or beta.2 release gate. The candidate interface and its
rejected alternatives remain in [SSR-CANDIDATE.md](SSR-CANDIDATE.md).

## The boundary that is actually implemented

Each server request creates its own native QueryClient and generated scope.
`setupRouterSsrQueryIntegration` owns Query dehydration, pending-result transfer,
hydration, the React provider and its server cleanup. The original Router
hydrate callback restores the candidate identity bootstrap before native Query
data hydration. No second key registry, serializer or cache is present.

Server execution uses finite generated reads with `ssr: true`, never SSE. The
browser passes one host-owned `ready` Promise to the adapter. The host resolves
it after native hydration setup has returned, document `load` has fired, and
one task turn has passed. The candidate waits before dispatching ordinary,
forward-infinite and watchable Queries. Native hydrated cache hits remain
usable while waiting. Rejection has no timeout bypass; cancellation/retirement
cannot turn a later readiness resolution into a new dispatch.

This is execution ordering, not detection of every broken document. Upstream's
[hydrate implementation][integration] launches its reader loop without awaiting
all stream entries, and Query stream EOF can precede transferred pending Promise
settlement. The browser [load event][load] describes document/resource loading,
not successful execution of every application script. Neither is a public
all-serialization-success callback.

## Evidence and its limits

| Consumer                                | Executed result                                                                    | What it establishes                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start-upstream`                        | 6 tests / 38 assertions; strict types                                              | Published integration hooks, native pending/Date serialization, clock-skew counterexample, generated matching keys across reordered construction and request isolation. This is not a browser test.                               |
| Parent readiness/native-cache tests     | Ordinary, infinite and live readiness controls pass in the current full parent run | A held boundary prevents fresh dispatch; hydrated data remains usable; scope retirement/rejection cannot open a late watch/page. No browser claim follows from these tests alone.                                                 |
| Production-built `start-app` in Firefox | 37 assertions; build and strict types pass                                         | Finite SSR shell, streamed Suspense, native Date and interactivity, separate request bootstraps, no SSR SSE/browser one-shot refetch, two keys over one SSE, duplicate observer sharing, and `null` replacing the skewed SSR row. |
| `start-app` Firefox fault suite         | 45 assertions over four scenarios                                                  | Specific interrupted response, failed-module and navigation behavior below. The deliberate disconnect logs `TEST_SSR_CONNECTION_INTERRUPTED`; that expected injected error is not a failed assertion.                             |

The Start fixture uses real generated request/response/SSE decoding over
loopback and native production Start client/server bundles. Only the external
application Query/SSE service is synthetic. A `null` response demonstrates full
result replacement, not real PostgreSQL Policy enforcement. Two final fault
runs passed consecutively; the integrating owner also reran the current v3 build,
types, baseline and fault suites after subsequent candidate changes.

### Successful, delayed stream

The host withholds the second SSR Query until Firefox reports finite hydration.
It then withholds an image until the delayed Query is hydrated with a real Date
and working React event handler. No watch opens before the gate. Test-only
server Query snapshots have native timestamps 60 seconds ahead of the browser.
After the complete initial response, the peer delivers `null` for the first key
and a current result for the second. Both first-key components remove the old
row; the DOM stays correct through the observation window. This avoids assuming
wall-clock order is causal order.

### Faults, including the failed hypothesis

The initial hypothesis—`load` keeps execution closed whenever an SSR response
is incomplete—failed in real Firefox. The final tests pin the observed behavior:

| Fault                                                                       | Browser and transport result                                                                                                                       | Adjudication                                                                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| End the initial response after finite hydration, before the delayed payload | `load` fires; live results replace the old row with `null` and the second row with current data                                                    | Not an integrity check. Omitted bytes from the terminated response cannot arrive later; no stale resurrection was observed. |
| Error the response stream at the same point                                 | Same final UI; one SSE, no browser execution error                                                                                                 | Actual transport failure, with the same distinction between terminated delivery and later replay.                           |
| Fail application JavaScript module requests with 503                        | Static SSR HTML and resource errors; no Query or SSE executes                                                                                      | A native nonhydrated/broken page, not an adapter recovery contract.                                                         |
| Native Router navigation to `/left` while the old SSR Query is pending      | Destination stays visible after old delivery finishes; one temporary binding for exactly the streamed Query opens and closes; zero active bindings | A never-committed Suspense fetch can finish once. No orphan continuing subscription or old-route restoration was observed.  |

All four scenarios open zero SSR streams and make zero browser one-shot Query
requests. An independent fixture script reports document state even if application
modules fail; its diagnostic timer never resolves readiness. The host cancels
the upstream reader after cutting the response and releases held synthetic work
before shutdown. Firefox profiles, browser processes and loopback hosts are
cleaned after every scenario. Owned dependency installations remain available
for repeat runs.

## Reproduce

Use Bun 1.3.14 and the checked exact locks. The app pins Start 1.168.50, Router
1.170.33, React Router SSR Query 1.167.2, Query 5.102.8, React/ReactDOM 19.2.8,
Seroval 1.6.6, Vite 8.2.2 and React Vite plugin 6.1.1. The isolated installations
do not modify the repository workspace dependency tree.

Generate the parent clients serially before any consumer build; never regenerate
them while a build/tracer is consuming them. From the parent prototype:

```sh
bun run generate:proof
bun run generate:pagination
bun test hydration-identity.test.ts generated-live.test.ts infinite-query.test.ts
```

From `start-upstream`:

```sh
bun run test
bun run test:generated
bun run types:check
```

From `start-app`, the executed commands use an owned TMPDIR because the host's
system temporary filesystem has exhausted its quota:

```sh
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run build
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run types:check
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run test:browser
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run test:browser:faults
```

The exact TMPDIR is a local test resource, not a product requirement. A fresh
environment needs its own writable directory and isolated install. The Firefox
runner uses `/usr/bin/firefox` and a dynamic loopback port; it does not deploy.

## Smallest honest host preconditions

Keep one server cache per request and one browser owner per current logical
scope. Install native integration before loading/rendering. Let the native
initial document deliver or terminate before fresh generated Query execution;
do not later replay or manually hydrate that old document into the same active
cache. A login/tenant lifetime change retires the old adapter and starts a new
owner; equal Context values do not prove equal authorization. A route change
alone need not retire an owner shared by other routes.

The current evidence does not establish automatic recovery for replayed/repaired
serialization scripts, bfcache restoration, authentication-scope replacement
during the initial stream, or indefinitely held scripts/resources. Unrelated
assets can delay the first gate. No unconditional browser-failure guarantee is
claimed, and these cases do not justify a private Router completion flag, new
serializer, completion sentinel or cache timestamp fence without evidence.

Production/golden-consumer migration, remaining browser execution-mode coverage,
and the scoped acceptance/ratification process are still separate work. TanStack
DB, live infinite Queries and offline/persistence remain outside this beta.

[integration]: https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts
[load]: https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event
