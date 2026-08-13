# V3 Collection access jobs

- Status: research evidence; no v4 acceptance authority
- Evidence snapshot: local `questpie` v3 repository at
  `9873f08eacd0565fb6b462a5196e90bfcc0295fb` (2026-08-11)
- Question: which authorization jobs must the beta.1 Collection vertical do,
  independently of the v3 builder and callback design?

V3 is evidence only. This note does not propose a v4 API, accept a Policy
contract, or make RLS part of the product model.

## Finding

The valuable v3 promise is not the `.access()` builder. It is that one
Collection-owned authorization decision follows an operation through direct
CRUD, HTTP, the generated client, and admin introspection. That decision does
three distinct jobs: admit an operation, restrict its rows, and restrict its
input/output Fields.

V3 proves those jobs are useful, but also demonstrates why their semantics
must be closed before beta.1. Read filters compile into SQL; update and delete
filters are matched against loaded rows using a much smaller JavaScript
language; create can receive an `AccessWhere` that is effectively ignored;
direct server calls default to a total bypass; and several auxiliary operations
have unrelated fallback chains. Those mechanisms are not a coherent v4
contract.

## Evidence ledger

Paths below are relative to the local v3 repository at
`/home/drepkovsky/code/questpie`.

| Evidence | What it establishes |
| --- | --- |
| `apps/docs/content/docs/schema/access-control.mdx:12-43` | One map has read/create/update/delete rules, and the documented intent is parity across REST, typed client, and admin. |
| `packages/questpie/src/server/collection/builder/types.ts:918-1044` | V3 types admit boolean/callback rules, row filters, row-aware update/delete, Field rules, and extra operations. |
| `packages/questpie/src/server/collection/crud/shared/access-control.ts:65-135` | The common evaluator requires a session when a rule is absent and rejects invalid top-level rule shapes. |
| `packages/questpie/src/server/collection/crud/crud-generator.ts:718-746,1465-1494` | Find and count evaluate read access before querying and merge the result into the caller's filter. |
| `packages/questpie/src/server/collection/crud/crud-generator.ts:1700-1789` | Create evaluates operation access on raw input, then checks Field writes before runtime validation. |
| `packages/questpie/src/server/collection/crud/crud-generator.ts:2320-2451` | Update loads candidate rows, evaluates the row rule for every row, and separately checks Field writes. |
| `packages/questpie/src/server/collection/crud/crud-generator.ts:2780-2821,3465-3506` | Single and bulk delete evaluate authority against each existing row. |
| `packages/questpie/src/server/collection/crud/shared/access-control.ts:137-244` | In-memory row matching supports equality plus AND/OR/NOT; strict matching denies unsupported trees. |
| `packages/questpie/src/server/collection/crud/query-builders/where-builder.ts:200-455` | Read access has a wider SQL vocabulary, including relations, and throws when an access subtree cannot compile. |
| `packages/questpie/test/collection/access-where-compilation.test.ts:66-126,231-271` | Malformed operators and relations remain fatal through AND/OR/NOT and before ordinary or hydrated reads reveal rows. |
| `packages/questpie/test/collection/access-rule-fail-closed.test.ts:1-51` | Invalid untyped collection rule shapes deny at the main evaluator seam. |
| `packages/questpie/src/server/collection/crud/shared/access-control.ts:328-379,390-484,541-609` | Field rules are layered, receive request identity/context, redact reads, and reject present writes recursively. |
| `packages/questpie/test/collection/field-access.test.ts:242-273,391-440,483-595,683-787` | Tests pin output redaction, create/update denial, nested paths/arrays, unchanged restricted values, and redaction of write/delete responses. |
| `packages/questpie/src/server/config/context.ts:325-364,390-435` | V3 carries session, a discriminated Principal, an additional actor seam, and a derived `user`/`system` access mode. |
| `packages/questpie/src/server/config/types.ts:769-790` | `appConfig({ context })` is the request-scoped derivation seam used for facts such as tenant membership. |
| `packages/questpie/test/context/request-context-extensions.test.ts:247-301,624-662` | A resolved tenant filters rows, reaches Field rules and nested work, and a failed resolver aborts before Policy-like callbacks run. |
| `packages/questpie/src/server/collection/crud/shared/context.ts:7-40,89-127` | Async-local propagation carries identity, database handle, access mode, and context extensions into nested Collection calls. |
| `packages/questpie/src/server/collection/builder/types.ts:233-239` | Ordinary relation population checks target Collection read access; upload relations have a special parent-access inheritance flag. |
| `packages/questpie/test/integration/default-access.test.ts:483-540` | Public upload bytes do not make asset rows public; an upload selected through an allowed parent bypasses target row access but retains target Field redaction. |
| `packages/questpie/src/server/adapters/routes/collections.ts:46-71,105-150,193-255,257-303` | HTTP handlers resolve request context and invoke the same Collection CRUD methods as direct server callers. |
| `packages/questpie/test/integration/introspection-access.test.ts:1-11,124-198` | Schema/meta visibility is access-controlled, including explicit overrides and distinct 401/403 behavior. |
| `packages/questpie/test/collection/transaction-locks.test.ts:121-155` | Row-scoped locking omits missing and inaccessible IDs together, avoiding an existence oracle. |
| `packages/questpie/test/collection/transaction-locks-postgres.test.ts:257-290` | PostgreSQL lock acquisition rechecks row visibility after waiting for a concurrent writer. |

## Jobs performed by v3 access

### 1. Admit or deny each operation

V3 resolves a rule per operation rather than treating Collection access as one
boolean. For ordinary CRUD the resolution order is the Collection rule, an
application default, then authenticated-session fallback; system mode bypasses
the chain (`crud-generator.ts:4615-4653`). A denial becomes a structured
forbidden error. The tests exercise denial for create, read, update, and delete
through the same CRUD layer (`integration/default-access.test.ts:104-205`).

The job worth preserving is explicit operation authority. The v3 fallback and
bypass rules are mechanisms to reconsider, not guarantees to copy.

### 2. Scope reads without fetching forbidden rows

A read rule may yield a row predicate. V3 intersects it with the caller's
predicate before SQL generation, including for count, hydrated reads, locks,
and relation predicates. Unsupported access operators or unresolved relation
joins throw instead of disappearing from the query
(`where-builder.ts:212-213,365-423`; `access-where-compilation.test.ts:66-126`).

This does two security jobs:

- forbidden rows do not enter the returned result or its count; and
- a failed authorization compilation cannot weaken into a broader read.

V3 also permits `RAW` SQL inside access predicates
(`access-where-compilation.test.ts:103-109,177-187`). That is evidence of an
escape hatch users needed, not evidence that arbitrary SQL belongs in the
beta.1 Policy surface.

### 3. Authorize create from proposed input

Create has no existing row. V3 passes raw pre-validation input to the rule and
then checks Field write rules before schema validation
(`crud-generator.ts:1732-1789`). This supports admission based on the proposed
operation, while allowing trusted lifecycle code to derive values later.

The v3 type nevertheless lets the create callback return `AccessWhere`, while
the runtime denies only the literal `false`; an object therefore does not
constrain the created row (`builder/types.ts:938-945,1008-1014` and
`crud-generator.ts:1733-1745`). The public docs acknowledge that a create row
filter is ignored (`access-control.mdx:87-92`). Beta.1 cannot inherit an
apparently authoritative return shape with no enforcement meaning.

### 4. Authorize updates and deletes against the current row

Update and delete receive the current stored row, and bulk operations evaluate
each candidate (`crud-generator.ts:2353-2381,2785-2821,3482-3506`). This is the
right underlying job: write authority is record-specific and must not be
decided only from a caller-supplied ID or patch.

The v3 mechanism is internally split. The same `AccessWhere` type used for
read SQL is interpreted after loading by an equality-only JavaScript matcher
(`access-control.ts:137-180`). Operators that work on reads therefore do not
mean the same thing on writes; public docs explicitly tell authors to perform
their own lookup and return a boolean (`access-control.mdx:98-110`). That
semantic fork should not survive as an accidental beta contract.

V3's PostgreSQL lock test adds a stronger hostile case: an authorization fact
can change while a writer waits, so visibility is rechecked after acquiring the
lock (`transaction-locks-postgres.test.ts:257-290`). Whether beta.1 exposes
locks is separate; the time-of-check guarantee remains relevant to transaction
ownership.

### 5. Control Field input and output separately

V3 Field rules distinguish read, create, and update. A denied output Field is
removed; a denied input Field makes the operation fail with its path. Only
Fields present in input are checked, and an unchanged restricted value on an
update is skipped (`apps/docs/.../access-control/fields.mdx:33-43`). Redaction
also applies to create, update, bulk-update, and delete responses
(`field-access.test.ts:683-787`). Nested object and array Fields are traversed.

The durable jobs are:

- authorize input at the canonical Field path actually supplied;
- prevent a partial update from requiring write authority over untouched
  Fields; and
- apply output authority to every response path, including mutation results.

V3 represents nested paths as dotted strings and exempts several framework
meta Fields from output filtering (`access-control.ts:407-438,486-537`). V4 has
already made canonical paths segment arrays and ordinary Fields such as `id`,
`createdAt`, and `updatedAt`; the v3 exceptions and path encoding are evidence
to reject.

### 6. Carry authenticated and derived request facts

Rules can observe the authenticated session, `principal`, `actor`, request,
locale, services, and arbitrary context extensions
(`access-control.ts:44-63,106-123`). The context resolver can validate a tenant
once per HTTP request, and its result propagates through rules, hooks, and
nested CRUD. A failed resolver stops the request before a rule runs
(`request-context-extensions.test.ts:247-301,624-662`).

This proves a need for trusted, request-scoped facts such as Principal and
Tenant. It does not prove that authorization should receive the entire mutable
application context, a raw Request, or unrestricted Collection/database
services. In particular, branching on whether a request came from admin is a
documented v3 pattern (`access-control.mdx:81-96`) that conflicts with one
product decision applying across equivalent transports.

### 7. Define authorization across relations

Relation predicates can participate in read scoping and must fail closed when
their reverse mapping cannot compile (`access-where-compilation.test.ts:66-101`).
Selected related rows ordinarily go through the target Collection's read
decision because relation resolution delegates to target CRUD
(`crud-generator.ts:1364-1415`).

V3 makes uploads a special exception: when an upload is selected through an
authorized parent, target row access is inherited from the parent while target
Field redaction remains active (`builder/types.ts:233-239` and
`integration/default-access.test.ts:512-540`). This exposes a real composition
question—whether a related value is independent data or part of the readable
parent—but `inheritAccess` as an upload-specific hidden flag is not a general
answer.

### 8. Keep transport adapters behind the same enforcement seam

The HTTP Collection handlers resolve request context and call the same
`crud.find/create/updateById/deleteById` methods used by direct server code
(`adapters/routes/collections.ts:46-71,105-150,193-303`). The generated client
targets those routes. Admin obtains per-caller schema/meta information whose
visibility and operation flags are evaluated through access
(`integration/introspection-access.test.ts:124-198`). This supports the v3
documentation's parity claim.

Parity is conditional, however. HTTP context defaults to user mode, while a
server context without a Request defaults to system mode and bypasses all row
and Field checks (`config/questpie.ts:1064-1084` and
`crud-generator.ts:4623-4635`). Direct server use therefore reaches the same
code but not necessarily the same authorization decision. Beta.1 must name
that distinction rather than calling it parity.

### 9. Fail closed and avoid record-existence oracles

Recent v3 tests pin several valuable hostile cases:

- invalid top-level rule shapes deny (`access-rule-fail-closed.test.ts:27-51`);
- malformed access predicates throw throughout logical and relation trees
  (`access-where-compilation.test.ts:66-101`);
- missing and inaccessible lock targets are omitted together
  (`transaction-locks.test.ts:121-155`); and
- a failed tenant/context derivation aborts before authorization callbacks
  execute (`request-context-extensions.test.ts:624-662`).

The behavior is not uniform. An invalid non-function Field rule falls through
to allow (`access-control.ts:370-380`), and extra operation fallback chains vary
between authenticated fallback, allow, deny, and another operation's rule
(`apps/docs/.../access-control/beyond-crud.mdx:13-77`). The v4 requirement must
be expressed once and tested at every enforcement boundary.

## Guarantees worth carrying into the beta.1 discussion

These are research recommendations, not accepted v4 decisions.

1. One product authorization model should govern direct user-mode execution,
   the server transport, and the generated client. Studio should consume the
   same result if it is present; it should not define another policy layer.
2. Operation admission, row scope, Field input authority, and Field output
   authority are separate jobs even if they compose under one Policy concept.
3. Caller predicates must only narrow authorized rows. Policy compilation must
   fail closed rather than omit an unsupported subtree.
4. Create must have enforceable semantics over proposed input. Update/delete
   must evaluate trusted current state, and transaction-owned writes must
   account for authorization facts changing during lock waits.
5. Bulk operations must not silently write a row that failed the per-row
   decision. Their atomicity and disclosure behavior still need a beta choice.
6. Output filtering must cover ordinary reads and every returned write result.
   Input filtering must use canonical segment-array Field paths and ignore
   untouched Fields on partial updates.
7. Principal and Tenant-like facts must be derived at a trusted boundary,
   remain stable for the execution, and propagate into nested Collection work.
8. Relation predicates and relation selection need explicit target/parent
   authority semantics. A failed traversal cannot broaden visibility.
9. Unauthorized and nonexistent records should be indistinguishable wherever
   exposing the distinction would create an oracle.
10. Database predicates, grants, or derived RLS may enforce a Policy decision,
    but v3 provides no evidence for making RLS a second product policy model.

## V3 mechanisms not to carry forward automatically

- The fluent `.access()` builder, replacement/merge behavior, and callback
  architecture.
- Arbitrary callbacks with the entire app, database, Collections, raw Request,
  and ambient mutable services.
- `accessMode: "system"` as an easy per-call total bypass, especially the
  no-Request default for direct server calls.
- An omitted operation meaning "authenticated", rather than an explicit and
  inspectable default decision.
- One `AccessWhere` type with SQL semantics on read, equality-only JavaScript
  semantics on update/delete, and no semantics on create.
- `RAW` SQL inside the ordinary authorization grammar.
- Dotted Field paths and hard-coded exemptions for framework/meta Fields.
- Special hidden relation flags such as upload-only `inheritAccess`.
- Transport-sensitive authorization such as inspecting URLs to distinguish
  admin from another client.
- Operation-specific fallback ladders where `serve` can fall open, `purge`
  falls closed, `transition` inherits update, and introspection computes
  visibility from other operations.
- Runtime introspection of callbacks as a substitute for a deterministic,
  compiler-owned Policy contract.
- Invalid Field rule shapes falling open.

## Beta.1 questions opened by the evidence

### Blocking Policy questions

1. Which exact facts make up Principal and Tenant for one Execution, who
   derives them, and what proves they cannot change halfway through a
   transaction?
2. What is the smallest deterministic Policy result that separately expresses
   operation admission, row scope, permitted input Fields, and permitted output
   Fields without admitting arbitrary runtime code into compiler artifacts?
3. For create, is authority an admission decision, a predicate over the
   proposed post-image, ownership injection performed by the later Mutation
   contract, or a composition of those jobs?
4. For update, which state is authoritative: current row, proposed post-image,
   or both? At what lock/transaction point is the decision rechecked?
5. Does beta.1 support bulk update/delete? If so, is denial all-or-nothing, are
   unauthorized rows silently absent, and how is an existence oracle avoided?
6. How are output-restricted Fields reflected in generated client types and
   runtime result codecs when permission depends on the Principal or row?
7. When a Query selects a Relation, must both parent and target Policies pass,
   or can a declared composition grant target visibility through the parent?
   How is that choice represented without a hidden special case?
8. Which unsupported Policy expressions are compiler errors, which are safe
   runtime checks, and is any post-filter compatible with cursor pagination and
   exact counts?

### Blocking execution and transport questions

9. How does direct server code select user authority versus an explicit trusted
   capability? Is there any ambient bypass in beta.1?
10. Which error distinctions are stable across direct execution and HTTP
    (unauthenticated, forbidden, not found, invalid Policy compilation), and
    where must forbidden collapse to not found?
11. Does the generated client need Field-redacted mutation results in beta.1,
    or may mutation return only identity/status until the output contract is
    complete?
12. Is Studio absent from beta.1, a consumer of compiled authorization facts,
    or a required parity surface? Its presence must not create a new decision
    path.

### Database enforcement questions

13. Is structural SQL predicate pushdown sufficient for beta.1, with grants and
    derived RLS explicitly deferred, or is defense against direct database
    access part of the beta promise?
14. If RLS is later derived, which subset of Policy is provably equivalent and
    how are Principal/Tenant facts installed transaction-locally? What happens
    for a Policy expression that cannot be derived?
15. Which database role owns migrations and trusted maintenance, and can that
    role ever be reached from ordinary request execution?

## Implication for the decision map

Research question #4 has enough evidence to move from inventory to discussion.
Question #6 should close the four core Policy jobs before considering RLS,
Studio-specific behavior, or v3's auxiliary operations. Question #7 must then
own lock timing and post-image semantics; they cannot be solved by Policy in
isolation without inventing the later Mutation lifecycle.
