# Conservative local Mutation invalidation

Proposed construction decision after the owner-confirmed beta.2 optimism cut.
This is not Accepted product behavior or a production implementation claim.

Current compiler evidence gives supported watchable Queries app-wide possible
observation slots, not a precise per-Query reachability graph. Named Mutation
contracts have no exact handler write-set; Context resolver read-sets and
lifecycle/cascade closure are not generally projected as a closed dependency
map. Root-Collection matching alone would miss membership/Policy and related
writes. The relevant owners are `compiler/src/live-query/index.ts`,
`composition/index.ts`, `mutation/index.ts` and `mutation/generated-contract.ts`.

Compare two initial interfaces:

- Authored per-Mutation invalidation maps duplicate compiler-owned names and
  invite missing Policy/lifecycle dependencies. Reject this as the default.
- A shared superset containing every public Query family in the generated
  scope needs no authored map and discloses no private dependency graph. Select
  it for the first proof. It is conservative, not precise dependency inference.

Derive that superset from the existing generated Query descriptors. Add only
their compiler-proven watchability fact, needed to classify hydrated or inactive
cache entries without opening a watch or retaining input options. The ordinary
watchable browser mode remains live; infinite mode is always one-shot, even for
a watchable Query. Server mode is one-shot. No duplicated family registry or
per-Mutation copies of the superset are needed.

After a locally decoded successful Mutation or a correlated decoder-proven
`COMMITTED_RESULT_UNAVAILABLE`, schedule native refresh work independently of
the Mutation outcome and application callbacks. Match this binding's prefix,
public Operation identities and ordinary/infinite modes. Exclude all ordinary
browser-live families, including hydrated/inactive entries: their existing
watch owns continuing updates and their next activation opens fresh live work.

Cancel matching non-live requests first, then mark matching cache entries stale
and refetch only active native Queries. Without explicit cancellation, native
invalidation can join an older initial request whose success clears the stale
flag. Inactive entries must not keep such a request running. Native disabled
or static Queries keep their native execution semantics.

Scope retirement prevents new refresh work, cancels owned Query execution and
joins outstanding refresh scheduling. It must not invalidate a new owner with
equal Context. Concurrent commits may cancel an earlier refresh; no new queue,
retry engine or ordered optimistic layers are introduced.

Refresh failure does not turn a committed Mutation into rollback or replace its
original result/error. Query failures stay in native Query state. Finishing
invalidation is not proof that any view observed the commit. Declared rejection
and unknown transport outcome are not commit evidence and do not trigger this
known-commit path. Deliberate refresh/recovery remains available; no automatic
Mutation replay is added. Later Job effects, remote writes and other scoped
bindings require their existing live subscription or explicit refresh policy.

The falsification seam is a generated Mutation and generated ordinary/live/
infinite Query options consumed by native QueryClient/observers with only the
external HTTP/SSE peer controlled. Test active and inactive pending reads,
empty/null results, post-commit error and unknown failure, live non-reopening,
infinite classification, refresh failure, concurrent commits and retirement.
Production extraction still needs full-source and PostgreSQL reference evidence.
