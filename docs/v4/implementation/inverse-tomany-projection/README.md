# Bounded inverse `toMany` implementation map

- Status: planned; implementation not started
- Date: 2026-09-01
- Classification: Kernel implementation of Accepted ADR-0032 plus Product
  projection through the reference consumers
- Primary tracer: `fixtures/team-support-desk`
- Hostile consumer: `fixtures/collaboration`
- Accepted candidate: `515689baf836246f95c180bff66d1481f084c1fc`
- Verified PASS record: `985f27239a20778063650e867b8fb8e4b0a87fb3`
- Authority projection: `c77ca0599c003e5d5ce579a957128dd69ce70d0e`

## Authority

- `docs/adr/0032-freeze-bounded-inverse-tomany-query-projection.md`
- `docs/adr/0008-freeze-the-foundational-data-and-structural-query-contract.md`
- `docs/adr/0010-freeze-trusted-context-and-relational-policy.md`
- `docs/adr/0011-freeze-query-mutation-and-explicit-lifecycle.md`
- `docs/adr/0012-freeze-live-query-and-change-ledger.md`
- `docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md`
- `docs/adr/0019-freeze-semantic-kernels-and-public-surface.md`
- `docs/v4/data-model-and-query-grammar.md`
- `apps/docs/content/docs/v4/data-and-queries.mdx`

The formal proof fixes the contract. Production must integrate it into the
current relational compiler, artifact linker, generated App Contract,
PostgreSQL Runtime, Operation Wire, generated client, and Live Query owners. It
must not copy the proof kernel or introduce a second query, decoder, Policy, or
watch path.

## Outcome

An author may select one bounded inverse child array inside one Structural
Query by passing the child Collection's branded
`list({ first, where?, orderBy, select })` value to the matching inverse member.
Root and child `list` remain structurally disjoint. The compiler emits Template
v2 only for a graph containing the inverse list and retains byte-compatible v1
for every `toOne`-only graph.

One linked PostgreSQL statement authorizes and pages roots, then applies exact
inverse correlation, child row Policy, the authored filter, total child order,
and literal limit in that order. Direct, Fetch, generated-client, and watch
entry paths use the same plan and decoder. The output member is exact
`readonly Child[]`; no child and no visible child both return `[]`.

## Fixed authoring and failure contract

- `first` is a literal integer from 1 through 50.
- A Query contains at most one inverse child list and at most four selected or
  filtered Relation edges in total.
- Every child order Field is directly selected, ends in a qualifying non-null
  primary or unique key, and is unconditionally selected-output-Policy visible.
- `QP-DATA-008 orderFieldNotSelected` rejects an unselected or conditionally
  visible child order Field before artifact emission.
- `QP-DATA-022 relationDepthExceeded` rejects a fifth Relation edge.
- `QP-DATA-026 invalidInverseList` rejects the wrong child source, an invalid
  bound or selection, a non-total order, a second plural list, a child cursor,
  or unsupported child expression.
- Readiness refuses unknown versions, digest or identity mismatches, and
  unlinked plan descriptors before traffic.
- Cancellation before dispatch performs no SQL. In-flight cancellation or
  deadline cancels the statement and closes the read-only repeatable-read
  snapshot. QUESTPIE performs no automatic Query retry.
- Row, dependency, or semantic-byte overflow returns no partial root or child
  result. Public failures disclose no SQL, PostgreSQL name/detail, protected
  Field, Policy evidence, hidden identity, or hidden cardinality.

## Artifact and execution ownership

| Concern                                                       | Existing owner                                        |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| overloaded child authoring, source brand, Origin diagnostics  | relational compiler and public Collection query types |
| Template v1/v2 normalization, canonical bytes, digest         | compiler artifact layer                               |
| Query Projection and PostgreSQL Plan v1/v2 linkage            | compiler relational linker                            |
| exact readonly child result and conditional Field optionality | generated App Contract and client declarations        |
| Policy-before-limit SQL and ordinal descriptors               | existing PostgreSQL relational lowerer                |
| snapshot, cancellation, limits, decoding, nondisclosure       | existing Runtime Query execution                      |
| direct, Fetch, wire, and generated-client parity              | existing Operation execution and wire owners          |
| recursive dependencies and atomic recomputation replacement   | existing Live Query program                           |
| consumer deletion and browser behavior                        | Team Support Desk                                     |
| authority, Policy, forged-artifact, and watch hostiles        | Collaboration                                         |

Template v2 canonically adds root `maximumRelationEdges: 4`. Its one inverse
node binds the output key, resolved inverse Relation identity, source
Collection identity, literal bound, normalized filter, total order, and
recursive exact selection. Projection v2 and PostgreSQL Plans v2 additionally
bind template version/digest, exported statement bytes, ordered parameters and
bindings, result descriptors and nullability, compiler-owned ordinals,
root/child Policy digests, decoded root cursor order tuple, statement digest,
App Contract, and Runtime Build.

The Runtime groups flattened positions by linked ordinals, computes root
`hasNextPage` from distinct root ordinals, discards the complete sentinel root,
and publishes only a completely decoded result. The structural maximum is
5,050 positions for root `first = 100` and child `first = 50`, including the
sentinel group. Existing 1 MiB result and 256 dependency-token bounds remain
unchanged.

## Tracer-bullet tickets

### INV-01 — Compile one exact child-owned inverse list and its diagnostics

Blocked by: none.

Start with red authoring and compiler tests for one Team Support Desk ticket
detail selection. Carry the child Collection source brand through structural
evaluation and normalize the closed child-list grammar. Produce exact Origin
diagnostics and no artifact for wrong source, dynamic/out-of-range `first`,
empty/unknown selection, non-total order, unsafe child order disclosure, a
second plural list, nested cursor, and a fifth Relation edge. Retain the root
`list` overload and prove mixed variable objects remain invalid.

Acceptance:

- one real fixture definition compiles the accepted nested syntax;
- all `QP-DATA-008`, `QP-DATA-022`, and `QP-DATA-026` hostiles fail before
  artifact emission with safe path and Origin only;
- recursive `toOne` v1 fixture bytes and current root-list typing remain
  unchanged; and
- focused compiler/type tests, format, lint, architecture, and
  `git diff --check` pass.

### INV-02 — Link Template v2, generated types, and digest-bound plans

Blocked by: INV-01.

Take the accepted fixture from source through canonical Template v2, Query
Projection v2, PostgreSQL Plans v2, Runtime Build, App Contract, and generated
client declarations. Emit v1 for all `toOne`-only graphs. Make the generated
ticket result expose one exact readonly comments array with optional
conditional Fields and no child page/cursor surface.

Acceptance:

- canonical bytes and digests match committed positive vectors and change for
  every bound inverse fact;
- v1 and v2 readers fail closed on unknown versions, cross-version digest
  substitution, forged inverse/source identity, ordinal, column, Policy, App
  Contract, or Runtime Build linkage;
- declarations prove exact `readonly Child[]`, `[]` rather than nullable list,
  and conditional child Field optionality; and
- packed compiler/generated artifacts contain one current v1/v2 owner with no
  compatibility decoder or copied proof artifact.

### INV-03 — Execute one Policy-aware PostgreSQL plan with full entry parity

Blocked by: INV-02.

Run the linked plan through the existing Runtime relational kernel in one
read-only repeatable-read snapshot. The same tracer must cross direct
execution, Fetch, generated network client, and watched recomputation. Prove
root sentinel handling, child Policy before order/limit, exact empty arrays,
Field omission, limits, cancellation, deadline, decoder hostiles, and safe
failures.

Acceptance:

- one Query dispatches exactly one PostgreSQL statement and no N+1 or JSON
  aggregation sibling;
- direct, Fetch, generated client, and watch return byte-equivalent semantic
  results and normalized failures;
- cancellation before dispatch performs zero SQL; in-flight cancellation and
  deadline roll back the snapshot and leave the connection reusable;
- dependency compilation covers inverse/source/correlation, child and nested
  Policy evidence, empty misses, filter/order/root-page/list boundaries, and
  successful recomputation atomically replaces the complete dependency set;
- PostgreSQL 17 hostiles prove ordinal, disclosure, row/byte/dependency, and
  artifact-link refusal without detail leak.

### INV-04 — Migrate Team Support Desk and delete the second comments path

Blocked by: INV-03.

Make Team Support Desk the golden beginner/DX consumer. Move the ticket detail
payload to `tickets.comments: comments.list(...)`, preserve its published
Operation shape, and drive the generated client and Firefox UI through that
single Query. Delete the former comments page Query, plan, request/Promise leg,
browser mapper/state alias, and obsolete fixture prose once nothing consumes
them.

Acceptance:

- ticket detail renders the compiler-produced child array over the generated
  client and refreshes from a committed comment rather than echoing Mutation
  input;
- empty, hidden, newest-first, tie-break, and conditional-body cases pass on
  PostgreSQL 17 and Firefox;
- generated negative types prove the removed comments Query is absent; and
- no `window` spelling, compatibility alias, duplicate Query, second decoder,
  or fallback request remains.

### INV-05 — Close Collaboration authority and Live Query hostiles

Blocked by: INV-03 and INV-04.

Use Collaboration as the security consumer. Exercise cross-tenant children,
row-Policy hiding before limit, conditionally disclosed child Fields,
order-boundary changes, inverse-key moves, Policy revocation, empty misses,
forged linked artifacts, cancellation, and failed recomputation. Keep one
relational and one Live Query owner.

Acceptance:

- protected value, hidden child identity/cardinality, Policy evidence, SQL,
  PostgreSQL detail, and forged ordinals never reach callers or observations;
- relevant committed changes dirty the watch and only a successful fresh
  authorized snapshot replaces dependencies and output;
- direct/network/watch parity holds for success, cancellation, limits, and
  sanitized `INTERNAL`; and
- independent deletion review finds no fallback, v1 reinterpretation, second
  plural kernel, or test-only production seam.

### INV-06 — Finish public docs, release evidence, and independent review

Blocked by: INV-01 through INV-05.

Reconcile the already published guide with final generated declarations and
fixture evidence. Cover the simple ticket/comments example, why the nested
list is structural rather than an Operation, exact typing, child order/Policy
rules, bounds, absence of child cursors and retries, transaction/cancellation,
direct/network/watch parity, diagnostics, and nondisclosure.

Acceptance:

- public docs build and their examples compile against packed packages;
- Team Support Desk PostgreSQL/Firefox and Collaboration hostile tracers pass;
- focused package/declaration checks, `quality:release`, and two byte-identical
  release dry-runs pass with recorded digests;
- independent Standards and Spec reviews pass over the complete vertical;
- all temporary databases, browsers, hosts, ports, generated output, and
  tarballs are cleaned; and
- `git diff --check` passes with coherent commit boundaries and no push, tag,
  publish, or deployment.

## Test-first and deletion rules

Each ticket begins with the smallest failing test that crosses its claimed
boundary and uses `bun run check:changed` for the short loop. Generated files
change only through their compiler owner. Every ticket runs focused unit/type
tests, the smallest relevant PostgreSQL 17 tracer, direct/wire parity where
applicable, format/lint, and `git diff --check`; topology changes also run
`architecture:check`.

Delete superseded syntax and consumers in the same slice that makes them
unused. Do not keep aliases, compatibility decoding, dual v1 emitters, a second
CRUD/query kernel, copied SQL owners, hidden fallbacks, or test-only production
injection. Historical Template v1 reading and emission for `toOne`-only graphs
is the accepted current protocol behavior, not a fallback.

## Explicit non-goals

- no second inverse child list, child cursor or `pageInfo`, aggregates,
  quantifiers, offset/backward paging, or implicit order;
- no polymorphic or synthetic many-to-many Relation;
- no React adapter, client dot projection, OpenAPI/MCP projection, lifecycle
  change, or OpenTelemetry work;
- no second relational decoder, JSON aggregation kernel, N+1 execution, raw
  SQL escape, or automatic Query retry; and
- no push, tag, publish, or deployment in this implementation map.
