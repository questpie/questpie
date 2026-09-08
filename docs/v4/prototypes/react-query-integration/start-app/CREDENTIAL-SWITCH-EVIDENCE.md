# Credential replacement during native SSR delivery

Research consumer, not a production authentication implementation or acceptance
record. `test:browser:credentials` runs the production-built Start app in real
Firefox with generated Query, Mutation and SSE transports.

The host creates two random synthetic session values in memory. It sets an
HttpOnly cookie, forwards the incoming cookie only to the same-origin synthetic
peer for server reads, then replaces the browser cookie during the test. Session
values are never written to files or included in reports. The peer rejects
missing fixture sessions. This is controlled authentication evidence, not a
Better Auth or PostgreSQL Policy test.

## Executed sequence

1. Native SSR renders the old finite Query and holds a second streamed Query.
2. Firefox hydrates the finite result and displays a completed old Mutation.
   A second old Mutation is dispatched, but its successful response is held.
3. The host changes the HttpOnly cookie. The application stops rendering its
   old pending Suspense subtree, disposes the old adapter, and verifies that
   still-mounted captured Query/Mutation hooks no longer expose their data or
   pending Mutation variables. A Query may render native pending or error state
   during retirement; the guarantee is removal of its old data, not one label.
4. Retained old Query and Mutation options reject without transport. A fresh
   adapter uses exactly the same native QueryClient and Context, but a different
   scope key and the replacement cookie.
5. The host releases both old SSR and Mutation responses. The new Query shows
   only the replacement credential's result. The old Mutation promise reports
   a retired **committed** outcome without publishing its result to old hooks.
6. After the initial stream finishes, the retired prefix contains no result
   data, and retained old streamed Query options cannot read a native hydrated
   cache hit. The new scope remains unaffected.

The tracer passes 26 assertions. It checks equal decoded Context across old
HTTP calls and new SSE commands, inaccessible HttpOnly cookie values, two old
SSR reads, exactly two already-dispatched old Mutations, no new/retained old
Mutation dispatch, no browser one-shot read, zero SSR SSE, one new live binding,
cleared old UI/cache data and late-outcome preservation.

## Defect pulled by the consumer

The first real browser run isolated the new UI correctly but found one old
streamed result reintroduced into the shared cache after retirement. Native
hydration can bypass a retired Query function by creating or updating its cache
entry. A fresh cache hit through retained options could therefore return old
data without invoking the guarded function. The explicit cache assertion failed
with `1 !== 0`.

The main adapter repair guards added/updated native Query entries for only the
retired prefix while the existing first-document readiness Promise is pending.
It clears/removes late hydration and detaches when readiness settles. The
browser now observes zero retired-prefix results and rejection of the old
streamed options after actual pending SSR delivery completes. TanStack still
owns the serializer, stream and cache. No new hydration protocol was added.

The fixture also exposed a host ownership obligation: continuing to render a
component that calls the retired adapter's options factory invokes its explicit
retirement error. The app removes its old pending Suspense subtree at the auth
boundary; captured old hooks stay mounted long enough to prove their state is
cleared. Production hosts should replace the identity-owned subtree, not keep
constructing new operations from the retired owner.

## Run and limits

From `start-app`, with parent generated outputs already prepared and frozen:

```sh
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run build
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run types:check
env TMPDIR=/home/drepkovsky/code/questpie-start-app-deps.l4qGoC bun run test:browser:credentials
```

The same build retains the 37-assertion ordinary handover and 45-assertion fault
tracers. Browser profiles, browser processes and dynamic loopback hosts are
removed/stopped after every run. The task-owned dependency installation remains
available for reruns. Nothing is deployed or committed by this consumer task.

Already-disclosed data cannot be recalled: old SSR bytes may have reached the
browser, and application-held references, copied values or already-running
callbacks are not erased by adapter disposal. This proof concerns owned Query
and Mutation state, transport lifetime and cross-scope publication. It does not
claim reversal of a committed write, memory erasure, backend session revocation,
or recovery from arbitrary script replay, bfcache or a never-settling document.
