# QUESTPIE API reference

- Status: draft reference for the proposed authoring surface

## Imports

| Module             | Contents                                                                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `questpie`         | structural surface: `defineCollection`, `definePolicy`, `defineService`, `defineContext`, `defineCredentialResolver`, `field.*`, `codec.*`, `config.*`, `constraint.*`, `relation.*`, `relationRef`, `index`, `expr.*`, `policy.*`, `operation.error`, `durable.*`, `principal.*`, types `PolicyScope`, `RowOperand` |
| `#questpie/app`    | generated executable factories: `defineQuery`, `defineMutation`, `defineAction`, `defineRoute`, `defineJob`; generated app entry `createApp`, `loadAppConfig`; generated types (`AppData`, execution inputs)                                                                                                         |
| `#questpie/client` | generated browser-safe `createClient` plus named per-Operation types `<Domain><Name>Input/Result/Error`                                                                                                                                                                                                              |
| `questpie/react`   | `useQuery`, `useLiveQuery`, `useMutation`                                                                                                                                                                                                                                                                            |

Browser code must not import `questpie` or `#questpie/app`; server structural
code must not import `#questpie/client`. Violations are compile diagnostics.

## Codecs (`codec.*`)

`codec.text({ minLength?, maxLength? })`, `codec.integer({ minimum?,
maximum? })`, `codec.boolean()`, `codec.uuid()`, `codec.timestamp()`,
`codec.object({ ...members })`, `codec.array(inner, { maximum? })`,
`codec.nullable(inner)`, `codec.optional(inner)`,
`codec.list(inner, { maximum })` (bounded scalar-list parameter, canonical
set semantics), `codec.cursor()` (opaque pagination cursor).

Codecs validate at every boundary: operation input/output, Context input,
Job input/output, config values. Unknown object keys are rejected.

## Fields (`field.*`)

`field.uuid(options)`, `field.text(options)`, `field.integer(options)`,
`field.boolean(options)`, `field.timestamp(options)`.

Common options:

| Option                  | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `nullable`              | column accepts SQL `NULL`; default `false`                                   |
| `default`               | database default: a literal, `"now"` (timestamps), `"randomUuid"` (uuid)     |
| `server: true`          | provenance: only a Mutation `values` lane may supply it                      |
| `immutable: true`       | provenance: writable at create, frozen afterwards                            |
| `onUpdate: "now"`       | database-owned: advanced automatically on every write; no lane may supply it |
| `minLength`/`maxLength` | text bounds                                                                  |
| `minimum`/`maximum`     | integer bounds                                                               |
| `withTimezone`          | timestamp with time zone                                                     |

Caller-writable means: no `server`, no `onUpdate`. Provenance defines the
possible write surface; Policy decides per-request authority over it.

## Collections

```ts
defineCollection({
  name: string,                       // qualified lower-camel name
  fields: Record<string, Field>,
  constraints: { name: constraint.primaryKey({ fields: FieldPicker }) |
    constraint.unique({ fields: FieldPicker }) | constraint.check(...) },
  relations: Record<string, Relation>,
  lifecycle?: { normalize?, validate?, check?, afterWrite? },
  indexes?: Record<string, index({ fields: IndexFieldPicker })>,
})
```

Constraints, Relations, and Index all take an object mapping instead of a
positional array; no Accepted ADR fixes the array spelling, so this is
ordinary authoring sugar over byte-identical artifacts.

- `FieldPicker` = `Record<fieldName, true>`. Authored key order is the
  constraint's column order (`{ organizationId: true, reference: true }`).
- `IndexFieldPicker` = `Record<fieldName, true | "asc" | "desc" |
{ direction: "asc" | "desc", nulls: "first" | "last" }>`; `true` is a plain
  ascending column, reusing the same value grammar `orderBy` uses.

### Relations

- `relation.toOne({ target, on, onDelete? })` on the side that stores the
  foreign key. `on: Record<localFieldName, targetFieldName>` maps each local
  column to the target column it references — one object instead of two
  parallel `fields`/`references` arrays that must stay the same length and
  order. `onDelete`: `"setNull" | "restrict" | "cascade"`.
- `relation.toMany({ inverseOf: relationRef(collectionName, relationName) })`
  on the inverse side. `relationRef` is a string reference, so the parent
  module never imports the child module.

### Lifecycle phases

| Phase        | Signature                                         | Capabilities                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalize`  | `({ input }) => input`                            | pure, deterministic; no clock, random, I/O, or module state                                                                                                                                                             |
| `validate`   | `({ candidate, current?, errors, now }) => void`  | pure checks; throw `errors.invalidCandidate(message)`                                                                                                                                                                   |
| `check`      | `({ candidate, current?, ctx }) => Promise<void>` | bounded Policy-aware reads in the owning transaction                                                                                                                                                                    |
| `afterWrite` | `({ row, previous?, ctx }) => Promise<void>`      | `ctx` carries `data`, `jobs`, `now`, `callId` and nothing else (no Services/Actions); list reads require an explicit bounded `first`; all work counts into the owning Mutation's budgets; write recursion depth-bounded |

### Derived helpers on a Collection value

- `collection.select(entries)` — reusable selection value; entries are the
  selection object. `collection.select(true)` — the complete scalar row.
  Selection values spread into larger selections.
- `collection.createInput()` / `collection.updateInput()` — caller input
  codec objects derived from provenance. Methods: `.pick({ field: true })`,
  `.omit({ field: true })`. Compose into `codec.object({ ... })` by spread.
- `collection.list(plan)` / `collection.get(plan)` — structural read plans
  (below).

## Read plans

```ts
collection.list({
  parameters?: Record<string, Codec>,
  where?: ({ row, parameters }) => Expression,
  orderBy: OrderObject,               // required for list
  select: true | SelectionObject,
  page?: ({ parameters }) => ({ first, after }),
})
collection.get({
  parameters?: ...,
  where: ({ row, parameters }) => Expression,
  select: true | SelectionObject,     // no root page member
})
```

- `list` returns `{ nodes, pageInfo: { endCursor, hasNextPage } }`; `get`
  returns `Row | null` (missing and Policy-hidden are the same `null`).
- `OrderObject`: `{ fieldName: "asc" | "desc" | { direction, nulls:
"first" | "last" } }`; authored property order is the total order; end
  with a unique field. Keys are fields of the paged Collection only;
  relation-nested ordering does not exist. To sort by a related row's
  field, page that Collection instead and express membership with a
  quantifier.
- `SelectionObject` entries: `field: true`; to-one
  `relation: { select: SelectionObject }` (bounded hops — candidate value 4
  in current examples, not yet ratified; see Budgets below); to-many
  `relation: { list: { where?, orderBy, first?, page?, select? } }`;
  computed `name: ({ row }) => row.relation.count()` (exactly one
  recognized aggregate call). Omitted nested `select` means the complete
  scalar row of the target.
- Nested to-many rules: under a plural parent only bounded top-N `first`;
  a cursor `page` is allowed only under a singular parent, wired from root
  parameters.
- Optional filters: a comparison whose parameter is `codec.nullable(...)`
  is disabled when bound `null`. Legal only directly inside `expr.and`
  (or as the entire filter) and never under `expr.not` or as a bare
  `expr.or` branch.
- Budgets: pages max 100 rows (ratified). Relation depth and the maximum
  computed aggregate members per plan are also bounded, but their exact
  ceilings (4 and 4 in current examples) are unratified implementation
  candidates pending measurement against Support Desk and Autopilot, not
  accepted constants. List parameters are bounded by their declared maximum.
- Scope: `where` and nested callbacks receive `{ row, parameters }`. In a
  plan-backed Query those are the only operands; a read scoped to the
  caller (for example “rows of my membership”) is a handler Query, whose
  inline kernel plans may compare Fields against plain runtime values
  (`row.membershipId.equal(ctx.values.membershipId)`), bound as statement
  parameters.

## Expressions (`expr.*` and operands)

Field operand methods (on `row.field`, `current.field`,
`candidate.field`, parameter operands): `.equal(x)`, `.notEqual(x)`,
`.in(listOrParam)`, `.notIn(listOrParam)`, `.isNull()`,
`.greaterThan(x)`, `.greaterOrEqual(x)`, `.lessThan(x)`,
`.lessOrEqual(x)`.

Relation operands (Query filters only): `.some(predicate)`,
`.none(predicate)`, `.every(predicate)`, `.count()` (selection only).
Quantifiers and `count()` evaluate over rows the current caller may read.

Combinators: `expr.and(...children)`, `expr.or(...children)` (each needs
two or more children), `expr.not(child)`, `expr.always()`, `expr.never()`.

`expr.exists(collection, ({ row }) => Expression)` — Policy programs only:
a boolean, nondisclosing evidence read that does not apply the target's
read Policy and cannot return the row. Using it in a Query filter is a
compile error; use relation quantifiers instead.

Types for reusable predicates: `PolicyScope` = `{ principal, tenant }`
operands; `RowOperand<typeof collection>` = the operand type of `row`,
`current`, and `candidate` for that Collection.

## Policy

```ts
definePolicy(collection, {
  name: string,
  read:   { admit, rows },
  create: { admit, candidate },
  update: { admit, rows, candidate },
  delete: { admit, rows },
  fields: { create?, update? },       // maps caller-writable field ->
})                                     // Expression granting authority
```

- `admit`: `policy.authenticated()`, `policy.public()`, or
  `policy.admit(({ principal, tenant, values }) => boolean)` — synchronous,
  immutable facts only, no database or Service access.
- `rows`: `({ row | current, principal, tenant }) => Expression` — row
  scope, intersected into SQL before filters, ordering, pagination, locks.
- `candidate`: `({ candidate, current?, principal, tenant }) => Expression`
  — validates the complete final row inside the owning transaction,
  whatever lane produced each value.
- `fields`: per-Field authority over the caller patch only; server-owned
  fields never appear here.

## Queries and Mutations

```ts
defineQuery({
  name, network?: boolean, policy, query?  /* plan */,
  handler?, output?, errors?, http?, mcp?,
})
defineMutation({
  name, network?: boolean, policy, input, handler,
  output?, errors?, http?, mcp?,
})
```

- Plan-backed Query: `query:` plus no handler; input and output are
  inferred and validated from the plan.
- Handler Query: all `ctx.data` reads share one consistent snapshot.
- Mutation handler context (`ctx`): `data` (kernel below), `tenant`,
  `values` (resolved Context values), `now` (transaction-stable Date),
  `callId`, `signal`, `deadline`, `jobs` (acceptance below).
- Query handler context: `data` (read-only kernel), `tenant`, `values`,
  `signal`, `deadline`.
- `errors`: map of `operation.error({ code, status })`; thrown via the
  typed `errors` bag; part of the generated client's error union.
- Output inference: allowed when the return derives from typed kernel calls
  with known selections; otherwise pin `output` with a codec.
- Exact duplicate Mutation delivery (same `callId`, same input) returns the
  stored committed result; same `callId` with different input is rejected.

### Collection kernel (inside handlers)

```ts
ctx.data.tickets.get({ key, select? })            // Row | null
ctx.data.tickets.list(plan)                        // { nodes, pageInfo }
ctx.data.tickets.create({ input?, values?, select? })
ctx.data.tickets.update({ key, expected?, patch?, values?, select? })
ctx.data.tickets.delete({ key })
```

- `key`: the primary key object, or the complete column set of any
  declared unique constraint of the Collection (compiler-verified).
  `expected`: compare-and-set equalities against the current row; mismatch
  returns `null` without writing.
- A `create`/`update` losing a race to a declared unique constraint throws
  a typed `ConstraintViolation` naming the declared constraint and no raw
  database detail; test it with
  `operation.isConstraintViolation(error, "constraintName")` and rethrow a
  declared error.
- Cross-Collection readability checks are kernel reads: a
  `ctx.data.<target>.get({ key })` returning `null` means missing or not
  readable under the target's own Policy. Policy programs do not restate
  another Collection's read Policy.
- `patch`: caller-writable members only (typed from provenance). `values`:
  trusted server lane; may set `server: true` fields; still passes
  normalization, validation, candidate Policy, and constraints. Empty
  updates are rejected.
- Omitted `select` returns the complete scalar row. `update`/`delete`
  return `null` when the row is missing, hidden, or `expected` fails.

## Jobs

```ts
defineJob({
	name,
	input,
	output,
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({
		maximumAttempts,
		initialDelay,
		backoff: "exponential",
		maximumDelay,
		jitter: "full",
		horizon,
	}),
	handler: async ({ input, ctx }) => output,
});
```

Job handler context: `principal`, `tenant`, `values`, `signal`, `deadline`,
`run.id`, `attempt.number`, `attempt.now()`, `attempt.sleepUntil(date)`,
`attempt.heartbeat()`.

`durable.caller({ whenDenied: "fail" })` is the only `runAs` recipe: each
attempt runs as the accepting caller's Principal with fresh Context and
Policy. A Job concerning another person carries that person's id as input
data; there is no run-as-system or run-as-other recipe.

- Heartbeat is automatic until the attempt deadline; manual
  `attempt.heartbeat()` matters only for CPU-bound loops that starve the
  event loop.
- `attempt.sleepUntil(date)`: an **advanced** signal-aware wait inside an
  attempt that is already running for some other reason — not durable
  scheduling, since it holds a live worker and lease for the wait. Targets
  beyond the attempt budget are rejected (use `notBefore` on acceptance
  instead, which holds no worker at all until the instant arrives); after a
  crash the fresh attempt re-sleeps toward the same absolute instant rather
  than resuming a saved wait. When a delay is the whole reason a Job exists,
  accept it with `notBefore`; never accept immediately and `sleepUntil` the
  target as the sole mechanism.

Acceptance (Mutation context or server execution):

```ts
await ctx.jobs.<domain>.<name>.accept({ input, idempotencyKey?, notBefore? })
// -> { runId, resource }
```

- `idempotencyKey` may be omitted only at a callsite the compiler proves
  runs at most once per Mutation call. Loops, batches, shared helpers, and
  all server-direct acceptance require it explicitly; omission is a compile
  diagnostic.
- Same identity + same canonical request replays to the same receipt;
  same identity + changed input/`notBefore`/run-as conflicts.
- Acceptance is transactional with the surrounding Mutation.

## Services and configuration

```ts
defineService({
  name, lifetime: "application" | "execution",
  effect: "external" | "transactionSafe",
  eager?: boolean,
  config?: Record<string, Codec | config.secret(Codec)>,
  runtime?: { packages: string[] },
  create: async ({ config, signal, services? }) => instance,
  dispose?: (instance) => void | Promise<void>,
})
```

- `config.secret(codec)` marks redacted values; secrets never enter build
  artifacts, logs, or diagnostics and unwrap only inside the Service's
  construction.
- Values arrive from `createApp({ config })`, the generated environment
  mapping of `questpie start`, or `loadAppConfig()` (from `#questpie/app`)
  for CLI scripts. Validation failures fail startup with exact paths.
- `eager: true` constructs at startup and fails readiness on error;
  required for Services the credential resolver depends on.
- Query and Mutation handlers cannot receive external-effect Services;
  Actions and Routes can.

## HTTP and MCP projection members

On a Query or Mutation:

```ts
http: {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: "/api/tickets/:ticketId",
  request: {
    path?: { pathParam: inputMember },
    query?: { queryParam: inputMember },
    headers?: { headerName: inputMember },
    body?: inputMember | true,
  },
  responses: { ok: status, <declaredError>: status },
}
mcp: { tool: string, description: string, readOnly?: boolean }
```

- One `http` binding per Operation. GET only when the entire input encodes
  into path/query within the encoded-length budget; otherwise POST.
- Every Mutation `http` projection automatically binds the
  `Idempotency-Key` request header to the Mutation call identity; it is
  not declared in `request.headers`, and retries carrying the same key
  recover the committed result.
- Declared errors map to statuses in `responses`; framework outcomes keep
  their exact meaning. A Mutation whose commit succeeded but whose response
  was lost reports HTTP `500` with the accepted ADR-0023 body — `{ code:
"COMMITTED_RESULT_UNAVAILABLE", retryable: true, transactionId }` plus
  top-level `callId` — never a sanitized generic `500` and never a different
  status; `retryable: true` means replay under the same `callId` recovers
  the receipt, not that the transport retries automatically.
- `mcp.tool` names must be unique application-wide; tools run through the
  same Policy, limits, and typed outcomes as every call.

## Generated client

```ts
const client = createClient({ baseUrl }).withContext(contextInput);

client.queries.<domain>.<name>({ input, signal?, timeout? })
client.mutations.<domain>.<name>({ input, callId?, signal?, optimistic? })
client.actions.<domain>.<name>({ input, effectKey, signal? })
```

Every callable Operation also exposes:

- `.key(input)` — stable cache identity;
- `.observe({ input, signal? })` — framework-neutral store with
  `subscribe(listener)`, `get()`, `refresh()`, `dispose()`;
- `.watch({ input })` — on compiler-proven watchable Queries.

Named types are generated per Operation: `TicketsQueueInput`,
`TicketsQueueResult`, `TicketsQueueError`, and so on
(`<Domain><Name><Role>`).

Mutation `optimistic` entries:
`{ query: client.queries..., input: exactInput, apply: (current) => next }`.
Overlay lifecycle: removed on pre-commit or declared failure; reconciled on
success; kept and flagged on post-commit ambiguity.

## React (`questpie/react`)

```ts
useQuery(operation, { input, enabled? })
useLiveQuery(operation, { input, enabled? })
useMutation(operation)
```

- Query state: `{ status: "loading" } | { status: "ready", data, stale,
refreshing } | { status: "declined", error } | { status: "failed",
failure, retry }`.
- Mutation value: `{ status: "idle" | "pending" | "success" | "declined" |
"failed" | "uncertain", call(envelope), data?, error?, failure?,
callId?, recover? }`. `recover()` replays the same call identity to fetch
  a committed result after response loss.
- Instantiate `useMutation` per acting component (for lists: per row).

## Diagnostics you will meet

| Code                                          | Meaning                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `QP-DATA-010 invalidCursor`                   | cursor does not match the current plan/parameters/authority scope; restart pagination              |
| `QP-DATA-020 nullableFilterPosition`          | optional filter outside a positive `expr.and` position                                             |
| `QP-DATA-021 nestedCursorUnderPluralParent`   | cursor paging on a nested list under a plural parent                                               |
| `QP-DATA-022 relationDepthExceeded`           | selection or filter beyond the bounded relation-hop limit (unratified candidate: 4)                |
| `QP-DATA-023 databaseOwnedField`              | a lane supplied an `onUpdate` database-owned field                                                 |
| `QP-DATA-024 lifecycleRecursionExceeded`      | afterWrite write chain exceeded its depth bound                                                    |
| `QP-DATA-025 unsupportedExpressionCapability` | `expr.exists` in a Query filter, or a computed selection that is not one recognized aggregate call |
| `QP-COMPOSE-013 structuralTypeError`          | invalid structural declaration (for example conflicting provenance)                                |
| `QP-COMPOSE-023/024`                          | operation name collisions / unsafe final `then` segment                                            |
| `QP-COMPOSE-025 routeSubtreeCollision`        | a Route under another owner's wildcard subtree                                                     |
| `QP-COMPOSE-026 httpProjectionInvalid`        | unrepresentable or colliding HTTP projection                                                       |
| `QP-COMPOSE-027 mcpToolCollision`             | duplicate MCP tool name                                                                            |

Missing `idempotencyKey` at a non-provable Job acceptance callsite is a
compile diagnostic naming the exact callsite. A `ConstraintViolation`
thrown by a kernel write is a typed runtime outcome (not a QP diagnostic)
carrying the declared constraint name.
