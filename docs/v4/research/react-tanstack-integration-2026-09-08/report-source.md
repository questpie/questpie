# React/TanStack integration: source report

Date: 2026-09-08. Audience: QUESTPIE maintainers and the Autopilot migration owner.
Status: research only. Canonical internal claim record; the user-facing result is
[RECOMMENDATION.md](RECOMMENDATION.md).

## Scope, method and conclusion

Question: which small frontend boundary removes repeated Autopilot integration
work without duplicating QUESTPIE transport, authorization or server truth?
Include TanStack Query, DB, invalidation, optimism, cancellation, revocation,
generated contracts and a real Task transition. Exclude production changes,
Autopilot migration, release projection and offline/workflow design.

Recommendation: generated Operation descriptors plus a native TanStack Query
adapter, with a separate optional full-snapshot TanStack DB projection. A scoped
adapter owns authority lifetime and reconciliation; applications own optimistic
domain reducers. Current success/watch contracts do not prove causal observation.
First test a post-commit fresh-watch fence before considering new wire metadata.

Research used repository authority, pinned upstream source, registry metadata,
two independent source-audit lanes, parent source spot checks, two stateless
Fable 5.1 consultations and executable published-package probes. No application
was started or modified. No PostgreSQL/browser or framework adapter proof ran.

The inspected QUESTPIE research worktree is based on
`ba336b234` (static-schedule integrated proof). Canonical `feat/v4` remained clean
at `97910dac96e0fcc9a7da5c911b8f2534f5eb83b4`. The integrated release worktree's
dirty schedule projection was preserved. Autopilot was inspected read-only at
`b84bf1ba96d4e0d2f02916bee700403895db878c`, including dirty/untracked migration
work. Remote tracking changed during research; this is not a latest-remote audit.

## Authority ledger

| Source                                                                               | Accepted constraint / current evidence                                                                                      | Research consequence                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [ADR-0012](../../../adr/0012-freeze-live-query-and-change-ledger.md)                 | Runtime dependency tracking; complete Policy-aware Query results; no atomicity promise across independent Queries           | Do not expose raw change feeds or pretend browser normalization is server truth                                              |
| [ADR-0023](../../../adr/0023-freeze-post-commit-operation-outcome.md)                | Stable call identity and post-commit outcome; opaque transaction IDs                                                        | Separate commit from observation; no inferred XID ordering or blind Mutation retry                                           |
| [ADR-0035](../../../adr/0035-freeze-query-resource-and-react-client-integration.md)  | Query Resource and thin React integration; TanStack/optimism/invalidation excluded                                          | New recommended React integration requires explicit scope supersession                                                       |
| [ADR-0042](../../../adr/0042-freeze-public-package-identities.md)                    | Public `questpie` and `questpie-opentelemetry`; existing React subpath                                                      | Candidate is `questpie/react-query`, not invented scoped package identities                                                  |
| [Client generation](../../../../packages/compiler/src/runtime/client.ts)             | CallOptions carry callId/signal/timeout; generated methods return Promise of output; codecs/contracts remain module-private | Project existing descriptors once, including declared errors; rejected Promise types cannot be inferred from the output type |
| [HTTP decoding](../../../../packages/compiler/src/runtime/client-http-response.ts)   | Success accepts callId/result and returns decoded result; known committed-unavailable error has transactionId               | Current normal result has no public commit-coverage receipt                                                                  |
| [Realtime client](../../../../packages/compiler/src/runtime/client-realtime.ts)      | Initial/update/reset deliveries have no transaction coverage; new watch uses resumeToken null                               | A fresh-generation proof is possible to investigate without changing the wire                                                |
| [Query Resource](../../../../packages/compiler/src/runtime/client-query-resource.ts) | Existing codec-canonicalized identity and scoped sharing                                                                    | Reuse generated identity rules; ordinary application JSON serialization is not an equivalent codec                           |
| [React hook](../../../../packages/questpie/src/react.ts)                             | useSyncExternalStore over the resource                                                                                      | Do not describe current hook as a TanStack adapter                                                                           |

SPEC, CONTEXT, ADR index, HANDOFF, DELIVERY-FLOW and the current Deep-DX decision
map were read. None was edited. This report has no superseding authority.

## Dependency inference: useful, but not already precise

[Collection Operation contracts](../../../../packages/compiler/src/mutation/operation-set-contract.ts)
name target Collection and read/write mode. Generated Mutation capability scopes
are broad: [generated-contract.ts](../../../../packages/compiler/src/mutation/generated-contract.ts),
especially the collection Operation projection. The supported live Query
descriptor receives a broad possible-slot superset in
[live-query/index.ts](../../../../packages/compiler/src/live-query/index.ts).
Runtime observations narrow the actual dependencies. Context descriptor identity
does not itself enumerate a complete transitive Collection-read closure.

Therefore the compiler has ingredients for conservative affected-family
projection, not evidence for precise automatic per-Mutation invalidation today.
The proposed intersection is a design inference, requiring closed handling of
Policy, Context, relation, lifecycle and cascade paths. Unsupported/opaque paths
cannot be treated as no dependencies. Background Job writes occur later and do
not become part of the accepting Mutation's commit. Public projection must not
disclose branch-specific writes or private Policy reads.

## Upstream claim ledger

All upstream links below were accessed on 2026-09-08. Version/commit pins describe
the inspected source, not a promise about later `latest` documentation. These are
first-party TanStack sources; implementation claims were checked in pinned source
and high-impact behaviors independently probed. Publication dates beyond the
version metadata were not needed and are not inferred from access dates.

Query 5.102.8: commit `2969edf32f7e0c48e2a108d84712d6e01edfde21`.
DB 0.8.7, query-db-collection 1.2.12, react-db 0.3.7 and electric-db-collection
0.4.7: commit `613807d753dac30607fd21197d952bb10b6dd597`.
Registry metadata was checked; the probe lockfile pins the installed experiment.

| Claim                                                                                               | First-party source                                                                                                                                                                                                                                                                                                          | Evidence / limitation                                                                                |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Query options can preserve typed data/error keys                                                    | [React queryOptions implementation](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/react-query/src/queryOptions.ts#L52-L83)                                                                                                                                                       | Source read; QUESTPIE generated inference still unproved                                             |
| Cache observer events and enabled activity are available                                            | [QueryCache events](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/queryCache.ts#L32-L76), [Query observer lifecycle](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/query.ts#L273-L299)                  | Source read; disabled observers and prefetch need different lifetime handling                        |
| Invalidation can resolve despite failed refetch; disabled/static queries can be skipped             | [QueryClient invalidation/refetch](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/queryClient.ts#L298-L343)                                                                                                                                                        | Source and executable probe; not an observation receipt                                              |
| A live streamed query can keep fetch/prefetch pending                                               | [streamedQuery implementation](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/streamedQuery.ts#L65-L118), [official reference](https://tanstack.com/query/latest/docs/reference/streamedQuery)                                                                     | Source and executable probe; first data is still available                                           |
| Mutation invocation context does not expose a unique invocation ID or onMutate result to mutationFn | [Mutation execution](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/mutation.ts#L178-L235), [context type](https://github.com/TanStack/query/blob/2969edf32f7e0c48e2a108d84712d6e01edfde21/packages/query-core/src/types.ts#L1092-L1101)                           | Source read; same variables object can be used for distinct invocations                              |
| DB updates default to partial merge, not complete replacement                                       | [Sync types](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/types.ts#L421-L428), [row application](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/state.ts#L1042-L1052)                                              | Source and executable partial/full comparison                                                        |
| query-db-collection does not select full row update mode                                            | [Query collection sync config](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/query-db-collection/src/query.ts#L2359-L2367)                                                                                                                                                          | Pinned source, not a claim that no future version can support it                                     |
| DB truncate preserves optimism                                                                      | [Truncate implementation](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/sync.ts#L287-L321)                                                                                                                                                                        | Source and executable probe; cannot implement terminal revocation alone                              |
| DB sync commit returns an applied receipt which may wait on persistence                             | [Receipt types](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/types.ts#L348-L395), [queue application](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/state.ts#L831-L888)                                           | Source and controlled-gate probe; awaiting this receipt inside that persistence handler can deadlock |
| Cleanup is not terminal authority retirement                                                        | [State cleanup](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/state.ts#L1494-L1514), [late transaction completion](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/transactions.ts#L616-L659)                        | Independent and parent reproductions: pending successful write repopulates cleaned collection        |
| Direct completed transactions can reconstruct optimistic rows                                       | [Overlay reconstruction](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/state.ts#L511-L594)                                                                                                                                                                        | Explains cleanup result; no second sync startup needed for this case                                 |
| DB does not establish cross-collection atomic UI observation here                                   | [Transaction touches](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/transactions.ts#L560-L575)                                                                                                                                                                               | Sequential settlement source read; no independent atomicity proof                                    |
| Electric sync confirmation is connector-specific, not generic max-XID logic                         | [Visibility tests](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/electric-db-collection/src/electric.ts#L855-L919), [commit/ack sequence](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/electric-db-collection/src/electric.ts#L1999-L2059) | Source read; cannot copy its receipt assumption onto QUESTPIE's wire                                 |

Supplementary first-party documentation: [optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates),
[cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation),
[DB custom collection options](https://tanstack.com/db/latest/docs/guides/collection-options-creator),
[DB mutations](https://tanstack.com/db/latest/docs/guides/mutations),
[Query collection](https://tanstack.com/db/latest/docs/collections/query-collection),
[Electric collection](https://tanstack.com/db/latest/docs/collections/electric-collection).
These orient API usage; pinned source and probes resolve the integration claims.

Published tarball source matched pinned GitHub source for the two spot checks:
query-db-collection/src/query.ts SHA-256
`90e6130e9a2515647c5bda51e979aff9b9c7b883cef5f398a03aec2edd32c0d5`;
query-core/src/streamedQuery.ts SHA-256
`04ae8c2ecc6e5d41ecd373198f02f07dfd11c1c18024d7fdd146023fed3dbf03`.

## Autopilot evidence and deletion boundary

Paths below are relative to the read-only `/home/drepkovsky/code/autopilot`
checkout. This intentionally includes uncommitted local intent and does not
claim those documents or the disconnected v4 adapter are released.

| Journey / claim                                                                               | Local evidence                                                                                                                                                      | Implication                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Current migration direction selects raw v4 client plus Query, superseding the August DB pivot | docs/decisions/2026-09-06-v4-migration-cutoff-and-mechanical-port.md, lines 81–95; docs/architecture/v4-migration-map.md                                            | DB is newly evaluated optional work, not an already accepted requirement                                                    |
| Disconnected v4 adapter supplies streamed Query options only                                  | apps/operator-web/src/lib/questpie-v4-react-query/ (three untracked files; no consumers found)                                                                      | No current mutation, optimism, generated canonical key or SSR proof                                                         |
| Task write semantics are real domain work                                                     | apps/operator-web/src/components/tasks/task-write-plan.ts; components/tasks/use-task-write-controller.ts                                                            | Keep transition intent, expectedVersion and conflict behavior                                                               |
| Board overlays know band/filter/assignee and loaded-page membership                           | apps/operator-web/src/features/tasks/task-list-overlay.ts; features/tasks/queries.ts                                                                                | Cannot infer correct optimistic placement from Mutation schema                                                              |
| Shared overlay already solves multi-consumer observations                                     | apps/operator-web/src/lib/data/pending-command-overlay.ts and adjacent registry/hook                                                                                | Extract proven bookkeeping; do not count shared code as duplicate at every caller                                           |
| Revocation needs protected-query removal and pending-state cleanup                            | apps/operator-web/src/features/tasks/task-detail-query-ownership.ts; routes/\_authenticated/$companySlug/tasks.$taskId.tsx; lib/data/use-pending-command-overlay.ts | Replace positional query-key parsing with typed ownership; raw Task version alone misses assignment-based authority changes |
| Conversation reconciliation has nonce/outbox, gap healing and composite windows               | apps/operator-web/src/features/conversation/{queries.ts,reconciliation.ts,direct-send.ts,pending-outbox.tsx,use-conversation-window.ts}                             | Keep command nonce and window semantics; evaluate mechanical reconnect/reconcile deletion separately                        |
| Library writes currently fan out beyond an entry list                                         | apps/operator-web/src/features/library/use-library-writes.ts; lib/data/query-keys.ts                                                                                | Entry-only dependency inference would miss related families                                                                 |

The AST/source census found 18 feature queries.ts modules, 65 asAppQueryOptions
calls, 14 q.custom.query calls and 11 realtime:true properties. These count syntax,
not unique integration bugs or deletable calls. The shared pending-command code
is 734 physical lines across three modules (551 token-bearing lines), not 734
lines of duplication. One checked six-line invalidate/catch/remove body appears
three times in conversation reconciliation: 12 repeated lines beyond the first.
No projected LOC saving is asserted.

Installed Autopilot Query/Core were both 5.101.2; existing v3
`@questpie/tanstack-query` was 3.28.8. Both callers resolved the same physical
Query/Core dependency. Historical comments about duplicate nominal types are
not evidence of a current duplicate installation. No installed DB integration
was resolved; an optional peer mention in a lockfile is not a consumer.

## Fable review provenance and disagreements

Both research calls used `claude -p --model fable --effort high`, disabled tools,
safe mode, strict empty MCP configuration, no session persistence and JSON output.
Input was scanned using the repository acceptance-packet secret detector before
transport. The timeout bound was 60 minutes; neither run timed out or used a
fallback. These calls were **not** `review:accept` and produce no formal PASS.

| Round                            | Input SHA-256                                                    | Transport result           |
| -------------------------------- | ---------------------------------------------------------------- | -------------------------- |
| Ownership alternatives           | 5aa9ef5bd278549060ad324f514a5d6d4ebec368738e6472f545a46364ce84e2 | exit 0; success; 191818 ms |
| Corrective adversarial follow-up | ca742c5c9e9321b300e8a33749dbdad5eb56dd916d9ffba27f873a4c783300ee | exit 0; success; 115173 ms |

Both JSON results reported main model `claude-fable-5-1` and auxiliary
`claude-haiku-4-5-20251001`. Raw local evidence is retained in the task-owned
`/home/drepkovsky/code/questpie-v4-react-research-evidence.MTYM9G` directory,
not promoted to a product acceptance record.

Round one recommended Query first, ordered optimistic layers and app-owned
semantic reducers. Its assumptions about query-db-collection full updates,
generated descriptors being duplication, and a custom DB sync being a second
transport were contradicted by pinned source. Round two withdrew those points.

The synthesis also rejects a suggested same-mutation-key global scan for retry
identity: it cannot isolate concurrent invocations. A per-options closure or
variables-object WeakMap also cannot establish one ID per invocation with
arbitrary retries. Start from retry:false and explicit same-call recovery; prove
how reserved options and additive callbacks preserve it. Do not advertise safe
arbitrary retry overrides.

Fable's follow-up left fresh-watch no-resume support as unknown; parent source
inspection established that new watch opens already use resumeToken:null. Its
suggestion to drop committed optimism on refresh failure remains unaccepted:
that needs an explicit synchronization-failure state, not rollback-looking UI.
Registration races and reads after commit still need QUESTPIE/PostgreSQL proof.

## Executable evidence and disconfirmation

The retained [upstream probes](upstream-probes/README.md) exercise published
packages in isolation. First-run cleanup expectation was disproved: size became
one after pending settlement, not zero. The corrected observation is retained as
an assertion of actual behavior, not described as a library fix. A subsequent
completion-fence probe kept size zero after local retirement. This narrow result
does not prove a complete adapter's authority boundary.

The final suite records ten observations, covering partial/full replacement,
truncate, cleanup/late completion, retained-handle restart, sync receipt queue,
full replacement under a pending overlay, retired completion guard, failed
invalidation and non-finite streamed fetch.
Every controlled gate is released and fixture cleanup is awaited. No production
application, real user data, network mutation or database was involved.

The final independent audit identified a distinct nonterminal case: successful
authorized replacement can reduce visible fields while pending optimism remains.
[DB applies active mutation.modified as an optimistic upsert](https://github.com/TanStack/db/blob/613807d753dac30607fd21197d952bb10b6dd597/packages/db/src/collection/state.ts#L609-L645).
A parent probe forces immediate application of a full base replacement and
observes that the visible pending overlay still contains the omitted field.
Therefore full replacement and terminal cleanup tests do not establish safe
authority reduction during an active scope. Layer retirement/rebasing must
explicitly address this case without treating a local abort as server rollback.

## Remaining proof gaps and stop rule

| Gap                                                                  | Confidence now                                                      | Required next evidence                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Native generated I/O/error/options inference without repeated schema | Design feasible, not implemented                                    | Generated consumer compilation; hostile options and duplicate-module cases         |
| Complete conservative invalidation closure                           | Structural ingredients verified; precision unknown                  | Policy/Context/lifecycle/cascade negative controls; no false negatives             |
| Fresh post-commit watch confirms observation                         | Supported by current transaction/watch shape; not proved end-to-end | Real PostgreSQL registration races, equal/no-op/delete, overlapping commits        |
| Terminal authority retirement                                        | Cleanup hazard reproduced; isolated fence works                     | Browser old references, late success, lost ack, reconnect and credential switch    |
| Multiple optimistic layers                                           | Domain requirement established, algorithm not integrated            | Out-of-order A/B, rejection, unknown outcome, filtered/paged views                 |
| Finite fetch with shared ongoing watch                               | streamedQuery mismatch demonstrated                                 | Observer enable/disable, prefetch, StrictMode, GC and disposal tracers             |
| DB optional adapter                                                  | Full replacement and queue semantics established                    | Key inference, row removal, retirement, queued/applied ack without circular waits  |
| SSR/hydration                                                        | No new proof                                                        | Request isolation, codec-safe dehydration, credential partition and stream handoff |

Stop: the alternatives are now distinguishable, consequential upstream claims
have pinned support or executable evidence, and remaining gaps require a bounded
QUESTPIE integration proof rather than more general web research. Another broad
research round would not resolve them. Release inclusion is a product scope
choice, not something Fable or these probes can accept on the owner's behalf.

## Deliverable verification

The retained probe package was recreated in a second isolated directory, installed
with `bun install --ignore-scripts --frozen-lockfile`, and its `bun run probe`
script exited zero. The final additional pending-overlay case also exited zero;
`results.json` contains all ten observations. Repository `format:check`, 20 local
Markdown link checks, balanced-fence checks, the packet secret scanner across all
eight research files, and staged `git diff --check` passed. The independent
TanStack evidence review's one additional hostile is incorporated above and in
the decision map. The user-facing Markdown was read back; no browser rendering
or visual QA is claimed. No release or acceptance gate was rerun for this
research-only branch.
