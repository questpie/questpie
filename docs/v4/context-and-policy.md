# Trusted Context and relational Policy contract

- Status: Accepted
- Projection: verified in public documentation
- Date: 2026-08-13
- Scope: Context Resolution, immutable root Execution facts, bounded bootstrap,
  Collection Policy, relational evidence, SQL row-scope lowering,
  nondisclosure, and execution-surface parity
- Authority: ADR-0010 and proof head
  `5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa`

## Boundary

This contract accepts P2 only. It does not implement a production compiler or
Runtime and does not accept P3 Query, Mutation, Collection Operation,
transaction, lifecycle, or network-error semantics.

The foundational proof at `d03358b7` fixes Schema, Data Contract, structural
Query, cursor, binding, and dependency bytes. ADR-0009 and P1 head
`713485a64bcc4795d960d576fea51da56bc4dcdd` fix executable compiler ownership,
the Current App Contract, inline handlers, Package isolation, and no-registry
rules. P2 does not reinterpret either input.

## One trusted application Context

An application declares at most one Context Definition:

```ts
import { codec, context, defineContext } from "questpie";
import { memberships } from "./collections";

export const appContext = defineContext({
	name: "app.context",
	input: codec.object({ companyId: codec.uuid() }),
	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") {
			throw context.error.unauthenticated();
		}

		const membership = await bootstrap.get(memberships, {
			key: {
				companyId: input.companyId,
				principalId: principal.id,
				scopeKey: "company",
			},
			select: {
				companyId: true,
				principalId: true,
				scopeKey: true,
				status: true,
				role: true,
			},
		});

		if (membership === null || membership.status !== "active") {
			throw context.error.notFound("tenant");
		}

		return {
			tenant: context.tenant({ id: membership.companyId }),
			values: {
				selectedMembershipPrincipalId: membership.principalId,
				selectedMembershipScope: membership.scopeKey,
				selectedRole: membership.role,
			},
		};
	},
});
```

`input` declares application meaning, not a Request, header, URL, connection,
or worker encoding. The generated protocol may carry the same exact value over
different transports without changing the Definition.

The resolver receives only decoded input, the already-resolved Principal, and
bounded `bootstrap.get`. Bootstrap accepts one known Collection, its exact key,
and an explicit selection. Its canonical plan records read-count,
selected-path, result-row, concurrency, duration, deadline, and cancellation
bounds. It can neither enumerate application Collections nor reach raw SQL,
the database, writes, Services, Queue, or System Authority.

Resolution runs once per root. Concurrent consumers share the same pending
resolution. Success freezes Principal, Tenant, Authority, and returned values;
nested work receives the same object. Failure occurs before Policy or a handler.
Execution-scoped Services remain separate lazy capabilities and dispose in
reverse creation order after callback success or failure.

### Root construction

The client and direct server surface share the Context input type:

```ts
const northwind = client.withContext({ companyId: "company-northwind" });

await app.execution(
	{
		principal: { kind: "user", id: "principal-ada" },
		context: { companyId: "company-northwind" },
	},
	({ queries }) =>
		queries.messages.page({
			channelId: "channel-general",
			first: 20,
			after: null,
		}),
);
```

`withContext` returns an independent immutable scope. It never mutates the
base client. Ordinary `app.execution` has no Authority option. System Authority
requires an unforgeable trusted Runtime capability and still does not imply a
global Policy bypass.

Nested work inherits the parent. A network request, Route transition, realtime
recomputation, physical durable attempt, or Studio action creates a deliberate
fresh root. Durable state carries a later run-as contract, not serialized
resolved Context.

## Collection-bound Policy

`definePolicy(collection, body)` gets its exact target row type from the
Collection value. `policy.exists(collection, predicate)` gets each nested row
type from its own Collection argument. Neither interface needs a whole-App
generic, ambient registry, ORM type, manual generic, or handler-selected map.

A Policy is a closed structural program. Its callbacks construct expressions;
they do not perform per-row JavaScript, arbitrary I/O, Service calls, or raw
SQL. The compiler rejects a program that it cannot lower without changing its
meaning.

One default Policy candidate may attach to a Collection. The compiler rejects
zero or multiple candidates wherever generated access requires an implicit
default. Import order cannot select Policy.

The closed attachment diagnostics are `QP-POLICY-001 missingDefaultPolicy` and
`QP-POLICY-002 ambiguousDefaultPolicy`. Both are compile-phase, fatal failures;
the ambiguous diagnostic carries candidate identities in canonical order.
They never represent a runtime denial. No other `QP-POLICY-*` spelling is
accepted by this contract.

### Fixed phases

Policy participates in this fail-closed semantic order:

1. Context input decode and Context Resolution;
2. operation admission;
3. existing/current row scope in SQL;
4. supplied caller-Field path authority;
5. later P3 normalization, defaults, and explicit server values;
6. complete candidate-row authority;
7. later P3 validation and normalized Constraint handling;
8. selected-output Field authority and encoding.

Create has a complete `candidate`. Update has `current` and `candidate`. Delete
has `current`. Policy checks state; it does not supply, rewrite, null-mask, or
silently discard values. P3 owns how the candidate is constructed and written.

Field rules are sparse. An absent key keeps the operation's already-declared
surface. Input checks inspect only caller-supplied canonical Field paths, stored
as segment arrays. A denied supplied path rejects the call. A denied output
Field is omitted, so the generated result member is optional; it is never
replaced with `null`.

## Relational evidence and disclosure

The accepted graph authorizes Message through Channel, Space, Company, and
Membership. Correlated `policy.exists` is a boolean-only evidence expression:

```ts
const readableMessageRows = policy.rows(
	messages,
	({ row: message, principal, tenant }) =>
		policy.exists(channels, ({ row: channel }) =>
			query.and(
				channel.id.equal(message.channelId),
				policy.exists(spaces, ({ row: space }) =>
					query.and(
						space.id.equal(channel.spaceId),
						policy.exists(companies, ({ row: company }) =>
							query.and(
								company.id.equal(space.companyId),
								company.id.equal(tenant.id),
								policy.exists(memberships, ({ row: membership }) =>
									query.and(
										membership.companyId.equal(company.id),
										membership.principalId.equal(principal.id),
										membership.scopeKey.equal("company"),
										membership.status.equal("active"),
									),
								),
							),
						),
					),
				),
			),
		),
);
```

Evidence and disclosure are different reads. Evidence does not recursively run
the target Collection's presentation Policy, because that can make Message
access depend on permission to list an ACL table and can create cycles. It
returns only a boolean and cannot return the matching row. If an operation
returns Membership, directly or through a Relation, ordinary Membership row
and Field Policy applies.

The compiler bounds evidence depth and records its Collections, Fields,
correlations, and dependency paths. Membership create/delete and role, status,
or scope changes are observable Policy dependencies. A role copied into
resolved Context is convenient display or branching data, never current
authorization evidence.

## SQL enforcement and paging

The normalized Policy AST is the single input to canonical artifacts and every
framework-owned SQL lowering. Effective row scope is:

```text
Policy rows AND operation rows AND caller filter
```

That predicate runs before counts, key lookup, ordering, cursor boundaries,
`first + 1` sentinel selection, locking, Relation disclosure, and output. The
Runtime cannot fetch a broader set and filter it in JavaScript. A lowerer that
cannot preserve the program fails the build.

A cursor binds the Policy digest and only the Principal, Tenant, and Authority
facts that the plan uses. The visible page and its sentinel use the same scope.
A cursor-scope mismatch fails before SQL or disclosure.

The exact scope value is:

```ts
interface PolicyCursorScopeV1 {
	format: "questpie.policy-cursor-scope";
	version: 1;
	policyProgramDigest: string;
	usedExecutionFacts: Partial<{
		authorityKind: "ordinary" | "system";
		principalId: string;
		tenantId: string;
	}>;
}
```

Only facts reached by the compiled read and selection plan are present; unused
members are omitted and `undefined` never enters the bytes. The scope uses RFC
8785 canonical JSON bytes plus one LF. Its digest is SHA-256 over the exact
domain prefix `questpie-policy-cursor-scope-v1\0` followed by those bytes.
Policy-protected Queries carry that digest as `policyScopeDigest` in
`DataCursorV2`; a mismatch uses the versioned
`QP-DATA-013 cursorScopeMismatch` trigger before SQL. Unrelated Context values
do not invalidate or authorize a cursor.

A lock waiter must re-evaluate current row scope, mutable evidence, and
candidate authority inside the Mutation transaction before writing. The P2
PostgreSQL witness revokes membership while a writer waits; after acquiring the
lock, the recheck affects zero rows and the stored Message remains unchanged.
P3 owns the complete transaction sequence.

The accepted foundational Index surface remains ordinary B-tree only. The P2
plan uses such an index, but does not add GIN, GiST, SP-GiST, BRIN, hash,
expression, partial, operator-class, raw-SQL, native-statement, or generic
`using` authoring authority.

## Nondisclosure and parity

Missing and Policy-invisible keyed rows produce the same result. Missing and
invisible references produce the same normalized result. Counts cover only
visible rows. Constraint and validation detail cannot reveal inaccessible
state. Output denial omits the Field and is not an error.

The same immutable facts and compiled Policy produce the same decision through
direct, network, nested, recompute, Route-transition, worker, and Studio paths.
Different transports may construct roots differently, but no surface has a
second access model or hidden Admin bypass.

## PostgreSQL RLS boundary

P2 emits no RLS. Its proof schema has no RLS-enabled table or PostgreSQL policy,
and the artifact records `derivedRls: notEmitted` with a null claim. The accepted
guarantee is Policy-enforced framework SQL.

A later derived-RLS contract must prove non-bypass roles, pooled connection
settings, transaction-local Principal/Tenant/Authority, `USING` and
`WITH CHECK`, relational races, and constraint nondisclosure before it can make
a database-enforced authorization claim. RLS can never replace operation
admission, Field authority, response shape, errors, dependencies, or run-as
semantics.

## Accepted proof

Proof head `5fbd9058e1cfb3bfef56f11a1d0ec7b6e14e88fa` passed one fresh focused
Opus-medium acceptance review. The proof includes the collaboration graph and
a materially different Archive/Record/ResearchPermit domain with a composite
natural key, no `id` assumption, and no Tenant-equality shortcut.

The proof measured 2,730 TypeScript instantiations, 24,048 KiB, 0.47 seconds
cold, 0.46 seconds warm, 0.32 ms completion p95, 0.40 ms hover p95, and 2,562
bytes of generated declarations. Four evidence hops grew instantiations only
1.114×; widening five Collection rows from 10 to 50 Fields was 1.000×.

On PostgreSQL 17.10, the four-hop statement covered 20,004 Message rows, planned
in 0.791 ms, executed in 0.670 ms, and used an ordinary B-tree bitmap index
scan. The hostile lock test waited 1,021 ms before the successful revocation
recheck. These are proof-host observations, not production performance
promises.

Canonical proof digests:

| Artifact                  | Digest                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| Context projection        | `fa8142f732af3c4c45ba6bcc008b63496cd75588d9cde417c1106dd774d4f1a5` |
| Context bootstrap plan    | `1f5bf9b40d4b3c797a0fc07f8473dc497ae21cdb0fdbeea87e979795150b963a` |
| Message Policy program    | `972c05336c129b4f4aaabe5f20aee46019497008920d6e02f3193d6353d63bcb` |
| Membership Policy program | `1e6013e7f682862d5c6a91a6666c4512a267353e37c58db419fa1399c8b92b1c` |
| Archive Policy program    | `9e331e56f4db891bf77201b2da46a13e2786bb02d69ec3c18982526daacf9f74` |
| Policy evidence graph     | `3ab4bf1b4da85ae2102038e75f2e254baa2e8cc856e45edf1370ca57ce495e9e` |
| Policy dependencies       | `a582e4c1c8abaf43babec1e95ad722bcd55db8c72dcf4b3c2a38d0abd3635099` |
| SQL lowering              | `a62df02bbf789b7eca994b1afd64a9cc6754fcd14b56541b199ad07181834dc7` |
| Nondisclosure             | `c2423f0ea51bad046c7ccfa07d69519b03ef197d72a4067ebb1c3ca22de94e7e` |
| Execution-surface parity  | `6a0a1499103819123298b3a68143ee2f0c48a7665fe2c60cf7ae077f74e54ea6` |
| Policy explanation        | `9fb23aea897a3722ea801d784ed46d05b13aa202acf6b7ecdba2586696d0b20e` |

## Deferred seams

- P3: Query snapshots, Mutation transaction ownership, candidate construction,
  validation and Constraints, write execution, retry, cancellation, call
  identity, exact network errors, and Collection Operation lifecycle.
- P4: observed dependency capture and realtime invalidation. P2 fixes which
  Context-bootstrap and Policy evidence facts must be observed.
- P5: durable run-as persistence and physical attempt construction. P2 fixes
  fresh resolution and no worker elevation.
- P6: connected Fetch/client protocol, production Runtime lifecycle, Execution
  Envelope, and Studio implementation.
- Later focused contracts: Auth Packages, broad RLS, maintenance/System APIs,
  recursive Policy graphs, advanced joins, typed JSON-interior Policy, native
  SQL, and non-B-tree performance surfaces.

Production lowering must either support or reject multi-segment operands; P2
uses accepted single-Field paths. The Archive SQL witness must join the shared
lowerer when it becomes production code. Production bootstrap must enforce all
declared concurrency, row, and elapsed-time limits. Those implementation notes
do not weaken the accepted semantic boundary.
