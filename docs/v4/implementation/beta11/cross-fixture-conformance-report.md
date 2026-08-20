# BETA-11 cross-fixture conformance

The archive fixture reuses the accepted compiler, Context, Policy, relational,
Operation, watch, and durable kernels. It adds no archive-specific public API
and no second Runtime. Its purpose is to make collaboration-shaped assumptions
fail visibly.

| Assumption under test                     | Collaboration evidence                                                                                                                                             | Archive counterexample                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every aggregate has one UUID `id`         | Message has a UUID primary key (`fixtures/collaboration/src/messages.ts:8`–`:23`).                                                                                 | Record uses the text natural key `(archiveCode, catalogueNumber)` and has no `id` (`fixtures/archive/src/records.ts:5`–`:31`).                                                                                                                                      |
| Context tenancy is membership lookup      | Collaboration resolves Context through the caller's active membership (`fixtures/collaboration/src/execution.ts:41`–`:72`).                                        | Archive resolves an Institution by archive code, then obtains its tenant identity (`fixtures/archive/src/execution.ts:5`–`:20`).                                                                                                                                    |
| Policy is tenant equality plus membership | Message rows follow Channel → Space → Company and active Membership evidence, including tenant equality (`fixtures/collaboration/src/message-policy.ts:10`–`:37`). | Record rows combine Embargo absence with relation-backed ResearchPermit evidence and never read the tenant execution fact (`fixtures/archive/src/archive-policy.ts:8`–`:35`).                                                                                       |
| Normal data means mutable CRUD            | Collaboration exposes reads and Message create, with ordinary mutable collaboration entities (`fixtures/collaboration/src/message-operations.ts:14`–`:37`).        | Archive exposes create only for Record and Provenance; no update or delete operation is authored (`fixtures/archive/src/archive-operations.ts:7`–`:36`).                                                                                                            |
| Durable work may rewrite the aggregate    | Collaboration creates Message and MessageEvent rows before dispatch (`fixtures/collaboration/src/message-publish.ts:30`–`:60`).                                    | Record deposit creates the Record, appends provenance sequence 1, and dispatches a Reaction (`fixtures/archive/src/record-deposit.ts:24`–`:47`); the Reaction appends sequence 2 without updating either row (`fixtures/archive/src/record-deposited.ts:34`–`:50`). |

The structural tracer compiles both the composite key and text query parameter,
asserts that generated archive artifacts contain no collaboration name, and
byte-reproduces the committed migration
(`tests/integration/beta11-archive.test.ts:13`–`:111`). The connected tracer
changes Embargo and ResearchPermit evidence externally, proves foreign
Institution nondisclosure, observes an append through the generated watch,
restarts the application before polling durable work, and verifies the recovered
Reaction's second provenance row
(`tests/integration/postgres/beta11-archive.test.ts:263`–`:415`).

One portability defect was found rather than hidden: the compiler projected an
unbounded text Data Query parameter as `{ kind: "text" }`, while the shared
Runtime scalar decoder requires explicit bounds and collation. BETA-11 now
projects null bounds plus `questpie.binary` and holds that shape in the archive
structural tracer (`packages/compiler/src/relational/discovery.ts:185`–`:194`,
`tests/integration/beta11-archive.test.ts:73`–`:89`). UUID-only collaboration
parameters could not expose that defect.

The first connected run also found that `query.always()` Field authority SQL
carried every caller-input parameter even though its constant SQL referenced
none. Runtime readiness correctly refused that invalid plan. Constant checks now
return before candidate parameter construction, while non-constant checks keep
their candidate CTE (`packages/compiler/src/mutation/postgres.ts:291`–`:328`).
The lowering test holds the exact zero-parameter invariant
(`tests/unit/beta06-postgres-operation-lowering.test.ts:425`–`:430`); the archive
fixture retains the natural `query.always()` authoring form rather than hiding
the defect behind self-equality expressions.

This report would cease to prove portability if archive gained a private
execution path, if the test bypassed generated `createApplication`, or if future
authority required update/delete semantics for Record or Provenance. In those
cases the fixture and both tracers must be revised rather than treating archive
as a naming variant of collaboration.
