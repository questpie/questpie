# ADR 0030: Freeze Collection provenance and trusted values

- Status: Proposed
- Date: 2026-08-28

## Context

ADR-0011 proved exact Collection writes, candidate Policy, PostgreSQL
constraints, Mutation receipts, and explicit transaction ownership. Its public
authoring still makes applications repeat Field fences and server assignments
inside `defineCollectionOperations`, even though every named Mutation needs the
same Policy-aware CRUD behavior.

QUESTPIE needs less authoring without turning Collection CRUD into an implicit
network API or giving trusted server assignments a Policy bypass. The narrow
decision here covers Field provenance and a trusted `values` lane only. Authored
lifecycle phases and database-owned `onUpdate` values remain separate decisions.

## Decision

The existing generated Collection create/update kernel gains Field provenance
and a trusted `values` lane. It exists whether or not an application publishes
an Operation. Only named Operations with explicit network exposure are callable
by a client; the internal kernel is not a runtime dispatcher or an automatic
public CRUD API. This decision does not yet replace or remove
`defineCollectionOperations` and does not freeze a new get/list/delete surface.

### Field provenance

Scalar Field provenance is orthogonal to nullability and database defaults:

| Field declaration               | Create caller input | Update caller patch | Trusted `values` |
| ------------------------------- | ------------------- | ------------------- | ---------------- |
| default                         | allowed             | allowed             | allowed          |
| `immutable: true`               | allowed             | forbidden           | create only      |
| `server: true`                  | forbidden           | forbidden           | allowed          |
| `server: true, immutable: true` | forbidden           | forbidden           | create only      |

Requiredness is derived after provenance filtering. A non-nullable create Field
without a database default is required; a defaulted or nullable create Field is
optional, and an absent nullable Field without a default becomes SQL `NULL`.
Every update patch member is optional. Unknown caller keys fail before
PostgreSQL. Adding a Field intentionally changes
a provenance-derived input helper when the new Field belongs to that helper;
the generated TypeScript and App Contract expose that change rather than hiding
it. An Operation can pin a smaller input by picking or omitting Fields.

`collection.createInput()` and `collection.updateInput()` produce exact
codec-object values derived from this table. Their `.pick({ field: true })` and
`.omit({ field: true })` selectors use object maps, preserve each Field codec,
and reject unknown Fields at author time. They do not publish an Operation.

### Trusted values and candidate authority

A generated Collection write accepts caller data in `patch` and trusted server
assignments in `values`. Both are closed exact objects. The same Field cannot be
present in both lanes. `values` may use Mutation input, a row returned by a prior
Policy-aware locking kernel read, transaction-scoped Policy-aware Collection reads, `ctx.operationTime`,
`ctx.callId`, and ordinary TypeScript expressions over those values. When a
trusted value needs the current row, the Mutation first obtains it through a
Policy-aware locking kernel read in the same transaction; `update` still
rechecks it. No stale handler value is described as lock-owned evidence. This
list describes allowed Mutation capabilities, not a claim that Runtime can
inspect arbitrary TypeScript provenance.

The lanes merge inside the owning Mutation transaction. Both modes first decode
the exact objects, reject overlap, apply caller Field authority only to the
caller lane, and apply existing closed Field scalar normalization separately to
both supplied lanes. Create then starts from normalized caller input, fills only
absent database defaults and nullable-without-default Fields as `NULL`, and
overlays normalized trusted values. Update starts from the locked current row,
overlays the normalized caller patch, then overlays normalized trusted values;
it never reapplies create defaults. The complete candidate then passes
validation, full candidate Policy, and PostgreSQL constraints. `values` bypasses
only caller Field authority. Authored lifecycle `normalize` remains deferred
and is not implied by this scalar step. Selection, output authority, receipt,
and Change Ledger capture follow the existing ADR-0011 order. Policy never
supplies or rewrites a value. A trusted assignment that forges Tenant,
requester, ownership, or any other invariant is denied by the same candidate
Policy as caller data.

A write with an empty `patch` and non-empty `values` is real work. Empty
`patch` and empty `values` retain the existing empty-update rejection. Required
Fields left absent after caller input, trusted values, and schema defaults fail
closed during candidate construction.

### Kernel composition

Named Mutations compose the generated kernel through their typed `ctx.data`.
They receive no raw SQL or transaction handle and cannot bypass locks, Policy,
constraints, receipts, or Change Ledger capture. Compare-and-set `expected`,
selection, cancellation, pre/post-commit outcomes, and direct/network parity
remain governed by ADR-0011 and ADR-0023.

`defineCollectionOperations` remains temporarily available while current
fixtures migrate to named Operations. It is deleted only after no current
consumer remains; no compatibility alias or second CRUD implementation remains.

## Consequences

- Common server-owned and immutable Fields are declared once at their Collection.
- Generated caller input cannot accidentally acquire server-owned Fields.
- Named Mutations can express domain transitions through the existing generated
  create/update kernel without reimplementing its authority checks.
- Candidate Policy is the mandatory backstop for every value source, including
  buggy trusted application code.
- Internal CRUD and public exposure stay separate, so a Collection never becomes
  network-visible merely by existing.

## Deferred decisions

- `onUpdate: "now"` and other database-owned managed-writer values.
- Authored `normalize`, `validate`, `check`, and `afterWrite` lifecycle phases.
- The complete always-generated get/list/create/update/delete replacement,
  declared-unique-constraint `key` lookup, and typed `ConstraintViolation`.
- Bulk writes, lifecycle recursion, and durable large fan-out.

## Rejected alternatives

- Automatic public CRUD for every Collection.
- A `network: true` switch on Collection.
- Field denial rules repeated in every Operation.
- Caller and trusted values sharing one indistinguishable input object.
- Trusted assignments bypassing candidate Policy or PostgreSQL constraints.
- Silent last-writer-wins when `patch` and `values` contain the same Field.
- A raw transaction, ORM, SQL callback, ambient registry, or provider-specific
  authorization path in application code.

## Supersession

This decision narrowly extends ADR-0011's server-values ordering with Field
provenance plus the trusted `values` lane. It does not supersede
`defineCollectionOperations`, the `operationTime` spelling, or ADR-0011's
lifecycle decision in this slice. It preserves fixed Mutation ownership,
candidate Policy, exact codecs, constraints, receipts, post-commit semantics,
and the prohibition on raw transaction authority.
