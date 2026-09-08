# Native React Query production delivery

Implement the architecture ratified by [ADR-0044](../../../adr/0044-native-react-query-integration.md)
through runnable production consumers. The committed [review record](../../prototypes/react-query-integration/REVIEW.json)
has verified PASS for architecture, not production extraction or beta.2 release.
Authority projection is a separate prerequisite owned by the integration agent.
This plan neither projects authority nor requests another architecture review.

The [owner-confirmed scope](../../research/react-tanstack-integration-2026-09-08/BETA2-SCOPE-DECISION.md)
and [decision map](../../research/react-tanstack-integration-2026-09-08/DECISION-MAP.md)
remain inputs. Existing prototype checkpoints are regression seeds, not a second
implementation to ship. Current prototype compatibility is `prototype.v4`;
v1–v3 references describe historical checkpoints. Production has one fresh
internal contract version and no prototype-version compatibility branch.

## Implementation contract

The application imports one optional `createQueryAdapter` from
`questpie/react-query`, supplies its generated scope and native QueryClient,
and consumes native Query/Mutation options. Compiler output supplies exact
Operation identities, codecs, errors, watchability and proven forward-cursor
parameters. No authored DTO, key map, endpoint map, generated sibling adapter,
public descriptor getter or provider SPI is added.

| Responsibility           | Owner and invariant                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types and compatibility  | Compiler directly renders the neutral versioned scope capability and exact generic types; separate bundles interoperate without a shared registration module. Symbol reflection is not a security boundary.                    |
| Disclosure and execution | Existing generated decoder, HTTP/SSE transport and Runtime Policy remain authoritative. Validated Mutation failure provenance is private, correlated to Operation and invocation, and cannot be forged by public constructors. |
| Cache and hooks          | Native QueryClient, observers and React hooks own results. One optional adapter owns computed scope keys and lifetime, without Query Resource as an intermediate cache.                                                        |
| Server writes            | Existing Mutation transaction, receipt, Change Ledger and Job acceptance remain unchanged. Unknown outcome is not rollback; disposal neither cancels a dispatched write nor retries it.                                        |
| Host identity and SSR    | The application owns credential/Context replacement, per-request QueryClient, native Router hydration and initial readiness. The adapter contributes identity bootstrap and bounded retirement fencing, not a serializer.      |
| Refresh                  | Known local commits invalidate the conservative public non-live family superset. Existing watches own continuing live updates. Refresh completion proves neither cross-view atomicity nor observation of a particular commit.  |
| Pending UI               | Application-owned native Mutation state renders pending intent separately from the current successful authorized result; no whole-cache rollback or framework optimism engine.                                                 |

No new server lifecycle, OTel behavior, schedules, workflows, TanStack DB,
live infinite pagination, offline/persistence, command-nonce deduplication or
Autopilot migration enters these tickets. Retain neutral `.observe` consumers.

## Tickets and blocking edges

Statuses are implementation work, not product-acceptance verdicts. Each ticket
starts in a fresh focused context with its authority, predecessor evidence and
one failing consumer test. Record completion evidence at its coherent commit.

| Ticket | Tracer outcome                                                                    | Blocked by                                            | Initial state                        |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| NRQ-00 | Verified architecture projected into authority                                    | Committed verified ADR-0044 PASS                      | Integration owner handles separately |
| NRQ-01 | Full-source generated native Query/Mutation through the real public factory       | NRQ-00                                                | Ready after projection               |
| NRQ-02 | Native live/Mutation lifetime and multi-family refresh against PostgreSQL         | NRQ-01                                                | Blocked                              |
| NRQ-03 | Forward infinite and all required Start execution modes in a real browser         | NRQ-01; NRQ-02 retirement owner for final integration | Blocked                              |
| NRQ-04 | Golden Support Desk UI and typed pending-intent recipe use production exports     | NRQ-02, NRQ-03                                        | Blocked                              |
| NRQ-05 | Relocated packed consumers, docs/skills and obsolete React deletion agree         | NRQ-04                                                | Blocked                              |
| NRQ-06 | Combined candidate is eligible for aggregate beta.2 acceptance and manual preview | NRQ-05 and all other beta.2 lanes                     | Blocked                              |

After NRQ-01, independent agents may build NRQ-02's PostgreSQL consumer and
NRQ-03's Start consumer in disjoint files. One owner changes shared adapter
lifetime code. Package verification work may start early against NRQ-01, but
NRQ-05 cannot close before the golden migration. Never compile into another
agent's generated directory or share a disposable database target.

### NRQ-01 — generated public factory tracer

**First red:** add `tests/integration/native-react-query.test.ts` and its
strict generated consumer: compile a real fixture, import its generated client
and `questpie/react-query`, then execute an ordinary Query and named Mutation
through native observers. The current missing production export/capability
must fail; no handwritten descriptor or source-path alias may supply it.

**Implement:** directly lower through the existing compiler client renderer,
using Operation contracts, Context codec, query projection and watchability
inputs. The generated scope attaches one immutable internal compatibility
capability before freezing; a type-only brand retains exact generic contracts.
Keep decoder-owned WeakMap failure provenance at validated decoder exits.
Move the accepted adapter behavior into one domain-owned production module;
emit no guarded string replacements or post-build instrumentation.

Add the optional subpath/declarations/build wiring to `questpie`. Keep exactly
the existing two public npm packages. Bundle audited `@noble/hashes`, initially
the proved 2.4.0 pin, inside the optional adapter build; it is a build dependency,
not a host peer or third package. Extend `scripts/build-public-package.ts` with
a targeted optional-entry Bun build while preserving TypeScript declarations
and required third-party license material. Root/generated-client code must not
reach that bundle. Native Query/React peers are optional for core consumers;
record exact tested versions and supported peer ranges in package metadata.

**Exit:** positive Query/Mutation/error inference plus negative unknown-name,
wrong input, raw timestamp, unguarded error and forged scope tests; independent
client/factory browser bundles; wrong capability/projection version refusal
before work; unchanged direct/network codec outcomes; real committed and forged
post-commit failure classification. Build twice from equivalent relocated source,
compare relevant generated/artifact bytes, and start Runtime with its unchanged
complete integrity inventory. Source order and stale generated files cannot
supply current metadata. Root/generated client must build without resolving
React/TanStack or adapter hashing code. Run compiler and questpie typechecks,
architecture/package checks and the measured generated-type budgets.

Prototype seeds: `factory-seam*`, `generated-client.test.ts`, `generation.test.ts`
and private decoder hostiles in `mutation-lifetime.test.ts`.

### NRQ-02 — live authority and local commit tracer

**First red:** port the native Collaboration consumer into a production
integration test using the actual public factory, not prototype instrumentation.
Observe two different `messages.page` inputs and `channels.detail`; publish,
disconnect/reconnect, remove a row, change membership Policy, then retire scope.

**Implement and prove:** finite first snapshot; shared active watch; full Field/
row replacement; prefetch, disabled observer, last subscriber and GC cleanup;
no abandoned-options input registry. Preserve reusable ordinary-GC options but
terminal failure fencing of old options. Keep opaque failed-key markers only
for the binding lifetime and document their failure-cardinality retention cost.

Exercise completed and pending native Mutations during retirement: clear owned
observers/cache, preserve another scope, fence late disclosure, preserve safe
committed/unknown/rejected disposition and call identity, reject replayed decoder
errors from another Operation/invocation, and contain throwing cleanup subscribers.
Already-running application callbacks are explicitly outside cancellation.

Prove two distinct non-live public families refresh/stale after decoded success
or correlated committed-result failure. Cancel older active/inactive initial
reads first. Preserve native disabled/static behavior; failure of refresh cannot
replace Mutation result/callback. Unknown/forged failures do not imply commit.
Ordinary browser live families, including inactive hydrated entries, do not get
blanket HTTP refetches; server/infinite modes remain one-shot targets.

**Exit:** production native tests plus disposable PostgreSQL 17 replay-gap/full-
replacement, real membership Field omission and terminal denial, separate scopes,
distinct families and no Mutation retry even under native retry defaults. Existing
kernel receipt, retention, lifecycle and inverse tests remain controls, not new
implementations. Generated direct/HTTP behavior and neutral `.observe` remain
unchanged. Parameterize the disposable runner's temporary root with documented
`TMPDIR` behavior; validate exact loopback container ownership and cleanup.

### NRQ-03 — pagination and native Start delivery tracer

**First red:** production-generated Support Desk `tickets.queue` through native
infinite/Suspense infinite options, followed by a real Start browser consumer
whose ordinary, infinite and live work is held behind initial readiness.

**Implement and prove:** compiler-owned exact renamed cursor injection; no
capability inferred from arbitrary page-shaped handler output; nonempty terminal
page, native `maxPages` and retained-anchor refetch; captured immutable inputs;
separate ordinary/infinite keys and native selectors/tagged cache inference.

Use the official Router Query integration for request-local cache, codec-safe
serialization and pending streaming. Server mode performs finite calls with zero
SSE. Hydrated browser results remain usable while new ordinary, infinite and live
execution awaits the same host readiness Promise. Cancellation/retirement while
waiting cannot dispatch later. No second serializer or timeout bypass.

**Exit:** real browser coverage for all three execution modes, beyond the
prototype's native-only ordinary/infinite gate tests. Include Date hydration,
future SSR timestamps, delayed pending delivery, shared live handoff, navigation,
failed scripts and truncated/errored streams. Replace credentials during pending
SSR and a dispatched Mutation on the same native QueryClient/equal Context: old
UI/cache/options cannot regain data from late hydration or Mutation completion;
new scope succeeds; temporary retired-prefix guard detaches at readiness. Repeat
with per-request owners to falsify cross-user reuse. Record never-settling document,
script replay and bfcache exclusions; do not infer integrity from `load`.

### NRQ-04 — preferred Support Desk consumer and pending intent

**First red:** the existing golden browser journey uses production
`createQueryAdapter` with application-owned credential scope/provider lifetime;
native Query/Suspense and Mutation controls must work without the old hook.

Preserve domain-local backend Definitions, separate `web/` product UI and
`tracer/` automation, and immutable migrations/Seeds. Use one result owner and
one native cache per intended lifetime. Replace the old identity-owned subtree
on credential change rather than constructing fresh calls from retired factories.

Add the preferred typed pending-intent recipe to this consumer. Infer Mutation
variables/results/onMutate context from generated options; keep pending intent
separate from successful authorized base. Demonstrate overlapping error/success,
Field/row omission, known post-commit failure, unknown response and retirement
without a saved-cache rollback or no-flicker claim. Preserve ordinary userland
domain nonce, expected-version and conflict behavior.

**Exit:** PostgreSQL 17 plus actual Firefox golden journey, typed recipe and
credential switch; no repeated DTOs/keys or prototype imports. Public how-to and
fixture README examples compile with this same interface. Retain Collaboration's
neutral `.observe` journey as an explicit non-React control. Prepare a manually
inspectable local example and its UI-versus-automated-evidence checklist.

### NRQ-05 — packed migration, public guidance and deletion

**First red:** clean relocated consumer installs the built archives, imports the
production factory and generated contract without workspace aliases, and runs
native ordinary/Suspense/infinite/Mutation consumers. The dependency matrix must
also prove core install/import/build without optional React/TanStack integrations.

Verify browser and declaration resolution, compatible native peers, precise
missing/incompatible peer diagnostics on actual native use, and bundled hashing
availability without a host install of `@noble/hashes`. Do not use a fake React module to certify native hooks
or demand factory import failure from type-only peers. Verify the combined
`questpie` + `questpie-opentelemetry` install and unchanged exact OTel peer.

After NRQ-04, delete `questpie/react`, `useQueryResource`, their old-hook-only
tests and package/release/skill expectations. Retain neutral Query Resource.
Delete executable prototype sibling adapters, string instrumentation and duplicate
algorithms only after equivalent production tests own their guarantees. Preserve
historical review/evidence records. No forwarding export or old-version branch.

Finish docs and `skills/questpie` from executed packed examples: basic native
Query/Mutation, lifecycle/provider ownership, error narrowing, conservative
invalidation, pending intent limits, forward infinite/Suspense, Start hydration,
credential replacement and package prerequisites. Reference identity-safe
observability and unchanged transaction/retry semantics. Update affected repo
skill routing to the accepted subpath; never teach an unreleased fallback.

**Exit:** package/declaration/relocation matrix, no legacy imports in current
consumers, checked docs examples, `skill:check`, architecture/deletion review,
and independent Standards and Spec review against the accepted ADR.

### NRQ-06 — combined beta.2 candidate

Reconcile all other ratified beta.2 lanes and ADR-0039 scope before claiming
release readiness. Run `quality:full`, `quality:release`, the full PostgreSQL 17
lane, affected browser tracers, type/declaration checks and required real workload
load/soak on the final integrated head. Stable-runner requirements are actual
executions, not manifest validation or relabelled local timings.

Produce exact final versions/artifact manifests. Run two separately forced
package-build plus release dry-run sequences on that head, using
`bun run release -- --dry-run --artifact-manifest <generated-manifest>` and compare
the archives/recorded digests. Historical prototype passes are not final results.
Record resource cleanup and `git diff --check`. Update evidence after any fix.

Only then submit the fresh aggregate ADR-0039 candidate through its authorized
manifest-bound review, commit/verify the record and project its authority.
Present the local manual preview to the owner. Tag, push, publish, deployment
and registry changes still require explicit authority; this ticket does not
grant it. Keep outstanding external stable-runner/manual gates visible.

## Working gates

For the proposed NRQ-01 test path, the initial local loop is:

```sh
bun run check:changed -- --test tests/integration/native-react-query.test.ts --typecheck questpie --typecheck @questpie/compiler
```

Later tickets substitute their actual checked-in test path, never a fictional
passing command. Keep slower PostgreSQL/browser work separate from that loop.
Run changed-file format/lint and `git diff --check` for each slice; run
`quality:full` before independent review and the release-sensitive gates before
closing combined delivery. These are planned commands, not execution results.

NRQ-00's separate authority projection is complete. NRQ-01's public-factory
consumer is green, but its first broader gate found size-budget and generated
artifact updates to finish. Follow [NRQ-01 evidence](NRQ-01-EVIDENCE.md) for the
current repair frontier. Do not reopen the accepted interface or mark the
PostgreSQL/browser successor tickets complete from synthetic HTTP evidence.
