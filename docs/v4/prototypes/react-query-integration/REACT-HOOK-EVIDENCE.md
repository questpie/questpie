# Native React hook evidence

This checkpoint tests the Proposed generated adapter with React 19.2.8 and
TanStack React Query 5.102.8. It does not accept a public React integration.
All transport responses come from an external Fetch peer, not PostgreSQL.

## What changed

The first strict hook consumer failed: the adapter returned the broad
`QueryObserverOptions` type, whose optional query function permits `skipToken`.
Suspense rejects that type, even though the generated function never returns a
skip token. `useQueries` also failed inference through the broad callback types.
The candidate now exposes only the concrete properties it produces, including
a required `QueryFunction`. Runtime execution is unchanged.

[The compile consumer](react-consumer.types.ts) now uses `useQuery`, `useMutation`,
`useQueries`, `useSuspenseQuery`, `useSuspenseQueries` and a selector without
handwritten result DTOs or casts. Negative checks reject string timestamps,
incorrect selector outputs and string Mutation versions.

Native TanStack Query defaults hook errors to `Error`; a key tagged with
`unknown` does not make every hook infer `unknown`. The adapter must not claim
otherwise or globally change the application's TanStack types. An isolated
[application configuration consumer](react-errors.types.ts) checks native
`Register.defaultError: unknown` and generated declared-error narrowing. It
does not introduce an error wrapper. Cache key error tags and Mutation option
types remain `unknown`; arbitrary transport failures remain possible at runtime.

## Executed React consumers

The two [server-render tests](react-suspense.test.ts) execute real React Suspense.
A page shell streams its fallback before the response arrives; the resolved
fragment renders a codec-decoded `Date`. A second consumer renders two distinct
Queries through `useSuspenseQueries`. The initial fixture put Suspense alone at
the root and timed out waiting for a shell; adding the page shell fixed that
fixture assumption. These tests do not dehydrate or hydrate a cache.

The two [DOM tests](react-dom.test.ts) run ReactDOM in jsdom 27.4.0. StrictMode
mounts native Query and Mutation hooks, renders a selector and submits one
Mutation. Scope disposal removes protected Query data on the first notification;
the retained observer can briefly show pending state while rebuilding its
removed Query. The next notification reports `SCOPE_RETIRED`, without another
HTTP request. The Suspense consumer moves from protected Query data to its error
boundary. Both tests unmount and dispose their scopes, caches and DOM hosts.

This is not complete authorization retirement: the completed Mutation result
remains in native Mutation state after disposal. Pending Mutation completion,
error-boundary reset, abandoned Suspense renders and live StrictMode remounts
remain separate obligations. No claim of server Policy enforcement follows
from this synthetic peer.

The expect MCP is unavailable. The installed browser runtime reported no
browser, and its browser list was empty. Consequently this checkpoint has no
real-browser result. jsdom is not a substitute for that release gate.

## Reproduction

From this prototype directory, with its pinned dependencies installed:

```sh
bun run test:react
bun run test:generated
bun run test:live
bun run test
bun run types:generated
bun run types:react-errors
bun run types:generation
bun run types:check
bun run tsc --version
```

The runtime suites pass 27 tests with 102 assertions: 23 existing tests with
86 assertions and four React tests with 16 assertions. All four strict
TypeScript projects pass with TypeScript 6.0.2. Server and DOM tests run in
separate processes so the DOM environment cannot contaminate SSR evidence.
Dependencies are isolated to this private prototype; no production package
or export changes.

The [compatibility audit](TANSTACK-COMPATIBILITY.md) still blocks a full Start
claim: independently created server/browser scopes have different cache keys.
Infinite options, serialized hydration, optimistic ordering and complete
authority retirement are not implemented by this checkpoint.
