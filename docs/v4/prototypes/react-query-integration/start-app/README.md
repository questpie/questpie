# Actual Start SSR and Firefox tracer

This runnable research app connects the candidate generated QUESTPIE Query
adapter to a production TanStack Start build and real Firefox hydration. It is
not the release reference application or an acceptance record.

The app uses the standard `getRouter()` request factory,
`setupRouterSsrQueryIntegration`, Router dehydrate/hydrate hooks, a finite
`ensureQueryData` loader, and a `useSuspenseQuery` started during server render.
TanStack owns HTML streaming, Query dehydration, pending-result transfer and
Date serialization. QUESTPIE supplies generated transport/options and its
candidate identity bootstrap. No custom hydration or result cache is present.

## Run

Prepare the parent prototype's dependencies and generated client once with its
`bun run generate:proof`. Do not run parent generation concurrently with this
app's build. Install this directory's exact lock in an isolated dependency
directory; its recorded `node_modules` points to that owned installation, not
the repository workspace install.

From this directory:

```sh
bun run build
bun run types:check
bun run test:browser
bun run test:browser:faults
bun run test:browser:credentials
```

The recorded runs use Bun 1.3.14, `/usr/bin/firefox`, and a writable task-owned
`TMPDIR` under `/home/drepkovsky/code`, because the host's `/tmp` quota is full.
`test:browser` imports the production Start server entry, serves generated static
assets on a dynamic loopback port, launches an isolated Firefox profile, and
removes that profile and stops the host/browser afterward. It does not deploy.
The synthetic Query/SSE peer and completion-report endpoints belong to the
automated tracer host; plain `bun run dev` does not provide that peer.

## Executed evidence

The production client/server build and strict TypeScript pass. The Firefox
tracer passes 37 assertions:

- The first HTTP chunk contains the finite result and a Suspense placeholder,
  without the delayed result; later chunks contain that result and timestamp.
- Separate SSR requests produce different identity bootstraps.
- Real browser hydration preserves `Date`, the streamed Query title and exact
  timestamp, and holds two native Query cache entries.
- A DOM button click reaches its React handler after hydration.
- Hydration makes zero extra browser Query calls. Native pending Query transfer
  provides the streamed result.
- Browser execution/recoverable hydration errors are reported as failures.
- Watchable Queries use finite reads on the server and open zero SSR streams.
- The host holds the delayed Query until Firefox reports finite hydration;
  it then holds an image response until the streamed Query is hydrated and
  interactive. No browser watch opens before the native hydration setup,
  complete SSR response, and document-load barrier have finished.
- Two distinct active Query keys share one SSE carrier. A second component
  observing the first key does not create another binding.
- The live peer replaces the first result with `null` and the second with a
  current result. Both first-key components lose the old row; the second shows
  the current title. The DOM remains correct after a 250 ms observation window.
- SSR snapshots deliberately carry native `dataUpdatedAt` values 60 seconds
  ahead of the browser clock. They finish before live activation, so this
  successful stream cannot later resurrect the removed row.

The external Query/realtime service is the only substituted application
boundary. The generated client constructs and decodes its real HTTP/SSE
contract across loopback, including the exact JSON response content type. Its
Task source is the parent's production-rendered normalized IR, not a
PostgreSQL application. The peer's `null` delivery demonstrates full result
replacement, not actual Policy enforcement. No Mutation, authentication,
tenant Policy or database claim follows from these assertions.

The candidate first-document gate uses public lifecycle only: the wrapped
native Router hydrate callback has returned, `window.load` has fired, and one
browser task boundary has passed. The wrapper does not replace native
hydration. This is a conservative successful-document proof: unrelated assets
can delay live activation. `load` is not a promise that every script executed
successfully. The fault tracer below establishes specific interrupted-document
and navigation behavior, not every React or script failure mode. No private
Router globals, custom serializer, second cache, or adapter timestamp
manipulation is used.

## Interrupted document and navigation evidence

`test:browser:faults` runs four real Firefox scenarios against the same built
Start application, with 45 assertions across the four scenarios. Two consecutive
final runs passed alongside the original 37-assertion tracer, build, strict
typecheck, lint, formatting and `git diff --check`. The fault host changes transport behavior, not TanStack
hydration internals. A separate fixture script reports document state even when
application modules cannot load; its reporting timer never releases adapter
readiness.

| Fault                                                                                                        | Observed result                                                                                        | Meaning                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cleanly end HTML after finite hydration, before the delayed SSR payload                                      | `load` fires; one SSE starts; the finite row becomes `null`, the other becomes the current live result | Readiness is not a document-integrity check. The terminated response cannot later deliver omitted stale bytes.                                                                |
| Error the response stream at the same point                                                                  | Same final UI and live behavior; the host logs the deliberate `TEST_SSR_CONNECTION_INTERRUPTED` error  | This is an actual interrupted response, not only an omitted closing tag. No stale resurrection was observed.                                                                  |
| Return 503 for application JavaScript modules                                                                | Static SSR HTML remains, resource errors are observed, no framework Query or SSE executes              | An upstream nonhydrated page, not a new framework recovery guarantee.                                                                                                         |
| Navigate through the native Router to `/left` while the SSR Query is pending, then finish the old SSR stream | Destination remains visible; old Query components are absent; zero active bindings remain              | A never-committed Suspense fetch opens one temporary first-result binding after readiness, then closes it. Navigation does not imply no speculative Query work ever occurred. |

All scenarios preserve zero SSR streams and zero browser one-shot Query calls.
The interrupted responses still use the test-only +60 second server timestamps.
The original hypothesis that `load` would prevent all execution after truncation
failed; these assertions instead pin the actual behavior and distinguish it from
stale publication. The normal 37-assertion tracer separately proves delayed
intact SSR bytes finish before fresh live replacement.

The smallest supported preconditions remain ordinary native Start ownership:
one request-local server QueryClient, one browser owner for the current logical
scope, standard integration installed before loading/rendering, and a first
document boundary before fresh browser execution. The host must not replay or
manually hydrate old document snapshots after that boundary. A new login or
tenant lifetime must retire the old adapter; a route change alone need not
retire an owner shared by other routes. Observed native speculative work may
finish once and close when it has no active observers.

The separate [credential-switch consumer](CREDENTIAL-SWITCH-EVIDENCE.md) now
covers replacement of synthetic HttpOnly credentials during the initial stream,
equal-Context/new-owner isolation, mounted state retirement and late SSR/Mutation
delivery. Its 26 browser assertions pulled a narrow retired-prefix hydration
guard in the main candidate adapter.

This does not establish replayed/repaired serialization scripts, bfcache
restoration, production authentication integration, or an indefinitely
held script/resource. Those must not be advertised as automatically recovered.
No completion sentinel, private Router flag, custom serializer, or global cache
timestamp fence is justified by these counterexamples.

The source explains the distinction: the native [Query integration's hydrate
callback](https://github.com/TanStack/router/blob/main/packages/router-ssr-query-core/src/index.ts)
launches its stream reader without awaiting the complete loop, whereas the
browser [load event](https://developer.mozilla.org/en-US/docs/Web/API/Window/load_event)
describes the document/resource loading lifecycle. Neither API declares
successful application execution. The test host cancels its upstream reader
after cutting the response and releases held synthetic work before shutdown;
each browser uses a fresh profile that is removed afterward.

Two construction failures were informative: an incomplete fake peer response
failed the generated protocol decoder, and Bun's default user agent caused
Start's bot path to wait for all results. The streaming HTTP probe now sends a
browser user agent; the real Firefox request supplies its own. No framework
fallback or SSR suppression was added.

## Versions and layout

Start 1.168.50, Router 1.170.33, React Router SSR Query 1.167.2, Query 5.102.8,
React/ReactDOM 19.2.8, Vite 8.2.2 and React Vite plugin 6.1.1 are pinned in the
private package and lock. Seroval 1.6.6 matches the upstream integration probe.

`src/data/questpie.ts` owns the per-request adapter and generated transport;
`src/router.tsx` owns native integration; `src/routes` owns the page and document
shell; `src/client.tsx` owns normal React hydration plus tracer error reporting.
`src/tracer/scenario.ts` owns the test-only clock skew and document-ready gate;
`tracer-peer.ts` owns synthetic Query/SSE responses; `tracer.ts` owns loopback
hosting, browser control and assertions; `tracer-faults.ts` owns deliberate
transport faults and independent document observation. Generated
route trees and build output stay ignored.

This follows the [official Start setup](https://tanstack.com/start/latest/docs/framework/react/build-from-scratch)
and [native Query integration](https://tanstack.com/router/latest/docs/integrations/query).
The earlier [upstream probe](../start-upstream/EVIDENCE.md) records the exact
published owners and the ungated skewed-clock counterexample.
