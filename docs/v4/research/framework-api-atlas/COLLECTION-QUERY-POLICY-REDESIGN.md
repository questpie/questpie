# Collection, Query, lifecycle, and Policy redesign

- Status: supporting design candidate
- Parent: [Collection DX and durable-work redesign](./COLLECTION-DX-AND-DURABLE-WORK-REDESIGN.md)

## Canonical internal CRUD

Every Collection receives compiler-generated internal operations whether or
not the application exposes public Operations:

```ts
ctx.data.messages.get(...);
ctx.data.messages.find(...);
ctx.data.messages.create(...);
ctx.data.messages.update(...);
ctx.data.messages.delete(...);
```

This is target behavior. Current PostgreSQL Mutation lowering implements only
`get` and `create`; `update`, `delete`, and `list` may be typed but are filtered
out. Query declarations advertise `get`, while the generated Runtime Query
projection does not implement it. The target kernel therefore requires new
plans and exact declaration/runtime inventory tests.

Query receives the read-only projection. Mutation receives reads and writes in
its owning PostgreSQL transaction. Generated Operations, named Mutations, Job
Mutation checkpoints, and framework projections delegate to the same kernel.

The kernel owns exact codecs, unknown-key rejection, Policy and nondisclosure,
locking and candidate revalidation, constraints, lifecycle order, selection,
output authority, Change Ledger capture, cancellation, deadline, and
transaction ownership.

A named Mutation cannot bypass this kernel. Raw SQL and a raw transaction
handle remain absent from ordinary application code. Generated declarations and
Runtime projection must expose exactly the same `ctx.data` members.

## Explicit application interface

Remove the target concepts below:

```ts
defineCollectionOperations(...);

defineCollection({
  network: true,
  api: { ... },
});

create: {
  input: ["channelId", "body"],
}
```

A Collection is stored domain data, not an endpoint declaration. Adding a
Field must not silently add a client method, accepted input, or returned Field.

Applications publish ordinary named Queries and Mutations:

```ts
export const messagePage = defineQuery({
	name: "messages.page",
	expose: "client",
	admission: policy.authenticated(),
	query: messages.findMany({
		parameters: {
			channelId: codec.uuid(),
		},
		where: ({ row, parameters }) => row.channelId.equal(parameters.channelId),
		select: {
			id: true,
			body: true,
		},
	}),
});
```

```ts
export const publishMessage = defineMutation({
	name: "messages.publish",
	expose: "client",
	admission: policy.authenticated(),
	input: codec.object({
		channelId: codec.uuid(),
		body: codec.text(),
	}),
	output: codec.object({
		id: codec.uuid(),
		body: codec.text(),
	}),

	async handler({ input, ctx }) {
		return ctx.data.messages.create({
			values: {
				channelId: input.channelId,
				body: input.body,
			},
			select: {
				id: true,
				body: true,
			},
		});
	},
});
```

Four small Operations are cheaper than a second CRUD exposure DSL. Real
applications will often prefer `page`, `publish`, `move`, `archive`, and
`approve` over unrestricted generic CRUD.

## Field write provenance

Canonical create and update inputs derive from Collection Field semantics, not
repeated string arrays. The model must distinguish:

- caller-writable on create and update;
- caller-writable only on create;
- server-derived;
- database-generated;
- immutable;
- key and Relation constraints.

Provenance is orthogonal to nullability, defaults, keys, and Policy. The
required semantic matrix is:

```ts
write: {
	create: "caller-required" |
		"caller-optional" |
		"server" |
		"database" |
		"forbidden";
	update: "caller" | "server" | "forbidden";
}
```

Exact fluent spelling remains open. Adding a server-derived or immutable Field
must not make it caller-writable. Provenance defines the possible write
surface; Policy decides per-Execution authority over it. Augmentations may set
provenance for Fields they establish but cannot rewrite an existing Field.
The safe default is `forbidden`, and both provenance and Policy must allow a
caller path; neither can widen the other.

## Low-ceremony Structural Query

`Structural Query` remains the canonical term. `Data Plan` should not become a
Resource or a concept every beginner must name.

A Structural Query answers:

> What static, Policy-aware data shape executes inside the snapshot or
> transaction already owned by the caller?

It owns no identity, admission, exposure, handler, snapshot, client method,
retry, or runtime lifetime.

A one-use Structural Query stays inline. A genuinely reused selection or plan
may be a normal TypeScript value:

```ts
export const messageSummary = messages.select({
	id: true,
	body: true,
	author: {
		select: {
			id: true,
			name: true,
		},
	},
});
```

A pass-through Query needs no authored handler and infers input and output:

```ts
export const getMessage = defineQuery({
	name: "messages.get",
	expose: "client",
	admission: policy.authenticated(),
	query: messages.findOne({
		parameters: {
			id: codec.uuid(),
		},
		where: ({ row, parameters }) => row.id.equal(parameters.id),
		select: messageSummary,
	}),
});
```

The Structural Query declares parameter codecs once because TypeScript cannot
derive a runtime UUID codec from arbitrary `input.id` property access. The
pass-through Query inherits them. The compiler retains plan artifacts, SQL
lowering, parameters, output codecs, observation dependencies, and prepared
statement reuse behind this interface.

A handler Query owns one read-only repeatable-read transaction for every plan
it runs. Opening one transaction per `ctx.data.run` violates the snapshot
contract and must be repaired before this interface is accepted.

## Transport-neutral Policy

Policy is not HTTP middleware and is never derived directly from a header,
URL, worker placement, or arbitrary payload.

Three owners remain distinct:

1. Operation admission decides whether a Query, Mutation, Action, or Route may
   start.
2. Collection Policy decides which rows and Fields the current Execution may
   read or change, including complete candidate state.
3. Collection lifecycle and PostgreSQL constraints preserve domain invariants.

Ingress credentials resolve a Principal. Transport-neutral Context input and
Context Resolution create immutable Principal, Tenant, Authority, and
application facts for one root Execution. Policy evaluates them with current
relational database evidence.

Equivalent Execution facts against the same relational snapshot must produce
equivalent decisions for Fetch, direct, nested, Live Query recompute, Job,
Route transition, Studio, and tests. A later retry may correctly differ after
membership or other Policy evidence changes. Server location is not authority.
Trusted maintenance needs an explicit unforgeable capability separate from
ordinary `ctx.data`.

## Fresh authority for durable work

A Job persists neither Request, credentials, resolved Context, Services, nor an
ambient System flag. Acceptance stores a run-as recipe, canonical
transport-neutral Context input or compiler-owned selector, and trusted
causation. Every attempt creates a fresh root Execution, resolves current
Context, and evaluates current Policy.

Thus membership revocation can affect retry; payload cannot forge Principal or
Tenant; worker placement grants nothing; and cron requires explicit run-as.
Exact caller, change-actor, service-principal, and maintenance spellings remain
open, while this invariant is fixed.

## Fixed Collection lifecycle

Useful v3 lifecycle behavior belongs to Collection and its canonical CRUD
kernel, not an ordered registry of arbitrary hooks. Current get/create plans
already record a fixed lifecycle tuple, but executable normalization is limited
and update/delete do not reach it. Required realized jobs are:

- normalize caller values through an integrity-bound executable slice whose
  globals/imports and capabilities make the promised purity enforceable;
- derive server values from trusted facts and database operands;
- validate current and complete candidate state inside the transaction;
- perform bounded transaction-joined audit or invariant writes;
- capture Change Ledger facts and accept durable work atomically;
- project reads through selection, codecs, and Policy.

Exact phase names and callback shapes remain open. Rejected behavior includes
hook priorities, import-order execution, stale pre-transaction authorization,
external Services inside the transaction, detached promises, lossy
`afterCommit`, post-commit transforms that resemble rollback, and any bypass
through named Mutation or Job execution.

Small transformations should read like ordinary TypeScript, for example
`input.name.trim()`, but a missing `ctx.services` property alone does not block
ambient `fetch`, `Date`, randomness, imports, or detached promises. The
compiler/evaluator must enforce the claimed execution class.

JavaScript validation receives one trusted PostgreSQL transaction time such as
`ctx.now`; static SQL assignments may use a branded database `now` operand.
`new Date()` cannot claim transaction-wide database authority, while a branded
SQL operand is not itself a JavaScript `Date` available to candidate validation.

Autopilot parity also requires bounded locks, compare-and-set, count, and bulk
write plans. Singular `get/find/create/update/delete` is the first kernel, not
a complete claim that every exceptional command becomes CRUD.
