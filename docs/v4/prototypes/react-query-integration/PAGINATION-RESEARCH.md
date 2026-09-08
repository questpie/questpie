# Pagination projection research

Research and source-compilation evidence, 2026-09-08. The later
[infinite checkpoint](INFINITE-EVIDENCE.md) implements the preferred finite
prototype; this research is not acceptance or public support authority.
Inspected compiler/Runtime sources and the prototype's installed
TanStack Query **5.102.8**. Upstream web documentation was checked, but its
`latest` redirects can describe newer APIs; installed source controls the
version-specific findings below.

Source links for that inspection use the publisher's immutable versioned npm
tarballs. The npm registry metadata and each cited archive path were verified;
filenames and line numbers identify the inspected 5.102.8 source. No local
dependency installation is required to follow these references.

## What is already known

**Fact:** direct structural named Queries already contain the missing semantic
relationship in compiler IR. `DataQueryTemplateV1.page` records
`kind: "forwardCursor"`, exact `first.parameter` and `after.parameter`, and the
total-order constraint. V2 retains that root contract. Cursor parameters are
nullable; parameter names need not literally be `first` or `after`.
See [template types](../../../../packages/compiler/src/relational/types.ts#L123),
[discovery](../../../../packages/compiler/src/relational/discovery.ts#L370), and
[Query identity/template binding](../../../../packages/compiler/src/relational/projection.ts#L114).

| Existing source                                                        | Already derivable                                                                                                           | Not established by that source                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `NormalizedResource.contract.query` for a direct root structural Query | Exact continuation/page-size keys; forward direction; generated input/output codecs; fixed root `nodes`/`pageInfo` envelope | User's preferred initial page size; backwards traversal; cross-page snapshot consistency                                                  |
| Generated Collection Operation Set list program                        | `identity`, `member: "list"`, `dataQuery`, its digest and same root page contract                                           | Availability of that program to the current client renderer merely from an arbitrary resource's DTO                                       |
| Arbitrary handler Query input/output codecs                            | Exact DTOs, nullable/optional properties, selected row shape                                                                | Which input advances which output page, initial position, termination rule, transformation of cursors, or whether any continuation exists |
| Current proof `ReadDescriptor`                                         | Operation identity, inferred input/output/errors, canonical capture and optional watch                                      | Any paging capability or page-to-input relationship                                                                                       |

Sources: [Collection program](../../../../packages/compiler/src/mutation/operation-set-contract.ts#L10),
[its construction](../../../../packages/compiler/src/mutation/operation-set.ts#L476),
[client type renderer](../../../../packages/compiler/src/runtime/client.ts#L18),
[proof descriptor](projection-contract.ts#L34),
[proof generation using existing method types](render-projection.ts#L31).

**Inference:** for the direct structural case, the generator can emit
`Omit<Input, FirstKey | AfterKey>`, `Input[AfterKey]` (`string | null`), and
`Awaited<ReturnType<GeneratedMethod>>` without new authored metadata, DTOs,
schemas, or a user-maintained cursor-key registry. The simpler consumer keeps
the existing page-size input and omits only `AfterKey`. A bounded integer codec
does not establish a preferred/default page size. Removing both keys requires
an explicit page-size value somewhere; renaming that value adds no inference.
The renderer must consume the already validated template relationship and emit
one minimal capability, rather than ask users to restate it.

**Fact:** generated TypeScript renders cursor, text and UUID codecs as `string`.
Type-only inspection of nullable string properties therefore cannot identify a
cursor. The proof's renderer currently reads input/output/error contracts but
never projects `contract.query.page`. A `{ nodes, pageInfo }` output shape is
also insufficient: a handler can manufacture or transform that shape.

Team Support Desk supplies the concrete distinction:
[`tickets.queue`](../../../../fixtures/team-support-desk/src/tickets/queries.ts#L42)
directly owns `query: tickets.list(...)`; its public parameters map directly to
the compiled template. Conversely,
[`tickets.detail`](../../../../fixtures/team-support-desk/src/tickets/queries.ts#L131)
runs a structural plan with fixed `first: 1, after: null`, unwraps its first
node and transforms timestamps. The plan's page contract does not become the
handler's public page contract. The same issue applies to a handler forwarding
to another Query and renaming input/output fields: a call/dependency edge does
not prove identity-preserving pagination dataflow.

## Two bounded interface candidates

Candidate 1 is now callable in the linked prototype, not a public export.

1. **Generated forward capability for proven root pages (preferred).**
   `rq.queries["tickets.queue"].infiniteOptions({ statuses: null, teamIds: null, first: 25 })`
   returns native-compatible infinite options. Input, page DTO, cursor key,
   cursor type and next-page rule are generated. The same options feed native
   `infiniteQueryOptions`, `useInfiniteQuery`, `useSuspenseInfiniteQuery`, and
   imperative infinite prefetch. Arbitrary handler Queries retain ordinary
   options until an actual mapping is proved. No new Query Definition syntax.
2. **Explicit native choreography for arbitrary handlers.** Use TanStack's
   `infiniteQueryOptions` and generated calls, with application-owned
   `initialPageParam`, input mapping and continuation callback. DTO inference
   remains automatic; semantic mapping does not. This needs a generated
   infinite cache-identity helper to avoid handwritten key registries. It is
   an escape hatch only where mapping is absent from compiled facts, and does
   not meet a universal “no repeated cursor mapping” promise. Do not require
   these callbacks for candidate 1 or add a parallel paging-schema registry.

## Native semantics the projection must preserve

- **Cache identity:** ordinary results and `InfiniteData` need distinct keys.
  Query Core indexes by query hash, not observer kind
  ([query-core 5.102.8][core-source], `package/src/queryCache.ts:113`).
  Proposed key material includes mode, generated Operation identity, the
  existing authority/Context partition and canonical base input (including page
  size). Per-page continuation belongs in `pageParams`, not a new top-level
  cache entry. If custom initial anchors are later allowed, include that anchor
  in the list identity. Privacy and SSR partition derivation remain R1/R2 work.
- **Initial/terminal cursor:** generated root input requires explicit `null`
  for the first page, not `undefined`. Use a generated page-param type of
  `string | null` and initial value `null`; subsequent calls inject the cursor
  into the compiled key. Runtime emits `endCursor` for every nonempty page,
  including the last. Derive continuation as
  `page.pageInfo.hasNextPage ? page.pageInfo.endCursor : undefined`.
  [Runtime binding/result](../../../../packages/runtime/src/relational/query.ts#L496).
- **Native cache shape:** preserve paired `pages` and `pageParams` arrays,
  including for initial data, hydration and direct cache edits. Native
  `getNextPageParam` accepts both `null` and `undefined` as termination; a null
  initial param still fetches the first page.
  [Official infinite-query guide](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries),
  [query-core 5.102.8][core-source], `package/src/infiniteQueryBehavior.ts:43`.
- **Forward/backward:** the accepted root contract is forward-only; descending
  order still advances forward in that declared order. No `before`, start
  cursor or previous-page rule exists to generate. Reversing displayed pages
  with `select` is not backwards fetching.
  [ADR-0008](../../../adr/0008-freeze-the-foundational-data-and-structural-query-contract.md#decision).
- **`maxPages`:** 5.102.8 can evict oldest pages while fetching forward without
  `getPreviousPageParam`; this follows directly from `addToEnd`/`addToStart`
  in [query-core 5.102.8][core-source],
  `package/src/infiniteQueryBehavior.ts:75`.
  Such a list cannot reload evicted earlier pages through generated backwards
  pagination. Refetch starts at the first retained page param. Leave native
  retention available with those limits; do not promise bidirectional history.
- **Selectors/types:** native `select` may return a derived view, including
  flattened rows; the cache still stores `InfiniteData<Page, PageParam>`.
  Preserve its generic selected type instead of fixing the hook to the raw
  envelope. 5.102.8 defaults `TData` and its helper's key data tag to
  `InfiniteData<TQueryFnData>` with `pageParams: unknown[]`, even though fetch
  callbacks know `TPageParam`. Exact cursor-array inference needs an explicit
  generated return type and native-hook/cache-consumer type checks, not a cast
  or a claim based solely on inferred `queryFn`.
  [react-query 5.102.8][react-source], `package/src/infiniteQueryOptions.ts:85`;
  [query-core 5.102.8][core-source], `package/src/types.ts:203`;
  [official helper reference](https://tanstack.com/query/latest/docs/framework/react/reference/functions/infiniteQueryOptions).
- **Suspense:** the installed hook omits `enabled`, `placeholderData`, custom
  `throwOnError` and `skipToken`; its data result is defined after suspension.
  Return an actual defined query function so ordinary options do not widen to
  an incompatible skip-token union. Cursor generation does not establish
  Suspense cancellation, retirement, SSR or streaming behavior.
  [react-query 5.102.8][react-source],
  `package/src/useSuspenseInfiniteQuery.ts:16` and `package/src/types.ts:163`;
  [official hook reference](https://tanstack.com/query/latest/docs/framework/react/reference/functions/useSuspenseInfiniteQuery).

## Live pages are a separate unresolved guarantee

**Fact:** each watch binds one exact Query/input and replaces one complete
authorized result. Independent watches converge independently
([ADR-0012](../../../adr/0012-freeze-live-query-and-change-ledger.md#decision)).
Nested inverse lists are bounded arrays with no cursor or `pageInfo`; they
cannot acquire independent infinite scrolling from array types
([ADR-0032](../../../adr/0032-freeze-bounded-inverse-tomany-query-projection.md#authoring-and-type-ownership)).

**Inference/counterexample:** with page size two, `[A,B]` followed by a watch
after B returning `[C,D]`, inserting X before A changes the first page to
`[X,A]` while the second remains after B. B disappears from the concatenation.
Updating each page independently does not keep a contiguous list. Retargeting
subsequent cursors requires ordered rebuilding and race/authority/cleanup
semantics. Native sequential refetch derives later cursors from refreshed
pages, but still uses separate server snapshots; it does not create atomic
multi-page publication. Do not enable live infinite mode merely because each
page is individually watchable. A finite ordinary infinite proof can proceed
without selecting that stronger guarantee.

## Exact next executable consumer

The first source consumer is now executable in
[pagination-source.test.ts](pagination-source.test.ts): full Support Desk
compilation passes one test with five assertions. It binds `tickets.queue` to
the forward template, verifies the nullable cursor input and generated page-info
contract, and rejects inferring a public page mapping for `tickets.detail` from
its internal structural plan. This proves availability of compiler facts, not
native infinite execution.

Run `bun run test:pagination-source` from this prototype after installing the
repository's frozen workspace dependencies and building the public packages
with their existing `build` scripts. Do not point this worktree's workspace
dependencies at another worktree: the first attempt resolved an older Runtime
without its required schedule export. A local frozen install and package builds
removed that mismatch without source or lockfile changes. The system `/tmp`
also rejected compiler temporary writes with `EDQUOT`; using a dedicated writable
`TMPDIR` for this process allowed full compilation. No unrelated files were
deleted to make space.

Use the existing authored `tickets.queue` through isolated full compilation and
the production client renderer. Derive the descriptor from its actual
`NormalizedResource.contract.query` and exact generated method types. Start
with one native `InfiniteQueryObserver`/generated HTTP consumer returning three
pages (including a nonempty terminal page), then compile native ordinary and
Suspense hook consumers with inferred row fields, selected output, cursor
callback and `pages`/`pageParams` types. Assert ordinary/infinite cache
separation, first request `after: null`, exact subsequent cursor injection,
terminal `hasNextPage: false`, `maxPages` eviction and refetch from the retained
anchor. Add one renamed pagination-parameter structural fixture and one
page-shaped handler negative case. Do not hand-author a duplicate fixture DTO.

Missing work is narrow: project the existing template-to-Operation paging proof
into the generated client capability; preserve native type inference; settle
cache/authority lifetime alongside R1/R2; and separately prove or defer live
page rebuilding. Arbitrary handler paging additionally lacks compiled input
mapping, output mapping, initial/terminal semantics and traversal direction.
No runtime shape heuristic can supply those missing facts.

[core-source]: https://registry.npmjs.org/@tanstack/query-core/-/query-core-5.102.8.tgz
[react-source]: https://registry.npmjs.org/@tanstack/react-query/-/react-query-5.102.8.tgz
