# Minimal Policy/access-replacement contract design

- Status: design evidence; no v4 acceptance authority
- Scope: the smallest beta.1 Policy interface that replaces the durable jobs of
  v3 `access` without restoring callbacks, implicit fallbacks, transport-specific
  behavior, or ambient System bypass
- Authority: `SPEC.md`, `CONTEXT.md`, Accepted ADRs, the accepted foundational
  Data/structural Query contract, and the evidence in
  [`v3-access-jobs.md`](./v3-access-jobs.md)

## Start with the application interface

Exact factory and helper spellings remain candidates until the focused contract
and proof pass. The intended amount of application code is not provisional: one
Collection Policy can live beside its Collection and no central registry or
per-handler capability manifest is required.

```ts
// src/features/tasks/tasks.ts
import {
  constraint,
  defineCollection,
  definePolicy,
  field,
  policy,
} from "questpie";

export const tasks = defineCollection({
  name: "tasks",
  fields: {
    workspaceId: field.uuid({ nullable: false }),
    id: field.uuid({ nullable: false, default: "randomUuid" }),
    title: field.text({ nullable: false, maxLength: 240 }),
    status: field.text({ nullable: false, maxLength: 24 }),
    internalNote: field.text({ nullable: true, maxLength: 2_000 }),
    createdBy: field.uuid({ nullable: false }),
    createdAt: field.timestamp({
      nullable: false,
      withTimezone: true,
      default: "now",
    }),
    updatedAt: field.timestamp({
      nullable: false,
      withTimezone: true,
      default: "now",
    }),
  },
  constraints: {
    primary: constraint.primaryKey({ fields: ["workspaceId", "id"] }),
  },
});

export const tasksPolicy = definePolicy({
  name: "tasks",
  collection: tasks,

  read: {
    admit: policy.authenticated(),
    rows: ({ fields, tenant }) =>
      fields.workspaceId.equal(tenant.id),
  },
  create: {
    admit: policy.authenticated(),
  },
  update: {
    admit: policy.authenticated(),
    rows: ({ fields, tenant }) =>
      fields.workspaceId.equal(tenant.id),
  },
  delete: {
    admit: policy.authenticated(),
    rows: ({ fields, tenant }) =>
      fields.workspaceId.equal(tenant.id),
  },

  fields: {
    output: ({ fields, principal }) => [
      policy.require(
        [fields.internalNote],
        fields.createdBy.equal(principal.id),
      ),
    ],
    create: ({ fields, authority }) => [
      policy.require([fields.internalNote], authority.isSystem()),
    ],
    update: ({ fields, authority }) => [
      policy.require([fields.internalNote], authority.isSystem()),
    ],
  },
});
```

The timestamp defaults initialize both ordinary Fields on create only. They do
not create automatic `updatedAt` behavior. A later Mutation Value Program must
explicitly overwrite `updatedAt` on the update operations that want it, and it
must supply server-owned `workspaceId`/`createdBy` where the public input omits
them. Policy only authorizes the resulting candidate.

### Where `fields` autocomplete comes from

`policy` is a normal namespace imported from `questpie`, but it does not know a
Collection by itself. A context-free call such as this is an invalid interface:

```ts
// Rejected: no Collection has bound the `fields` parameter.
const workspaceRows = policy.rows(({ fields }) =>
  fields.workspaceId.equal("..."),
);
```

In the normal form, `collection: tasks` binds the leaf-local Collection
Definition Contract to `definePolicy`. That contract contains the exact Field
keys and codecs. The sibling callbacks are contextually typed from
`typeof tasks`:

```ts
export const tasksPolicy = definePolicy({
  collection: tasks,
  read: {
    rows: ({ fields, tenant }) =>
      fields.workspaceId.equal(tenant.id),
  },
});
```

The required editor behavior is:

```text
fields.              -> workspaceId, id, title, status, internalNote, ...
fields.workspaceId.  -> operators accepted by the UUID Field codec
tenant.               -> exact trusted Tenant facts
fields.unknown        -> TypeScript error
```

This must work without importing the generated App Contract, writing a generic,
or annotating the callback parameter. Object-property order must not affect it.
The focused type proof must compile the exact authored fixture and pin positive
and negative contextual-typing cases.

If repeated row scope later proves common enough to justify a helper, the
Collection must remain an explicit type source:

```ts
const workspaceRows = policy.rows(tasks, ({ fields, tenant }) =>
  fields.workspaceId.equal(tenant.id),
);
```

This two-argument helper is not part of the beta happy path yet. We do not add a
curried builder or manual generic until a real reuse case proves it earns the
extra interface.

An ordinary named Query does not require a second Policy file or Resource just
to say that the caller must be authenticated:

```ts
export const workspaceDashboard = defineQuery({
  name: "workspace.dashboard",
  input: dashboardInput,
  policy: policy.authenticated(),
  handler: async ({ input, ctx }) => {
    const workspace = await ctx.data.workspaces.get({
      key: { id: input.workspaceId },
      select: { id: true, name: true },
    });
    const tasks = await ctx.data.run(taskPage, {
      workspaceId: input.workspaceId,
      first: 20,
      after: null,
    });
    return { workspace, tasks };
  },
  network: true,
});
```

The Query's `policy` member is its explicit operation-admission program. Every
underlying `ctx.data` call independently enforces the target Collection Policy.
The handler cannot select a weaker Collection Policy or switch Authority.

The generated client stays ordinary:

```ts
const result = await client.queries["workspace.dashboard"]({ workspaceId });
```

## Why this is smaller than a capability manifest

The author states each security fact once:

- the Query states who may invoke it;
- the Collection Policy states who may perform each Collection job and which
  rows/Fields it reaches;
- the Query handler states which reads actually happen;
- a Mutation Value Program, not Policy, states server-owned value changes.

`ctx.data` applies these decisions automatically. Repeating every Collection,
Policy, key, and selection in a second per-Operation capability map would not
add authority; it would create another manifest that can drift from the code
that actually runs. Runtime observation records executed reads for explainability
and later Live Query dependency capture.

## Two Policy placements, one authorization model

The minimum interface has two placements rather than two authorization models:

1. A **Collection Policy Resource** is one named Resource associated with one
   Collection. It governs every normal read/create/update/delete through
   `ctx.data`, generated Collection operations, direct execution, Fetch, and
   later Studio use.
2. An **Operation admission member** is owned by one Query or Mutation Resource.
   It decides whether the immutable Execution may invoke that capability. It is
   inline because a second Resource and cross-reference add no value for the
   common one-line decision. A reusable admission program can be an ordinary
   imported structural value.

Both compile through the same closed Policy expression grammar and explanation
format. Neither is an executable user callback. Factory callbacks only build
structural expression nodes during controlled compilation, just like the
accepted Query Template builder.

## Collection Policy attachment

`collection: tasks` is an exact typed reference and attaches the Policy Resource
to `collection:tasks`. It does not augment or mutate the Collection, enter its
Schema Projection, or make the Policy its Owner.

For normal Authority:

- zero attached Collection Policies means the Collection has no executable
  `ctx.data` operations; any referenced read/write is a compile error;
- exactly one attached Collection Policy is required before a Collection can be
  read or written;
- a second attached Collection Policy is an ambiguity error with both Origins;
- a handler cannot choose among Policies at runtime;
- Package activation, import order, file path, or export order cannot select a
  winner.

This is fail-closed without forcing every schema-only Collection to be public or
to carry a boilerplate deny Policy. An intentionally public operation writes
`policy.public()` explicitly; absence never means public or authenticated.

The Collection Operation Set can resolve this unique Policy during compilation
and show the exact reference in every expanded Query/Mutation Resource. It does
not create a CRUD-specific authorization path.

## The four Policy jobs

### 1. Admission

Every exposed or directly executable named Operation has an explicit admission
program. Every enabled Collection job has an explicit `admit` member. Beta.1
admission reads only immutable Execution facts, not request objects, handler
state, database services, or untrusted operation input.

The small built-ins are expected to include at least:

```ts
policy.public();
policy.authenticated();
policy.system();
policy.when(({ execution }) => /* closed boolean expression */);
```

Restricting beta admission to Execution facts keeps it decidable before handler
or database work and avoids making Policy a hidden business-logic handler.
Row-specific and proposed-value decisions belong to the slots below.

An anonymous Principal failing `authenticated()` maps to the framework's stable
unauthenticated outcome. Another false admission maps to forbidden. Exact Fetch
status and error-envelope bytes remain owned by the transport contract.

### 2. Row scope

`rows` is a closed predicate over the current Collection row, immutable
Execution facts, and accepted one-hop Relation expressions. It reuses the
accepted Query boolean, scalar, comparison, and Relation-predicate semantics;
Policy does not invent a second SQL language.

The Runtime intersects Policy scope with the caller's predicate:

```text
effective rows = Policy rows AND caller/template rows
```

Caller predicates can only narrow authority. Policy row scope is pushed into
the same SQL statement used for list/get/update/delete, cursor sentinel reads,
Relation selection, and any later exact count. Unsupported Policy lowering is a
compile failure. Beta.1 has no post-fetch row filtering fallback and no raw SQL
inside ordinary Policy.

For keyed reads and writes, a missing row and a row excluded by Policy produce
the same not-found outcome. Update/delete lock and post-wait recheck timing are
owned by the Mutation contract, but they must reuse this same normalized row
predicate.

### 3. Caller-input Field authority

The Operation or generated Collection operation owns one exact maximum input
surface. A Policy Field rule only narrows it. Therefore the common case needs no
duplicated allow list.

`policy.require([fieldRefs], condition)` means that every listed Field supplied
by the caller requires the condition. Unlisted Fields are not globally public:
they must first exist in the Operation's explicit maximum input. Adding a Field
to a Collection changes neither an Operation input nor its Policy surface.

Create rules inspect only caller-supplied create paths and immutable Execution.
Update rules inspect only supplied patch paths and may additionally read the
trusted current row and decoded intent. An untouched restricted Field never
blocks a patch. A supplied forbidden Field fails explicitly; it is not silently
dropped.

Authoring uses typed Field references. Normalized artifacts and error payloads
use canonical segment-array paths. Inline Shape leaves remain independent
Fields; an Embedded Value or Open JSON Field is authorized as one whole Field
because its interior has no Field identity.

Policy never supplies, defaults, normalizes, hashes, derives, or overwrites a
value. Those jobs belong to the Field codec, accepted schema default, or
Mutation Value Program.

### 4. Output Field authority

The selected result owns one exact maximum output surface. Collection Policy
may narrow that surface per returned row and immutable Execution.

- unconditional output remains a required property;
- conditionally authorized output becomes an optional property;
- denial omits the property and never substitutes `null`;
- always-denied output should be removed from the Operation selection rather
  than represented by a redundant Policy rule;
- output authority applies to reads and every returned create/update/delete
  image.

Manual handler redaction is not an authorization substitute. The handler only
receives Collection values already filtered by `ctx.data`. It may construct a
smaller custom result but cannot request a denied Field.

A cursor-paginated Query cannot conditionally redact a selected total-order
Field in beta.1. Such a combination is a compile error because cursor and
result equivalence must not depend on late per-row output removal. The focused
Policy proof must cover this rule together with sentinel reads.

## Proposed post-image authority

Create has no current row. Update authority can change when the candidate row
changes tenant, owner, or state. `proposed` is therefore a separate Policy
predicate over the complete candidate after accepted defaults and the Mutation
Value Program, but before persistence.

Policy still returns only a decision. It cannot rewrite the candidate. The
Mutation contract owns exact ordering, lock/recheck, validation, database write,
and error precedence. The intended cumulative rule is:

```text
create = admit AND supplied-field authority AND proposed(candidate)
update = admit AND rows(current) AND supplied-field authority
         AND proposed(candidate)
```

Omitting `proposed` means no additional post-image narrowing; it never means
that a create `rows` predicate is silently ignored.

## Relations

Ordinary Relation selection requires both source-row authority and the target
Collection's read Policy. A denied or missing nullable/to-one target appears as
the same `null`; no target-existence oracle is exposed. Target Field output
authority also applies.

Policy Relation predicates use the accepted one-hop Relation identities and
must include target Policy scope. The compiler builds a Policy dependency graph,
rejects an enforcement cycle it cannot lower with an exact fixed meaning, and
never drops the target predicate. Beta.1 has no `inheritAccess`, upload special
case, parent-grants-target rule, or arbitrary multi-hop policy traversal.

The conformance fixture must include one membership Relation case. If the
current `workspaces`/`memberships`/`tasks` shape cannot express it in one accepted
Relation hop, the fixture changes; Policy does not silently widen the already
accepted structural Query grammar merely to preserve a disposable example.

## Execution and System Authority

Principal, Tenant, and Authority are derived at a trusted Runtime boundary and
frozen for one Execution. Direct calls and Fetch calls enter the same execution
engine. Neither a handler argument nor request input can replace them.

System Authority is an explicit trusted capability, not an implicit direct-call
mode. It does not automatically bypass Policy. A Policy must explicitly admit
`policy.system()` or another condition over Authority. Generated client input,
ordinary handler context, and `ctx.data` expose no Authority constructor,
`asSystem`, `skipPolicy`, or context override.

Migration, fingerprint, and internal maintenance roles are runtime/database
implementation concerns. They are not obtainable through application Policy.

## Errors and nondisclosure

The Policy contract fixes semantic classes while the Fetch contract later fixes
wire bytes:

- missing trusted Principal for `authenticated()` -> unauthenticated;
- explicit operation admission denial -> forbidden;
- keyed target missing or excluded by row Policy -> one not-found result;
- supplied input Field denied -> forbidden Field path using canonical segments;
- output Field denied -> property omitted, not an error;
- unsupported/invalid Policy expression or dependency cycle -> fatal compile;
- Policy evaluation/lowering failure at runtime -> fail closed and sanitized
  internal failure, never continue with a broader predicate.

Bulk update/delete remain outside beta.1, so no partial-denial semantics are
invented here.

## RLS boundary

RLS is deferred from beta.1. PostgreSQL row predicates, grants, or later derived
RLS may enforce the normalized Policy, but they never become a second product
authorization model. A future RLS projection must prove equivalence for its
supported subset, install Execution facts transaction-locally, and fail closed
when a Policy cannot be represented.

Beta.1 claims authorization through the QUESTPIE Runtime interface, not defense
against an application opening an unrelated database connection with separate
credentials.

## Explainability

For every Collection Policy and expanded Collection operation, canonical
artifacts plus `questpie explain --json` must show:

- the Operation admission decision and Origin;
- the unique target Collection Policy identity and Origin;
- the normalized row and proposed predicates;
- the exact maximum input/output Fields and every conditional narrowing rule;
- the immutable Execution operands used by each decision;
- Relation Policy dependencies;
- whether SQL pushdown is complete;
- the nondisclosure outcome and later Mutation lock/recheck phase;
- the fact that no RLS projection is claimed in beta.1.

The explanation joins authoritative artifacts; it is not a second semantic
format and does not require interpreting arbitrary JavaScript callbacks.
Expanded Collection operations and Query Templates have exact static data
dependencies. A custom handler's canonical contract shows its handler Origin
and available generated context; actual nested `ctx.data` calls join these
Policy identities in Runtime observations because `SPEC.md` defines dependency
capture from reads that really execute. The compiler does not claim an exact
static call graph for arbitrary TypeScript control flow.

## Proof agenda

Before focused acceptance, the Policy proof must include at least:

1. explicit public/authenticated/system admission and omitted-operation denial;
2. direct and Fetch parity under the same immutable Execution;
3. SQL intersection of Policy rows with caller/template rows;
4. malformed and unsupported predicates failing closed through boolean and
   Relation trees;
5. list/get/cursor-sentinel equivalence and the conditional-order-Field error;
6. missing versus inaccessible keyed-row nondisclosure;
7. supplied-only create/update Field checks using canonical segment paths;
8. conditional output omission and exact optional generated properties;
9. whole-Field authority for Embedded Value/Open JSON and leaf authority for
   Inline Shape Fields;
10. proposed create/update post-image decisions after server assignments;
11. target Policy and Field authority for Relation selection plus cycle errors;
12. zero/one/two Collection Policy attachment diagnostics;
13. absence of raw SQL, database, Authority construction, Policy selection, or
    bypass from generated handler context;
14. canonical Manifest/Origin/explain bytes, hostile goldens, and TypeScript
    budget measurements.

Mutation lock timing, exact lifecycle error precedence, transport status/body,
and Runtime Principal/Tenant derivation adapters remain linked decisions rather
than hidden Policy callbacks.

## Rejected defaults

- v3 `.access()` callback and fallback semantics;
- absent operation meaning authenticated or public;
- more than one selectable Collection Policy under normal Authority;
- a handler-selected Policy, `overrideAccess`, or implicit direct-call bypass;
- a duplicated per-Operation Collection capability manifest;
- Policy-supplied or rewritten values;
- raw SQL or arbitrary runtime callbacks in ordinary Policy;
- post-fetch row filtering for a predicate that failed SQL lowering;
- dotted Field paths or exemptions for `id`/timestamps;
- null-masking a denied output Field;
- target Relation access inherited from a parent or upload special case;
- RLS as a second Policy system or a beta.1 claim.
