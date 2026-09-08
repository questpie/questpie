# TanStack compatibility audit

This records what the prototype at `9250f5ea3` can support, what remains unproved,
and why a native-options return type is not sufficient evidence of complete
TanStack Start compatibility. The owner explicitly raised infinite and suspense
queries on 2026-09-08. This is research, not accepted public support or a release
scope projection.

## Current coverage

| Surface                                      | Current evidence                                                                                         | Next falsifying consumer                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary Query and Mutation                  | Native QueryClient/QueryObserver/MutationObserver and generated transport pass; React hooks not executed | `useQuery`, `useMutation`, selectors and error reset in React                                                                                |
| `useSuspenseQuery` / `useSuspenseQueries`    | Not verified; current broad QueryObserverOptions also admits a skipToken type that suspense excludes     | Strict hook inference, first suspension, abandoned render, denial after data and error-boundary reset                                        |
| `useInfiniteQuery`                           | Not implemented; ordinary queryFn ignores pageParam and has no page envelope                             | Compiler-known cursor mapping, distinct normal/infinite identities, next/previous pages, maxPages and refetch                                |
| `useSuspenseInfiniteQuery`                   | Not implemented                                                                                          | Infinite consumer plus suspense lifecycle                                                                                                    |
| Start loader prefetch                        | Only finite native fetch is proved                                                                       | `ensureQueryData` in an actual Start loader, client navigation and cancellation                                                              |
| Start SSR, streaming, hydration              | Current independent scope keys miss hydrated data                                                        | Per-request isolation, matching authorized server/client identity, codec-safe data, one browser watch handoff                                |
| Live infinite results                        | Not implemented                                                                                          | Page-boundary inserts/deletes, omitted fields, revocation, page eviction and complete replacement without duplicates or stale protected rows |
| Persistence, offline replay, cross-tab cache | Not supported by current proof                                                                           | Explicit authority lifetime and stable call-identity decisions before making these claims                                                    |

Infinite Query owns `pages` and `pageParams`; it requires `initialPageParam` and
page-navigation callbacks. It cannot be obtained by relabelling ordinary options.
Where the compiler knows the pagination contract, the adapter should project it;
an arbitrary named Query result must not have its cursor semantics guessed.
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

## Executed hydration diagnostic

Using Query Core 5.102.8, two generated client scopes with identical Context and
Query input were bound to separate native caches. A synthetic Task was placed
in the server cache, then `hydrate(browserCache, dehydrate(serverCache))` ran.
Result: `sameKey: false`, `hydratedQueries: 1`, `browserScopeCacheHit: false`.
This was an in-memory diagnostic, not an actual SSR render or serialized round
trip. It establishes the key mismatch before either of those additional tests.

The proposed private fingerprint in [FINGERPRINT-RESEARCH.md](FINGERPRINT-RESEARCH.md)
would preserve that mismatch with independently generated secrets. Do not select
it as the final general React/Start architecture while leaving this obligation
unresolved. No deployment secret may be shipped to the browser to hide the gap.
No fallback to raw input keys or a second result cache is selected.

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
These are research pins, not a new installed dependency graph or an integration
test result. Query Core already matches the latest version; no broad upgrade ran.

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

Reconcile server/browser identity before replacing the capture registry. Then
test ordinary and suspense hook consumers, typed pagination, and an actual Start
loader/SSR/hydration consumer before broader optimistic/invalidation work. Keep
live infinite semantics separate from one-shot pagination; neither is accepted
by an upstream hook merely accepting an options object. The release cut remains
an explicit decision, not a claim that every TanStack feature is already ready.
