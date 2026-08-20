# BETA-11 backend acceptance

BETA-11 proves that the beta.1 compiler and Runtime are portable beyond the
collaboration fixture. Institution, Record, ResearchPermit, Embargo, and
Provenance use text natural keys, relation-backed authorization, append-only
application operations, and restart recovery through the same generated App.
No archive-specific public API or second Runtime was added.

## Fixture and generated contract

Record has no `id`; its primary key is `(archiveCode, catalogueNumber)` and its
page index closes over that order (`fixtures/archive/src/records.ts:5`–`:47`).
ResearchPermit binds programme, Institution, and Principal as relation evidence
(`fixtures/archive/src/research-permits.ts:5`–`:31`). Embargo and Provenance use
the same composite Record key, while Provenance adds sequence to form its
append order (`fixtures/archive/src/embargoes.ts:5`–`:33`,
`fixtures/archive/src/provenance.ts:5`–`:43`).

Context resolves an Institution by its public archive code and derives tenant
identity from that record (`fixtures/archive/src/execution.ts:5`–`:20`). Policy
does not authorize through tenant equality. A public Record is visible only
without an active Embargo; an active ResearchPermit independently admits the
Record, controls restricted body disclosure, and gates deposit
(`fixtures/archive/src/archive-policy.ts:8`–`:70`). Provenance read and create
also require an active permit (`:73`–`:96`).

The committed six-file genesis migration is reproduced byte for byte from the
current schema projection by the structural tracer. That tracer also asserts
the exact five Collections, composite Record key, permit and embargo Policy
evidence, absence of tenant execution facts, absence of Record update/delete,
the Reaction projection, the complete unbounded text parameter codec, absence of RLS
claims, and absence of collaboration names from every generated artifact
(`tests/integration/beta11-archive.test.ts:13`–`:114`).

## Connected append and hostile evidence

The semantic `record.deposit` Mutation creates one Record, appends provenance
sequence 1, and dispatches `recordDeposited` in the same accepted mutation
boundary (`fixtures/archive/src/record-deposit.ts:5`–`:48`). The Reaction
rereads through the same Policy-bound Data Query, then invokes an internal
Mutation with a run-stable call identity
(`fixtures/archive/src/record-deposited.ts:7`–`:51`). That internal Mutation
appends the literal provenance sequence 2
(`fixtures/archive/src/provenance-record-reaction.ts:5`–`:25`). Record and Provenance
Collection Operation Sets expose create only
(`fixtures/archive/src/archive-operations.ts:7`–`:36`). “Immutable provenance”
therefore means immutable through the generated application mutation surface;
it does not claim PostgreSQL prevents a deployment owner from issuing raw SQL,
consistent with the accepted no-RLS boundary.

The PostgreSQL tracer begins with an active Embargo and no reader permit,
expires the Embargo through an external writer, inserts and then revokes a
ResearchPermit, and verifies guarded body disclosure at each step
(`tests/integration/postgres/beta11-archive.test.ts:284`–`:318`). In the initial
control, the authorized Principal sees both national Records through its active
national permit but sees no foreign Record through a foreign Context
(`:285`–`:288`), proving the permit relation does not leak across Institutions.
The generated client opens a watch, the generated direct Mutation deposits
N-003, and the watch observes that append (`:320`–`:381`). The application then
closes before durable polling, a fresh generated application claims the retained
run, and the final Query observes provenance sequences 1 and 2 (`:383`–`:413`).

This is one Runtime and one set of compiler-owned kernels. Direct SQL appears
only in setup and hostile evidence changes; application behavior runs through
generated `createApplication`, `execution`, `fetch`, client watch, and durable
poll. The cross-fixture matrix records the collaboration assumption each
archive shape falsifies
(`docs/v4/implementation/beta11/cross-fixture-conformance-report.md:1`–`:50`).

## Portability repairs

The tracer found two shared-kernel defects rather than encoding fixture
workarounds. First, an unbounded text Data Query parameter was projected without
the null bounds and binary collation required by the Runtime scalar contract.
The public `query.parameter.text` factory accepts only `nullable: false` and has
no authored bound options
(`packages/questpie/src/relational/query.ts:268`–`:272`). The compiler therefore
emits the complete unbounded text codec with null bounds and binary collation
(`packages/compiler/src/relational/discovery.ts:185`–`:193`), and the archive
test pins all four codec members
(`tests/integration/beta11-archive.test.ts:75`–`:88`).

Second, a constant `query.always()` create Field check carried caller-input
parameters that its SQL did not reference. Constant checks now return before
candidate parameter construction; non-constant checks retain the candidate CTE
(`packages/compiler/src/mutation/postgres.ts:291`–`:328`). The unit regression
requires both constant checks to have empty parameter vectors
(`tests/unit/beta06-postgres-operation-lowering.test.ts:425`–`:430`). The archive
Policy retains `query.always()` (`fixtures/archive/src/archive-policy.ts:49`–`:56`,
`:97`–`:104`).

## Budgets and verification

The BETA-11 selected-PR micro scenario measured three reference-local archive
compiles. The median was 1,719.437 ms, with 751,190 generated bytes and 16,808
TypeScript instantiations, inside the owned 5,000 ms, 1,048,576-byte, and
125,000-instantiation budgets
(`docs/v4/implementation/beta11/archive-portability-budget-report.md:1`–`:29`).
The issue-prescribed changed loop passed with the structural test and Runtime
typecheck; the structural test itself completed in 1.663 seconds. The connected
PostgreSQL 17 scenario passed in 12.179 seconds with 14 assertions. The final
`bun run quality:full` passed 350 tests with zero failures, plus architecture,
format, lint, typecheck, Knip report, generated goldens, build, docs, and skill
validation. `git diff --check` passed.

The PostgreSQL wall-clock is correctness evidence, not a stable microbenchmark:
watch reconciliation and restart scheduling intentionally contribute latency.
The independently registered compile scenario is the stable-runner budget.

## Limits and overturn conditions

Search, File bytes, archive-specific network concepts, a second Runtime, Studio,
and mutable Record/Provenance update or delete are not part of this slice.
The fixture is independently demoable through its generated App and test tracer;
packaged-consumer and managed-provider evidence belong to BETA-12.

The portability judgment would be overturned if any archive behavior bypassed
the generated application, if authorization depended on a hidden tenant-equality
shortcut, if update/delete appeared for Record or Provenance, or if restart
recovery required process affinity. New Accepted authority requiring database-
owner immutability, rather than application-surface immutability, would also
require a distinct storage-level guard and migration contract.
