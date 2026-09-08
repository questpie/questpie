# React integration that removes Autopilot plumbing

Research recommendation, 8 September 2026. Not an Accepted decision, implementation,
published export, or beta readiness claim.

The later [owner-confirmed beta.2 scope decision](BETA2-SCOPE-DECISION.md)
defers this recommendation's framework-owned optimistic layers and causal
commit-to-observation guarantee. Native userland optimism gets an executable
recipe; inferred invalidation remains required. The broader design below is
retained research, not the current beta.2 implementation checklist.

## The decision I recommend

Make `questpie/react-query` a real TanStack Query integration over generated
Operation descriptors. Keep TanStack Query as the application's query cache and
React integration. Give QUESTPIE ownership of the things only QUESTPIE can know:
codec identity, Context and credential lifetime, Policy-aware watch delivery,
Operation outcomes, and safe reconciliation.

Offer TanStack DB separately for keyed Query projections that benefit from local
joins and derived views. Do not make every React consumer install it. Do not
normalize every server Collection into a browser table.

The existing `questpie/react` hook is useful for Query Resource consumers, but it
does not satisfy this requested integration. Its accepted scope explicitly omits
TanStack Query, mutation invalidation and optimism. Replacing its recommended role
needs a focused supersession, not a claim that it already does this work.
See [ADR-0035](../../../adr/0035-freeze-query-resource-and-react-client-integration.md)
and [ADR-0042](../../../adr/0042-freeze-public-package-identities.md).

| Candidate                                   | What it buys                                                                                | What it leaves us doing                                                                            | Verdict                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Thin React hook plus recipes                | Small framework surface                                                                     | Autopilot still builds keys, mutation integration and reconciliation                               | Insufficient for the requested DX     |
| Generated TanStack Query adapter            | Native Query tooling, one cache, inferred contracts; framework-owned live/write integration | Application-authored optimistic intent                                                             | Primary integration                   |
| TanStack DB as the mandatory frontend model | Reactive local queries and optimistic transactions                                          | Key eligibility, projection ownership, sync and authority retirement; unnecessary for scalar reads | Optional integration, not the default |

TanStack DB remains labelled beta by its maintainers. Its capabilities are real,
but do not make QUESTPIE's authorization or synchronization contracts automatic.
[TanStack DB overview](https://tanstack.com/db/latest/docs/overview).

## One small interface, substantial work behind it

Bind a generated client scope to one QueryClient for one credential/Context
lifetime. Project its existing Query and Mutation names into native options
factories. Do not author another endpoint registry, DTO, schema or query-key map.

The proposed shape is illustrated below as an interface sketch, not executable
TypeScript or an existing export:

```text
adapter = bind(generated scoped client, QueryClient)

useQuery(adapter.queries["tasks.detail"].options({ taskId }))
useQuery(adapter.queries["tasks.board"].options({ projectId }))
useMutation(adapter.mutations["tasks.transition"].options())

adapter.dispose()  // retire this authority lifetime, not merely clear its cache
```

The Task names describe an intended v4 reference flow, not currently generated
Autopilot v4 Operations. Exact factory spelling remains a type-inference proof
question; the ownership boundary is the recommendation.

The factories should preserve native Query behavior and tooling where safe:
typed options, `select`, query-key matching, prefetch and ordinary Mutation
callbacks. Live subscription state needs its own honest status; a stream staying
open must not make an initial prefetch promise stay pending forever. Reserved
transport/retry/lifecycle options need explicit semantics rather than arbitrary
overrides that silently break the guarantee. Native options are an integration
surface, not permission to replace the generated transport.

The compiler should emit reusable descriptors once. The runtime adapter should
implement algorithms once. A descriptor containing existing contract knowledge
is not a second transport kernel.

## The concrete Autopilot win

Today's Task transition crosses a write planner, controller, list overlay,
shared pending-command store, query ownership helpers and live reconciliation.
These modules are not all waste: they contain real product behavior. The useful
split is responsibility, not a promised percentage of lines deleted.

| Task-board responsibility                                                | Preferred owner                             |
| ------------------------------------------------------------------------ | ------------------------------------------- |
| Input/output/declared-error types, canonical keys                        | Generated descriptor                        |
| First snapshot, watch sharing, cancellation, reconnect generation        | Adapter using the existing client transport |
| Pending layers, rollback isolation, commit/observation bookkeeping       | Adapter                                     |
| Conservative affected Query families where statically provable           | Compiler projection                         |
| Allowed transition, expected version, conflict UX                        | Autopilot and server Mutation               |
| Optimistic placement under board filters, assignee lenses and pagination | Autopilot's typed reducer                   |
| Authorization, actual membership/order/counts                            | Server Policy and Query                     |

For example, moving a task from **Doing** to **Done** should require the domain
transition input and one optimistic view reducer. That reducer can update the
visible detail and move the card between eligible loaded bands. It must not
invent an unloaded page, authoritative count or server permission.

The adapter should keep the latest authorized base plus ordered pending layers.
If move A fails while later edit B succeeds, it removes A and reapplies B to the
current base. Restoring an old whole-cache snapshot would lose B. Autopilot should
not reimplement this bookkeeping for Tasks, Library and conversations.

This does **not** mean a Mutation can infer its optimistic business result from
its input codec. A transition may trigger normalization, reject a version, alter
visibility or execute lifecycle work. The application's ordinary TypeScript
reducer is precisely the part that cannot safely be inferred.

Current evidence is the dirty local Autopilot checkout, not an audited production
deployment. Its new local v4 Query adapter has no consumers yet. Existing v3 Query
integration and shared overlay code already exist; this proposal replaces their
mechanical responsibilities rather than introducing Query caching for the first
time. Detailed paths and limitations are in the research evidence.

## Invalidations should be inferred where the compiler can prove them

For a local successful Mutation, intersect conservative possible writes with
each public Query family's possible reads. Include relation, Policy, Context and
lifecycle dependencies. False positives cost a refresh; false negatives show
stale data. Unknown dependencies are not an empty set.

Current artifacts contain useful structural information but often only broad
capability supersets, not precise per-Mutation writes or per-Query reads. A safe
first projection may therefore invalidate more families than desired. Prove the
closed projection before promising automatic precision. Do not require authors
to repeat a map that the compiler already knows, and do not expose private
Policy dependencies or branch-specific write sets to achieve it.

Active Live Queries already receive server-driven invalidation; do not add an
HTTP refetch after every Mutation merely to duplicate that mechanism. Inactive
one-shot caches can be marked stale. Remote writes and later Job effects need
the existing watch or an explicit refresh policy; local Mutation inference does
not magically observe them.

## Optimism needs two answers, not one `isSuccess`

“The Mutation committed” and “this view observed a post-commit snapshot” are
different facts. Today's successful generated call returns the decoded result;
watch deliveries do not expose a transaction-coverage fence. A transaction ID
must not be treated as an ordered version counter.
[ADR-0023](../../../adr/0023-freeze-post-commit-operation-outcome.md).

The smallest candidate needs no new public wire field: after a known commit,
open a generation-fenced fresh watch and wait for its first authorized snapshot.
The current client opens new watches without a resume token. A fresh primary
database snapshot after the commit can establish observation even for equal
values, deletes and filtered-out rows. This is an inference to prove against
registration races, not a guarantee established by these upstream probes.

It costs a fresh read/watch generation per affected view unless safely coalesced.
Only commits already known before opening that generation can share its fence.
If this is too expensive, evaluate an opaque scoped observation receipt as a
separate Kernel change. Do not derive one by comparing maximum PostgreSQL XIDs.

Track write outcome separately from synchronization: a timeout can mean unknown
outcome, and a committed write can fail to refresh. Neither is evidence of server
rollback. A bounded “committed, refresh unavailable” state is preferable to
claiming confirmation or silently reverting to a stale view. Its presentation
and recovery rules still require the focused decision below.

## Where TanStack DB fits

Use a custom full-snapshot sync adapter over the same generated Query watch for
eligible keyed results. Infer a key only when the compiler proves a stable
projected identity; arbitrary object codecs with an `id` field are not proof.
Non-inferable keys require an explicit typed choice. Scalar/object Queries remain
ordinary Query results.

Each server Query remains an authorized projection with its own membership and
window. Rows with the same ID in two projections are not permission to union
their fields into one universal browser entity. Local joins cannot fetch missing
server rows, authorize an operation or make independently delivered Queries
transactionally atomic.

Do not initially route QUESTPIE live snapshots through `query-db-collection` just
to reuse the Query adapter. The inspected version does not select full-row
replacement, while QUESTPIE snapshots must remove fields that are no longer
present. A direct custom sync boundary is smaller than repairing both ownership
layers. Query and DB may serve different views in one app; the same result should
have one transport and optimistic owner.

## The probes changed the recommendation

Published-package probes ran successfully against Query Core 5.102.8 and DB
0.8.7. These are synthetic library tests, **not** QUESTPIE conformance tests:

- Default DB partial updates retain omitted fields; full updates remove them.
- DB truncate preserves a pending optimistic row.
- DB cleanup empties the collection, but a pending successful write can later
  repopulate it. A retained handle can also restart synchronization. A completion
  guard prevented repopulation in the isolated case.
- Waiting for a DB sync-applied receipt inside the persisting handler can form a
  cycle: application waits for that handler to finish.
- Awaited Query invalidation can resolve after a failed refetch while old data
  remains cached in the error state.
- `experimental_streamedQuery` can expose the first data while its fetch promise
  remains pending and `fetchStatus` stays `fetching` until the stream ends.

These are integration constraints, not upstream vulnerability claims. In
particular, authority retirement must fence late writes and callbacks, cancel
observers, clear protected base and optimistic state, and reject stale handles.
Cache cleanup alone is insufficient. See the [reproducible probes](upstream-probes/README.md).

There is also a nonterminal case: an otherwise successful authorized snapshot
can remove fields or rows while a write remains pending. Full-row replacement
only fixes the synced base; a pending DB overlay can still retain an omitted
field. Old optimistic data must not restore information removed from the new
authorized projection. Prove that overlap explicitly, not just logout and denied
responses; the conservative layer-retirement rule remains part of the decision.

Fable 5.1 reviewed the alternatives in two successful research rounds. The second
round corrected assumptions about DB full-row updates and generated metadata.
The recommendation uses the corrected source evidence, not model agreement as
acceptance proof.

## What comes next

Use the [bounded decision and tracer map](DECISION-MAP.md): settle the outcome /
observation boundary, prove generated descriptors and scope retirement, then
exercise **Task detail plus board**, followed by conversation reconciliation.
Only then extract and migrate the public adapter. Do not finish at a working
`useQuery` wrapper.

TanStack Query is the proposed primary work. TanStack DB stays a separate optional
proof, not a hidden dependency or an automatic beta-2 blocker. Placement of this
new integration in beta 2 versus the following beta remains a release-scope
decision. This research does not grant release acceptance or change Autopilot's
released-artifact migration gate.
