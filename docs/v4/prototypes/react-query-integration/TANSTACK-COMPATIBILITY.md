# TanStack compatibility audit

This records the prototype's support, including the subsequent
[native React hook checkpoint](REACT-HOOK-EVIDENCE.md), what remains unproved,
and why a native-options return type is not sufficient evidence of complete
TanStack Start compatibility. The owner explicitly raised infinite and suspense
queries on 2026-09-08. This is research, not accepted public support or a release
scope projection.

## Current coverage

| Surface                                      | Current evidence                                                                                                               | Next falsifying consumer                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary Query and Mutation                  | Native hooks infer generated types; jsdom StrictMode executes Query selectors and Mutation submission                          | Real browser, complete Mutation retirement and error reset                                                                                   |
| `useSuspenseQuery` / `useSuspenseQueries`    | Strict inference and server rendering pass; jsdom scope retirement reaches the error boundary                                  | Abandoned render, live remount, server denial and error-boundary reset                                                                       |
| `useInfiniteQuery`                           | Generated forward prototype: full source compilation, native pages/maxPages and strict hook types                              | Real browser and SSR identity/lifetime                                                                                                       |
| `useSuspenseInfiniteQuery`                   | Generated options pass strict native hook and selector inference                                                               | Infinite consumer plus actual suspense lifecycle                                                                                             |
| Start loader prefetch                        | Actual Start loader uses generated `ensureQueryData`; production build and Firefox pass                                        | Client navigation, request cancellation and full authority lifetime                                                                          |
| Start SSR, streaming, hydration              | Explicit bootstrap and native Start/Firefox hydration; successful delayed stream hands over to a shared watch under clock skew | Failed/interrupted hydration, navigation and credential retirement                                                                           |
| Live infinite results                        | Not implemented                                                                                                                | Page-boundary inserts/deletes, omitted fields, revocation, page eviction and complete replacement without duplicates or stale protected rows |
| Persistence, offline replay, cross-tab cache | Not supported by current proof                                                                                                 | Explicit authority lifetime and stable call-identity decisions before making these claims                                                    |

Infinite Query owns `pages` and `pageParams`; it requires `initialPageParam` and
page-navigation callbacks. It cannot be obtained by relabelling ordinary options.
Where the compiler knows the pagination contract, the adapter should project it;
an arbitrary named Query result must not have its cursor semantics guessed.
The [pagination research](PAGINATION-RESEARCH.md) identifies the existing
structural template metadata that can supply this mapping without another
authored cursor definition. The [infinite checkpoint](INFINITE-EVIDENCE.md)
executes that forward capability; it does not establish live infinite support.
Source: [official infinite Query guide](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries).

Suspense excludes conditional enabled/disabled behavior and placeholderData.
Its default error behavior can continue displaying existing data, so terminal
authorization retirement needs an actual React/error-boundary test. Source:
[official suspense guide](https://tanstack.com/query/latest/docs/framework/react/guides/suspense).

The official Router Query integration owns dehydration, streamed hydration,
redirect handling and optional provider wrapping, and applies to Start. Reuse
that integration rather than duplicate it. It cannot make independently generated
QUESTPIE keys match. Source:
[official Router Query integration](https://tanstack.com/router/latest/docs/integrations/query).

## Executed hydration diagnostic and repair

The [identity checkpoint](IDENTITY-EVIDENCE.md) repairs the key miss with one
explicit request-local bootstrap; ordinary browser-only bindings stay isolated.
The [native Router probe](start-upstream/EVIDENCE.md) exercises actual hooks and
emitted serialization. The [Start application](start-app/README.md) adds a real
production build and Firefox hydration. TanStack owns the serializer and cache
throughout. The 37-assertion Firefox consumer also proves successful-document
watchable handover under delayed streaming and clock skew. Failed or interrupted
hydration and navigation remain unproved; these results do not yet establish
complete SSR1 support.

The earlier diagnostic below remains useful as a negative control for two
independent bindings without explicit bootstrap transfer.

Run `bun run diagnose:hydration` for the committed
[reproducer](diagnose-hydration.ts). Using Query Core 5.102.8, two generated client
scopes with identical Context and
Query input were bound to separate native caches. A synthetic Task was placed
in the server cache, then `hydrate(browserCache, dehydrate(serverCache))` ran.
Result: `sameKey: false`, `hydratedQueries: 1`, `originalKeyCacheHit: true`,
`browserScopeCacheHit: false`. Hydration itself restores the Query; the browser
adapter cannot address it through its independently generated key.

The same diagnostic now compares in-memory hydration with a plain JSON round
trip. The former preserves the fixture's `Date`; plain JSON does not. This is
not a Start serializer result. Native Query supports serialization transforms,
and Start's integration needs its own end-to-end consumer. Do not add a second
codec implementation or raw inline JSON to conceal either gap. The upstream
[SSR guide](https://tanstack.com/query/latest/docs/framework/react/guides/ssr)
also warns that plain JSON embedded in HTML needs protection against script
injection. This script prints diagnostic flags and counts, not payloads or HTML.

Both observations are diagnostics, not acceptance gates. They run without an
actual Start server or browser and select no server/browser scope-transfer
contract. ADR-0035's separate-scope isolation still applies until explicitly
superseded; identical Context input alone is not permission to share a cache.

The earlier browser-only fingerprint in
[FINGERPRINT-RESEARCH.md](FINGERPRINT-RESEARCH.md) would preserve that mismatch.
The new candidate transfers client-visible random bootstrap material, not a
deployment secret or authorization token. No fallback to raw input keys or a
second result cache is selected.

## Versions and skills checked

The npm registry `latest` metadata returned these exact versions on 2026-09-08:

| Package                                         | Version      |
| ----------------------------------------------- | ------------ |
| `@tanstack/react-query`, `@tanstack/query-core` | 5.102.8      |
| `@tanstack/react-start`                         | 1.168.50     |
| `@tanstack/react-router`                        | 1.170.33     |
| `@tanstack/react-router-ssr-query`              | 1.167.2      |
| `react`                                         | 19.2.8       |
| `@tanstack/db`, `@tanstack/react-db`            | 0.8.7, 0.3.7 |

Sources: [Query metadata](https://registry.npmjs.org/@tanstack%2Freact-query/5.102.8),
[Start metadata](https://registry.npmjs.org/@tanstack%2Freact-start/1.168.50),
[Router metadata](https://registry.npmjs.org/@tanstack%2Freact-router/1.170.33),
[SSR integration metadata](https://registry.npmjs.org/@tanstack%2Freact-router-ssr-query/1.167.2),
[React metadata](https://registry.npmjs.org/react/19.2.8),
[DB metadata](https://registry.npmjs.org/@tanstack%2Fdb/0.8.7),
[React DB metadata](https://registry.npmjs.org/@tanstack%2Freact-db/0.3.7).
These were research pins at the audit checkpoint. The subsequent hook proof
installs Query Core, React Query and React/ReactDOM at these exact versions in
the private prototype only. The isolated Start consumers also pin the listed
Start, Router and SSR integration versions. DB integration remains untested;
no broad repository upgrade ran.

The exact published Start tarball contains `skills/react-start/SKILL.md`, which
was read in full. Its referenced Start Core entry and execution-model skill were
read from `@tanstack/start-client-core@1.170.28`. Their internal version labels
lag the package versions (1.168.32 and 1.170.14 respectively), so source code and
executed consumers still need verification. The published Query, Query Core and
React Router tarballs listed above contain no SKILL.md. Query's main tree at
`50680b98c4dc5ac4d97f7762014fa83f09a41d9a` also contained none. Skills search
returned community Query skills; none was installed or represented as official.

[TanStack Intent](https://tanstack.com/intent/latest/docs/overview) supports
version-matched package skills. We loaded the relevant published instructions
without installing hooks or rewriting AGENTS.md. Start's isomorphic-loader
guidance makes server/browser lifetime tests necessary before selecting the
identity implementation. It does not authorize duplicating QUESTPIE Operation
DTOs, Policy or endpoints through a second set of Start server functions.

## Continuation order

Computed identity, typed forward pagination and the initial actual Start
loader/SSR/hydration consumer now have executable checkpoints. Finish the
watchable hydration handover and authority lifetime before declaring those
slices complete or relying on them for optimism and invalidation. Keep
live infinite semantics separate from one-shot pagination; neither is accepted
by an upstream hook merely accepting an options object. The release cut remains
an explicit decision, not a claim that every TanStack feature is already ready.
