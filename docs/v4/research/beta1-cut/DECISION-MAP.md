# QUESTPIE 4.0.0-beta.1 decision map

- Status: research frontier; no acceptance authority
- Scope: the thinnest usable docs-first server vertical after the accepted
  Collection foundation
- Parent map: [`../framework-api-atlas/DECISION-MAP.md`](../framework-api-atlas/DECISION-MAP.md).
  This beta cut is derived from the ideal whole-product contract; it cannot
  choose shortcuts that preclude its Realtime, durable execution, Workflow,
  Route, Action, Studio, Auth, File, or Search ownership seams.
- Rule: evidence may narrow choices, but only an accepted contract can freeze
  public behavior or authorize implementation
- Design discipline: `SPEC.md`, `CONTEXT.md`, and Accepted ADRs are the default
  authority. Prefer the smallest interface consistent with them. A proposed
  deviation must name the contradicted decision, demonstrate a concrete need,
  compare the simpler design, and earn focused evidence before acceptance.
- Authoring quality gate: every public callback in an end-application example
  must name its contextual type source and compile as written. Positive hover/
  autocomplete fixtures, negative unknown-member/operator fixtures, emitted
  declaration shape, and TypeScript instantiation/check-time measurements are
  acceptance evidence. An illustrative callback with implicit `any`, a missing
  Collection/input binding, a manual generic needed only to rescue inference,
  or an interface that exists only in prose is a design failure, not an
  implementation detail.

## #1: What product promise does beta.1 make?

Blocked by: none
Type: Discuss

### Question

Is beta.1 primarily a framework-author preview, or must an application author
be able to compile, migrate, start a server, and safely read and write one real
Collection from a generated client?

### Answer

Resolved with the user: beta.1 must let an application author compile, migrate,
start the standalone server, and safely read and write a real Collection from a
generated client. It is not merely a compiler or framework-author preview.
Advanced lifecycle and product breadth may be explicitly absent.

## #2: Which app-neutral user journeys prove that promise?

Blocked by: #1
Type: Discuss

### Question

Choose the smallest domain-independent journeys that prove local setup, schema
change, typed read, authorized write, error behavior, and restart safety without
pulling Live Query, durable work, full Auth, or Studio into beta.1. Then choose
one disposable conformance application that exercises those journeys. The old
Barbershop example has no authority over the beta cut.

### Answer

Resolved with the user. The required journeys are domain-independent:

1. define Collections, compile the App Contract, create and apply a Migration,
   and start the standalone Runtime;
2. execute an authorized, filtered, ordered, cursor-paginated typed read through
   the generated client;
3. derive a trusted Principal and Tenant without requiring the complete Auth
   product;
4. create a row and update its state through one explicit transaction and the
   same Policy used by direct execution;
5. deny unauthorized read and write without leaking foreign-row existence, and
   return a stable declared error shape;
6. preserve schema truth and committed data across restart without requiring
   Live Query, dispatch, idempotent network replay, or Studio in beta.1.

The working conformance fixture is `workspaces`, `memberships`, and `tasks`.
Membership links a Principal to a Workspace; authorized callers can list,
create, and change the status of Tasks only inside that Workspace. This fixture
is disposable evidence, not a product model or public starter template.

## #3: What can compiler v1 already carry?

Blocked by: none
Type: Research

### Question

Inventory implemented compiler artifacts and seams against the beta journeys;
separate working code from accepted docs and proof-only prototypes.

### Answer

Resolved from the complete git history. Asset:
[compiler-readiness.md](./compiler-readiness.md). Compiler v1 is contract-ready:
accepted composition/schema/data/query documents and executable proofs close
its first artifact boundaries. It is not yet implemented as a v4 production
package. Parent commit `11617485` contains the v3.26.1 compiler/server evidence;
`48816aa1` deliberately removed those packages for the docs-first rebuild. No
missing external compiler location is required. Implement the accepted v4 path
in this repository only after the beta-critical Policy and operation contracts
close.

## #4: Which v3 `access` jobs are beta-critical?

Blocked by: none
Type: Research

### Question

Extract the authorization guarantees and hostile cases that beta.1 must
preserve, while rejecting v3 callback and builder architecture as an automatic
v4 design.

### Answer

Evidence complete. Asset: [v3-access-jobs.md](./v3-access-jobs.md). Preserve one
authorization decision across operation admission, row scope, Field input and
output, direct calls, and network calls. Reject v3's implicit system bypass,
ignored create filters, unequal read/write predicate meanings, arbitrary raw
SQL, transport-sensitive rules, and unrelated fallback chains.

## #5: Which v3 server and hooks jobs are beta-critical?

Blocked by: none
Type: Research

### Question

Separate the minimum safe Collection write lifecycle from later validation,
transformation, post-commit Reaction, external Action, and durable-work breadth.

### Answer

Evidence complete. Asset:
[v3-lifecycle-and-server-jobs.md](./v3-lifecycle-and-server-jobs.md). Beta needs
one direct/client semantic write path, runtime codecs and validation, Policy,
create plus by-key update, one operation-owned transaction, joined nested
writes, stable errors and bounds, and a future change-identity seam. It does not
need the v3 hooks catalogue, lossy after-commit callbacks, or external effects.

## #6: What is the minimum beta Policy contract?

Blocked by: #1, #2, #4
Type: Discuss

### Question

Close operation admission, row scope, create/update authority, output and input
Field filtering, Principal/Tenant facts, fail-closed behavior, generated-client
parity, and database enforcement. Decide whether derived RLS contributes any
required beta guarantee or remains deferred.

### Answer

Partially resolved with the user. Beta Policy is the single authorization
model and covers operation admission, SQL row scope, and create/update/read
Field authority. Principal and Tenant are immutable for one Execution; System
Authority is explicit and there is no ambient direct-call bypass. A Policy that
cannot be enforced without breaking exact cursor semantics fails closed. RLS is
deferred from beta.1. Server-owned Field assignment and value overwrites belong
to #6A/#7G; update lock/recheck timing and exact Mutation precedence belong to
#7D.

The current minimal interface and proof agenda are recorded in
[policy-contract-design.md](./policy-contract-design.md). The recommendation is
one unique normal Collection Policy Resource attached by an exact typed
Collection reference, plus an inline explicit admission member on each named
Query/Mutation. Missing Collection operations deny; zero attached Policies make
data execution unavailable; two are an ambiguity error. `ctx.data` always
applies the unique target Policy and a handler cannot select or bypass it.

Operation input/output selection is the exact maximum surface. Policy rules
only name conditional narrowing, so ordinary Fields are not duplicated in an
allow list and adding a Collection Field exposes nothing. Input rules check only
caller-supplied paths; output denial omits a conditionally typed property;
Policy never supplies values. Row scope reuses the accepted closed Query
predicate semantics, is fully pushed into SQL, and has no post-filter fallback.
System Authority grants nothing implicitly and must be admitted explicitly.
Relation selection applies source and target Policies; RLS stays downstream and
deferred.

The first draft incorrectly extracted `policy.rows(({ fields }) => ...)` before
binding a Collection, so `fields.workspaceId` had no valid contextual type
source. The corrected happy path places `rows` directly inside
`definePolicy({ collection: tasks, ... })`; `typeof tasks` supplies exact Field
keys/codecs and trusted Policy facts are exposed directly rather than hidden
behind an opaque `execution` bag. A reusable helper, if later justified, must
take `tasks` explicitly. This contextual typing must be proven in a verbatim
TypeScript fixture before the interface can be accepted.

User acceptance and focused proof remain pending. Exact Mutation post-image
ordering, framework error bytes, Principal/Tenant derivation adapters, and
Relation-cycle diagnostics close in their linked tickets rather than through
Policy callbacks.

## #6A: Where does Field authority end and value transformation begin?

Blocked by: #4, #6
Type: Discuss

### Question

Design Field-level read, create, and update authority without turning Policy
into a hidden Mutation hook. Close dynamic read redaction and its generated
type, authorization of only the Fields actually supplied by a caller,
server-owned assignments from Principal/Tenant, value normalization and
overwrite behavior, post-image constraints, and output enforcement. Decide
which facts are Policy decisions and which are explicit Mutation lifecycle
steps. Manual handler redaction must not become a bypass around normal
Collection Policy.

### Answer

The user requires Field-aware read/create/update behavior and explicitly raised
redaction, server-set values, and overwrites. The working separation is that
Policy authorizes a Field use while Mutation-owned behavior computes or changes
a value. Three interface variants and a recommended cumulative-gate synthesis
are recorded in
[field-authority-and-lifecycle-designs.md](./field-authority-and-lifecycle-designs.md).
The user accepted the synthesis:

- every Operation declares one static maximum input and output surface;
- Policy may only narrow that surface for the Execution or row;
- conditional output authority omits the Field and generates an optional
  property; `null` remains application data and never means redacted;
- Policy checks only caller-supplied create/update paths, so untouched denied
  Fields do not block a patch;
- a supplied forbidden path fails explicitly rather than being ignored;
- Policy decides only authority and never supplies or rewrites values;
- server-owned values belong to a separate Mutation Value Program;
- distinct business audiences should normally receive distinct named
  Resources, with conditional Field authority reserved for genuinely
  heterogeneous results or inputs.

Policy and Mutation value programs may be colocated in source for locality but
must remain separately normalized and explainable. #7G owns the lifecycle half.

## #7: What is the minimum beta server operation contract?

Blocked by: #1, #2, #5
Type: Discuss

### Question

Choose direct Collection operations versus named Query/Mutation Resources,
transaction ownership, runtime codecs, declared errors, idempotency boundary,
and which write-lifecycle phases must exist in beta.1.

### Answer

Partially resolved with the user. Beta.1 includes typed Collection read/write
primitives and an explicit first-party CRUD authoring convenience. A Collection
is not exposed automatically. The author selects exposure; the compiler lowers
that convenience before normalization into the same ordinary Query and Mutation
primitives used by hand-authored Operations. The generated client contains only
the selected surface, and direct/network calls share Policy, runtime codecs,
declared errors, and the transaction engine. The working operation jobs are
paginated list, primary-key read, create, primary-key update, and primary-key
delete; bulk writes, soft delete, restore, purge, and arbitrary raw query
objects are deferred. These job labels do not accept method names.

Resolved with the user: the default authoring surface is one explicit,
inspectable compile-time Collection operation recipe. Operations are selected
individually; each names its ordinary Resource, network exposure, exact input
Fields and output selection. The list operation embeds one accepted structural
Query. The recipe disappears after compilation and no CRUD dispatcher survives
at runtime. Exact Resource identities remain canonical; an ergonomic generated
Collection namespace must be explicit and collision-checked. The Mutation
transaction/change identity contract beneath the convenience remains open.

Resolved with the user: beta.1 also includes ordinary named Query and Mutation
Resources. A named Query is the read-only place for application computation
over several Collections; a named Mutation is the transaction owner for custom
multi-Collection business writes. Collection operations are conveniences over
these same runtime primitives, not the limit of server-side application logic.

The interface must satisfy an AI-native transparency constraint: reducing
authored boilerplate cannot create hidden behavior. Every generated default and
Resource expansion must be stable and inspectable through canonical artifacts,
Origin information, generated declarations, and structured compiler
explanation. Adding a Collection Field cannot silently change network exposure.
An agent must be able to trace one exposed method to its source declaration,
normalized Query/Mutation Resource, admission Policy, runtime codec, declared
errors, transaction owner, and handler Origin without executing the application
or reverse-engineering generated implementation code. Compiler-expanded
Collection operations and structural Query Templates additionally expose exact
static selections, inputs, order, and data dependencies. An arbitrary custom
handler's nested reads are the reads it actually executes; per `SPEC.md`, the
Runtime observes those calls. The compiler does not require a duplicate
capability manifest or pretend arbitrary control flow has one exact static data
dependency set.

## #7A: What are the canonical CRUD names and key shapes?

Blocked by: #7
Type: Discuss

### Question

Run a complete naming and supersession audit before public API acceptance. V3
and its current skill knowledge use `find`, `findOne`, `updateById`, and
`deleteById`; earlier v4 discussion used `list`; accepted v4 Collections may
have composite primary keys, so `ById` is not generally correct. Choose names
for paginated list, primary-key read, create, primary-key update, and
primary-key delete together with their exact primary-key input shape.

Then align the workbench, glossary where a real domain term changes, public
docs, generated client, implementation tests, and QUESTPIE agent skill. Do not
teach the v4 names in the skill before the contract receives PASS.

### Answer

Resolved with the user, subject to the final focused contract review. The
candidate canonical CRUD job and client method names are `list`, `get`,
`create`, `update`, and `delete`. `list` supersedes v3 `find`; `get` supersedes
`findOne`; `update` and `delete` supersede `updateById` and `deleteById`.
Primary-key operations accept an exact generated `key` object containing every
Field of the named primary-key Constraint, even for a single-Field key. Result
and missing-row semantics are closed separately with Policy nondisclosure and
declared errors in #7D.

After the complete CRUD contract receives PASS, align the workbench, public
docs, generated client, tests, and the currently v3-oriented QUESTPIE agent
skill. Do not update the skill early.

## #7B: How does one Collection operation declaration become several Resources?

Blocked by: #3, #7, #7A
Type: Discuss

### Question

Reconcile the accepted direct-export discovery and one-Owner-per-Resource
contract with the low-boilerplate Collection operation recipe. Decide whether
the recipe is a closed first-party Definition that expands before
normalization, or whether every generated Query and Mutation must instead be a
separate directly exported Definition. Close stable identities, ownership,
Origins, collisions, Package inventory, generated explanation, and the rule
that no central registration file is required.

### Answer

The user confirmed that ordinary source discovery must remain sufficient and
that application authors must not manually register these operations in a
second root. The user accepted the narrow expansion direction. The composition
audit found that the accepted direct-export rule
does not currently admit a multi-Resource container, but ADR-0007 permits a
later closed Operations contract. The recommendation is one directly exported,
branded Collection Operation Set: it is not a Resource, Resource Kind,
Augmentation, plugin, callback, or general generator. Its literal members each
establish and own one ordinary Query or Mutation Resource, collide normally,
and receive call-site Origins. The set has no runtime presence. Generic
containers and central registries remain invalid. Exact factory spelling and
canonical expansion bytes remain for the focused contract.

## #7C: What is a named multi-Collection server computation?

Blocked by: #3, #6, #7
Type: Discuss

### Question

Close the place for a read-only operation that reads several Collections,
runs application logic, and returns one typed result. Distinguish its authored
input/output codecs and handler from the accepted structural single-Collection
Query value. Decide Policy enforcement for every nested read, read consistency
and snapshot ownership, bounds, declared errors, direct/network parity, and
how the generated client names it. A write or external effect must remain a
Mutation or Action rather than silently changing this read contract.

### Answer

Partially resolved with the user: the product concept is a named Query Resource,
not Collection CRUD and not a new orchestration product. It composes typed
Collection reads under one immutable Execution and returns one runtime-validated
result through the generated client. PostgreSQL evidence in
[postgres-query-snapshot.md](./postgres-query-snapshot.md) supports one bounded
`REPEATABLE READ READ ONLY` transaction on one owned connection, shared by
Policy and every Collection read. Multi-connection snapshot export and implied
`Promise.all` parallelism remain deferred. The user accepted this snapshot
direction. Exact factory, handler, and codec contracts remain open. Aggregates
such as exact `count` are
not implied by the accepted foundational structural Query contract and need an
explicit later capability or a separate bounded computation.

## #7D: What does a beta Mutation own?

Blocked by: #5, #6, #7, #7A
Type: Discuss

### Question

Close named and generated create/update/delete execution as one Mutation-owned
PostgreSQL transaction. Decide current-row lock and Policy recheck, proposed
post-image authority, nested Collection writes, runtime validation order,
database constraint mapping, missing-versus-inaccessible behavior, returned
image, `updatedAt`, cancellation and bounds, and the stable transaction/change
identity seam. Explicitly exclude generic hooks, external effects, automatic
retry, durable dispatch, and a public arbitrary transaction language unless a
beta journey proves one indispensable.

### Answer

The accepted Field/lifecycle split fixes several Mutation responsibilities in
#6A and #7G. Transaction isolation, exact error precedence, returned
create/update/delete images, and final bounds remain open.

## #7E: How are executable handlers and runtime codecs compiled?

Blocked by: #3, #7C, #7D
Type: Discuss

### Question

The accepted structural evaluator cannot absorb an arbitrary executable handler
graph, and TypeScript types do not validate network or handler values. Choose
the smallest compiler-internal split between a Query/Mutation's structural
contract and executable slot, including source slicing, generated typechecking,
input/output codecs, declared errors, Build Input coverage, Origins,
diagnostics, and testability. Preserve one local authoring declaration without
adding a runtime registry or evaluating handler code at compile time.

### Answer

The initial recommendation of one structural Definition plus a separately
exported Runtime Binding was rejected by the user because it exposes compiler
plumbing as application structure and damages locality. The historical audit
found that ADR 0007 requires compile-time composition but does not require a
handler file or second export. The earlier compiler design explicitly intended
opaque runtime Environment Slots in one Definition source; the later accepted
composition contract deferred source slicing for the structural tracer rather
than rejecting that product interface.

The corrected recommendation is one directly exported `defineQuery` or
`defineMutation` with one inline `handler` executable slot. The application sees
one Resource and one declaration. The Operations compiler internally creates a
structural slice and a runtime slice, replaces the handler with a stable binding
marker during controlled evaluation, and statically binds the runtime slice.
An imported handler remains an optional ordinary TypeScript organization choice,
not a framework pairing protocol.

The earlier proposal also required every Operation to repeat a closed `data`
capability map. The user rejected it as needless enumeration and the audit found
that it conflicts with `SPEC.md`: a handler receives the concrete generated
application `ctx` and does not enumerate Services at each call site. The
corrected default is generated `ctx.data`, containing the application's typed
Collection and Query Template interfaces. This is not raw or ambient database
authority: every call carries the immutable Execution, enforces the target
Policy and Field surface, joins the owning Query snapshot or Mutation
transaction, and records actual reads. Query context exposes no writes;
QUESTPIE exposes no raw database, SQL, transaction handle, Policy bypass, or
System Authority constructor through this interface.

The user also rejected a required fixed `output:` declaration when the handler
already returns the result. This matches `SPEC.md` rather than weakening it:
leaf Definitions infer local input and output, while the generated App Contract
materializes the exact client surface. The corrected normal form infers the
awaited handler return with the TypeChecker, validates it against a closed
transport-result algebra, and emits the canonical runtime output codec. An
explicit `output` is optional for deliberately pinning a Package/public
contract or resolving a supported inference edge. Unsupported values never
become serializable by assertion. A body-only change with the same inferred
shape changes Runtime Build bytes; an inferred shape change also changes the
normalized Operation and generated client contract.

The complete rationale, end-application interface, file-count budget, artifact
boundary, rejected defaults, and proof agenda are recorded in
[executable-operation-binding-designs.md](./executable-operation-binding-designs.md).
This direction is not accepted yet: it deliberately amends the current
whole-module evaluator and must earn acceptance through focused slicing,
determinism, artifact-digest, diagnostic, runtime-binding, and TypeScript-budget
proofs before the final Opus-medium review.

## #7F: What names distinguish a read template from an executable Query?

Blocked by: #7C, #7E
Type: Discuss

### Question

The accepted `dataQuery(...)` factory and the candidate `defineQuery(...)`
Resource factory are easy to conflate. Choose one coherent authoring vocabulary
for the closed single-Collection structural value, named read-only Operation,
named transactional Operation, and structural expression grammar. Record exact
v3 supersessions. Do not rename the already accepted semantics or canonical
bytes merely to preserve an accidental unreleased factory spelling.

### Answer

The user identified the current naming as confusing. The naming audit confirms
the conceptual split: a structural value, a Query Resource, a Mutation
Resource, and expression nodes are distinct. The current recommendation is
`queryTemplate(...)`, `defineQuery(...)`, `defineMutation(...)`, and `query.*`.
This would replace the unreleased `dataQuery(...)` authoring spelling while
leaving the accepted structural Query semantics and artifact bytes unchanged.
The user accepted this direction. Final contract acceptance remains pending the
handler split in #7E.

## #7G: Which hooks-replacement lifecycle ships in beta.1?

Blocked by: #5, #6A, #7D, #7E
Type: Discuss

### Question

Before runtime implementation, close the full ownership model that replaces v3
hooks: runtime decoding, Field and cross-Field validation, pure normalization,
server-owned assignments, transaction-joined derivation, post-image Policy,
committed-change facts, post-commit Reaction, and external Action. Choose the
minimum beta.1 subset and explicitly assign the remaining phases to later
versions. Avoid a generic callback bag, ambiguous before/after names, ambient
application context, and lossy after-commit behavior.

### Answer

Resolved in scope with the user: beta.1 cannot implement the core before this
lifecycle model is decided. At minimum the beta must have the phases required
for safe create/update, including server-owned Field values and explicit
validation/transformation ownership. The current recommendation is runtime
codecs, Policy Field authority, static maximum surfaces, closed `setIfMissing`
and `overwrite`, complete-candidate validation, post-image Policy, lock/recheck,
joined writes, database error mapping, output enforcement, and a stable
transaction/change identity. The complete later ownership model is decided now,
while general `derive`, arbitrary hooks, post-commit Reactions, external effects,
durable dispatch, automatic retries, Live Query, and the complete v3 hook
catalogue remain deferred. The user accepted this exact beta.1 split.

Policy remains a separate Resource. Mutation value behavior is authored on the
specific named Mutation or Collection Operation member because operations may
own different assignments. There is no combined `defineCollectionRules` mega
object. The compiler emits separate Policy and Mutation Value contracts even
when their declarations share one source file.

## #8: What client and transport surface ships in beta.1?

Blocked by: #1, #2, #6A, #7A, #7B, #7C, #7D, #7E, #7F, #7G
Type: Discuss

### Question

Decide whether beta.1 requires only direct server execution, a standalone Fetch
server plus generated client, or both; close the minimum startup, health,
shutdown, request-context, cancellation, and error-envelope behavior.

### Answer

Fog.

## #9: Which extension seams must be stable?

Blocked by: #3, #6, #6A, #7, #7A, #7B, #7C, #7D, #7E, #7F, #7G, #8
Type: Discuss

### Question

Name only the internal artifact and ownership seams required to add richer
Policy enforcement, operation lifecycle, Live Query, Reactions, durable work,
Studio, Auth, storage, and search without redesigning accepted Collection and
Query contracts. Do not publish a generic plugin protocol.

Include the compiler explanation seam required for AI-native development: the
canonical artifacts remain authority, while human/agent-oriented explanations
join exact identities and Origins without creating another semantic format.

### Answer

Fog.

## #10: What evidence earns the beta.1 label?

Blocked by: #2, #3, #6, #6A, #7, #7A, #7B, #7C, #7D, #7E, #7F, #7G, #8, #9
Type: Discuss

### Question

Define the exact docs, golden artifacts, type budgets, runtime conformance,
PostgreSQL matrices, crash/restart cases, generated-client tests, diagnostics,
and explicit exclusions required before release.

### Answer

Fog.

## #11: Which contract chapter comes next?

Blocked by: #10
Type: Discuss

### Question

Select exactly one next chapter from the dependency graph, expected to be
Policy/access replacement unless the beta journey proves another prerequisite
must close first.

### Answer

Fog.
