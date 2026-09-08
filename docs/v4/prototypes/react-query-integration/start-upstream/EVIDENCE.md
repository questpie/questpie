# Native Router SSR research probe

This probe checks the published TanStack SSR integration and the candidate
QUESTPIE identity bootstrap. It is research, not an acceptance record
or a claim that the framework already supports Start SSR.

`bun run test` passes five tests with 19 assertions. `bun run types:check`
passes against the isolated, exact package versions in `package.json` and
`bun.lock`. The probe uses the real `setupRouterSsrQueryIntegration`, real
Router instances, native Query caches and the exported Router SSR lifecycle.
It mocks no hydration or cache implementation.

`bun run test:generated` adds one connected consumer with 19 assertions. It
uses the parent's generated Task client and candidate Query adapter, two
independent request caches, the original Router dehydrate/hydrate hooks, and the
actual Router serializer. The only substituted boundary is external HTTP.
The total across both scripts is six tests with 38 assertions.

| Consumer                                             | Observed result                                                                                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two request caches with the same Query key           | Tenant A hydrates into its browser cache; Tenant B remains separate                                                                                                                      |
| Async original Router hydration hook                 | Completes before native Query hydration                                                                                                                                                  |
| Query starts after initial dehydration               | Native integration streams it into the receiving cache and settles its pending result                                                                                                    |
| SSR cleanup during a pending Query                   | Query signal aborts, its promise rejects, and the request cache empties                                                                                                                  |
| Published Router SSR serialization                   | Emitted bootstrap preserves a Date and escapes script-shaped text                                                                                                                        |
| Generated identity bootstrap                         | Reversed options construction order still finds the hydrated Query; decoded Date survives; a fresh native fetchQuery makes zero browser HTTP requests; the other tenant remains isolated |
| Delayed hydration with server clock 60 seconds ahead | **Counterexample:** native hydration replaces newer browser data and restores a field omitted by that browser snapshot                                                                   |

The last row is a diagnostic assertion of unsafe behavior, not a successful
QUESTPIE guarantee. Adapter handover must prevent stale SSR data from replacing
an already-authorized live snapshot; native timestamp comparisons are not a
causal fence. The test delivers a delayed initial hydration payload through the
real integration. It does not simulate a browser SSE watch or establish the
same race through an HTTP stream.

The serializer test calls the actual exported Router server dehydration path
and evaluates its emitted bootstrap in an isolated VM realm. The Date assertion
runs inside that realm, avoiding cross-realm `instanceof` confusion. It is not a
browser, React hydration, Start application build, PostgreSQL or HTTP tracer.
Start is installed at its exact pin; its Router integration is the executed
boundary, not the complete Start server entry.

## Reproduce

From this directory, with an isolated dependency installation:

```sh
bun run test
bun run test:generated
bun run types:check
```

The recorded run installed with Bun 1.3.14 outside the repository workspace and
linked this directory's ignored `node_modules` to that install. The parent
prototype, workspace package manifest and lock were not changed. The isolated
install command was `bun install --ignore-scripts`; use the committed lock and
`--frozen-lockfile` when repeating it. Repository format, lint and diff checks
are run from the worktree root.

The connected test and its typecheck require the parent prototype dependencies
and generated files. Prepare those once with `bun run generate:proof` in the
parent directory; do not run generation concurrently with another consumer.
This checkpoint used the parent's already-prepared files and ran no generator.
The Task client comes from normalized-IR production rendering, not a new
full-source application compilation.

The pins are Start 1.168.50, Router 1.170.33, React Router SSR Query 1.167.2,
Query/React Query 5.102.8, and React/ReactDOM 19.2.8. The lock resolves Router SSR
Query Core 1.169.2 and Router Core 1.171.28. Seroval is pinned to 1.6.6: the first
install forced 1.6.2 alongside current `seroval-plugins` 1.6.6 and failed import
because `isStream` was absent. Matching 1.6.6 closes that executable dependency
mismatch; this is not a repository-wide dependency upgrade.

## Upstream authority

- [Official Query integration guide](https://github.com/TanStack/router/blob/main/docs/router/integrations/query.md): per-request QueryClient and standard Start integration.
- [Published integration package](https://registry.npmjs.org/@tanstack/router-ssr-query-core/1.169.2): `src/index.ts` owns initial/pending Query streaming, hook composition and cleanup; the installed published source was inspected.
- [Published Router package](https://registry.npmjs.org/@tanstack/router-core/1.171.28): `src/ssr/ssr-server.ts` owns emitted Seroval bootstrap and `src/ssr/serializer/transformer.ts` includes Date in its default serializable contract.
- [Published Query package](https://registry.npmjs.org/@tanstack/query-core/5.102.8): `src/hydration.ts` compares `dataUpdatedAt` and `dehydratedAt`; the counterexample executes that installed implementation.

The generated identity consumer is connected. The sibling
[Start app](../start-app/README.md) now supplies a production Start build and
real Firefox handover tracer, with its own exact scope and limitations.
No custom result cache or serializer is indicated by this evidence.
