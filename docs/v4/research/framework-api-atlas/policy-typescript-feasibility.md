# Policy TypeScript and DX feasibility

- Status: focused design evidence; no v4 acceptance authority
- Atlas ticket: #4, with dependencies on #2 and #3
- Scope: contextual typing and type-cost feasibility only; runtime Policy,
  SQL lowering, RLS, nondisclosure and Context Resolution remain separate proof
  obligations
- Authority: `SPEC.md` sections 5–8, the accepted composition contract, and
  the accepted Data/structural Query contract

## Result first

Use a Collection value as the explicit type source:

```ts
definePolicy(messages, {
	/* Policy body */
});
```

Use the same rule at every correlated subquery boundary:

```ts
policy.exists(companyMemberships, ({ row: membership }) => /* predicate */);
```

This is the smallest candidate with a credible TypeScript story. The first
argument fixes one compact Collection Definition Contract before TypeScript
contextually types the second argument. Each `exists` call independently fixes
the target row type from its own first argument. No callback needs `any`, a
manual generic, an ambient registry, or the complete resolved application.

The generated-`AppData` and `policy.for(collection)` forms can also be typed,
but neither buys stronger inference. `AppData` adds a generated build edge and
cannot be the universal Package-authoring form. `policy.for` adds currying and
makes the `policy` namespace both a Definition factory and an expression DSL.

This recommendation is not acceptance. It needs the executable proof listed at
the end of this document before the syntax enters a contract or public page.

## The end-application API

The primary fixture deliberately crosses four Collections before proving
Company membership. It does not rely on a recursive Relation graph hidden in a
type.

```ts
// src/features/messages.ts
import { definePolicy, policy, query } from "questpie";
import {
	channelMemberships,
	channels,
	companies,
	companyMemberships,
	messages,
	spaces,
} from "../model/collaboration";

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",

	read: {
		admit: policy.authenticated(),
		rows: ({ row: message, principal }) =>
			policy.exists(channels, ({ row: channel }) =>
				query.and(
					channel.id.equal(message.channelId),
					policy.exists(spaces, ({ row: space }) =>
						query.and(
							space.id.equal(channel.spaceId),
							policy.exists(companies, ({ row: company }) =>
								query.and(
									company.id.equal(space.companyId),
									policy.exists(companyMemberships, ({ row: membership }) =>
										query.and(
											membership.companyId.equal(company.id),
											membership.principalId.equal(principal.id),
											membership.status.equal("active"),
										),
									),
								),
							),
						),
					),
					query.or(
						channel.visibility.equal("company"),
						policy.exists(channelMemberships, ({ row: membership }) =>
							query.and(
								membership.channelId.equal(channel.id),
								membership.principalId.equal(principal.id),
								membership.status.equal("active"),
							),
						),
					),
				),
			),
	},

	fields: {
		output: ({ fields, principal }) => [
			policy.require(
				[fields.moderationNote],
				fields.authorId.equal(principal.id),
			),
		],
		create: ({ fields, authority }) => [
			policy.require([fields.moderationNote], authority.isSystem()),
		],
		update: ({ fields, authority }) => [
			policy.require([fields.moderationNote], authority.isSystem()),
		],
	},
});
```

The nesting is intentionally visible: it is authorization structure, not
compiler plumbing. An application may instead express equivalent joins through
accepted Relation predicates once that syntax is proved. The inference rule
must remain the same: every new target is introduced by an exact typed value,
never by a broad name or a recursive application registry.

### Package-owned Collections

The same syntax works when the Collection Owner is a Package:

```ts
// src/features/audit-policy.ts
import { definePolicy, policy } from "questpie";
import { auditEvents } from "@acme/audit/questpie";

export const auditPolicy = definePolicy(auditEvents, {
	name: "audit.events.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.tenantId.equal(tenant.id),
	},
	fields: {
		output: ({ fields, authority }) => [
			policy.require([fields.rawPayload], authority.isSystem()),
		],
	},
});
```

`auditEvents` carries its Resource Identity and small invariant Collection
Definition Contract. It does not carry the consumer's complete resolved App
Contract. Whether an application may attach a Policy to a Package-owned
Collection is a compiler ownership/attachment decision; it is not a reason to
weaken the reference to `string` or introduce an app-wide type registry.

### Extracting a reusable row scope

An extracted structural predicate must keep its Collection type source:

```ts
import { definePolicy, policy, query } from "questpie";
import { companyMemberships, messages } from "../model/collaboration";

const readableMessageRows = policy.rows(
	messages,
	({ row: message, principal }) =>
		policy.exists(companyMemberships, ({ row: membership }) =>
			query.and(
				membership.companyId.equal(message.companyId),
				membership.principalId.equal(principal.id),
				membership.status.equal("active"),
			),
		),
);

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",
	read: {
		admit: policy.authenticated(),
		rows: readableMessageRows,
	},
});
```

`policy.rows(messages, callback)` is justified only for extraction and reuse;
it is not required around an inline `rows` callback. Its result must retain an
invariant target identity so a Message predicate cannot attach to `channels`.
Ordinary TypeScript module extraction remains available without a framework-
required file split.

## The compact inference contract

The following declarations are illustrative minimums, not a proposed public
implementation. They show where every contextual type must originate.

```ts
declare const collectionContract: unique symbol;

interface PolicyCollectionSource<
	Identity extends `collection:${string}`,
	Fields extends PolicyFieldContractMap,
> {
	readonly [collectionContract]: {
		readonly identity: Identity;
		readonly fields: Fields;
	};
}

type AnyPolicyCollectionSource = PolicyCollectionSource<
	`collection:${string}`,
	PolicyFieldContractMap
>;

type ContractOf<C extends AnyPolicyCollectionSource> =
	C[typeof collectionContract];

declare function definePolicy<
	const C extends AnyPolicyCollectionSource,
	const Name extends string,
>(
	collection: C,
	body: PolicyBody<ContractOf<NoInfer<C>>, Name>,
): PolicyDefinition<`policy:${Name}`, ContractOf<C>["identity"]>;

declare const policy: {
	exists<const C extends AnyPolicyCollectionSource>(
		collection: C,
		predicate: (
			scope: PolicyExistsScope<ContractOf<NoInfer<C>>>,
		) => PolicyBooleanExpression,
	): PolicyBooleanExpression;

	rows<const C extends AnyPolicyCollectionSource>(
		collection: C,
		predicate: (
			scope: PolicyRowScope<ContractOf<NoInfer<C>>>,
		) => PolicyBooleanExpression,
	): PolicyRowPredicate<ContractOf<C>["identity"], ContractOf<C>["fields"]>;
};
```

The real public declaration must retain the same bounded erased base and pass
the repository's public-`any` audit. No callback or application value may
acquire `any`. `NoInfer` makes the Collection argument the sole source of `C`;
the callback checks against that contract instead of widening or repairing it.
The executable proof must run on QUESTPIE's declared minimum TypeScript version,
not only the current repository compiler.

The important representation rule is that `PolicyCollectionSource` projects a
bounded invariant contract. `definePolicy` and `policy.exists` must not retain
or conditionally traverse the entire authored Collection configuration,
Augmentation tuple, Relation graph, generated `AppData`, or ORM type. The local
contract may include Owner Fields plus its explicitly accepted Augmentation
Fields because composition already resolves that bounded tuple at the Owner
boundary.

### Exact type sources

| Authored position                                         | Contextual type source                      | Required result                                           |
| --------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| outer `message` row                                       | first argument to `definePolicy`            | exact Message Field operands                              |
| nested `channel`, `space`, `company`, or `membership` row | first argument to that `policy.exists` call | exact target Field operands only                          |
| `fields` in a Field-authority map                         | first argument to `definePolicy`            | exact Message Field map                                   |
| `principal`, `tenant`, `authority`                        | closed core Execution operand contract      | immutable typed operands, not an application bag          |
| extracted `PolicyRowPredicate`                            | `policy.rows(messages, ...)`                | invariant `collection:messages` target                    |
| Policy target identity                                    | Collection Definition Contract              | literal Resource Identity retained in emitted declaration |

The callback may close over an outer Field operand. For example,
`membership.companyId.equal(company.id)` compares two compatible UUID operands.
This is ordinary lexical capture of structural expression values. It does not
embed an executable callback in the Compiled Manifest.

## Three authoring shapes

### A. `definePolicy(collection, body)` — recommended

```ts
import { definePolicy, policy } from "questpie";
import { messages } from "../model/collaboration";

export const messagePolicy = definePolicy(messages, {
	name: "messages.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.tenantId.equal(tenant.id),
	},
});
```

Feasibility:

- TypeScript infers `C` from the first argument, then contextually types the
  object literal from `PolicyBody<ContractOf<C>>`.
- Literal `name` inference remains available because the caller supplies no
  explicit type argument.
- The type source is independent of object-property order. This is more robust
  than asking a sibling `collection:` property to establish the generic used by
  callbacks in the same context-sensitive object literal.
- Imported local and Package-owned Collection values use the same form.
- `policy.exists(target, callback)` repeats the successful first-argument
  contextual-typing pattern at every hop.

Cost: the Collection appears once outside the body rather than as a named
`collection:` property. The emitted Definition still records its exact target;
there is no runtime ambiguity.

### B. `definePolicy<AppData descriptor>()(body)` — viable, not universal

Because TypeScript does not support partial generic inference, the credible
form is two-stage rather than `definePolicy<Descriptor>(body)`:

```ts
import type { AppData } from "#questpie/app";
import { definePolicy, policy, query } from "questpie";
import { companyMemberships } from "../model/collaboration";

export const messagePolicy = definePolicy<AppData["collections"]["messages"]>()(
	{
		name: "messages.default",
		collection: "messages",
		read: {
			admit: policy.authenticated(),
			rows: ({ row: message, principal }) =>
				policy.exists(companyMemberships, ({ row: membership }) =>
					query.and(
						membership.companyId.equal(message.companyId),
						membership.principalId.equal(principal.id),
					),
				),
		},
	},
);
```

Feasibility:

- the explicit leaf descriptor supplies exact resolved Message Fields;
- the second call can still infer literal Policy name and body details;
- `collection` must remain as a runtime literal because the generic disappears
  after TypeScript erasure, and its type must equal the descriptor's exact
  `name`.

Costs:

- source now depends on a current virtual/generated application file;
- a Package cannot author a reusable Policy against its consumer's generated
  `AppData`;
- stale or bootstrap generated types become part of Policy authoring;
- careless helpers over
  `AppData["collections"][keyof AppData["collections"]]` distribute over the
  whole application and recreate the type-cost pattern forbidden by `SPEC.md`;
- the target is stated twice: once in the type argument and once in emitted
  runtime data.

The accepted structural `dataQuery<AppData[... ]>()({...})` form needs exact
application-resolved Relation and selection information. Collection Policy does
not establish the same need: its Collection value already has the bounded local
Field contract, and every external target is introduced explicitly to
`policy.exists`.

### C. `policy.for(collection)(body)` — viable, no type advantage

```ts
import { policy } from "questpie";
import { messages } from "../model/collaboration";

export const messagePolicy = policy.for(messages)({
	name: "messages.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.tenantId.equal(tenant.id),
	},
});
```

Feasibility:

- the first call captures the same compact Collection contract as option A;
- the returned generic function contextually types the body and infers its
  literal name;
- Package-owned Collections work identically.

Costs:

- it adds currying without solving a partial-inference problem;
- `policy` now creates a Policy Definition through `.for` while also creating
  boolean, admission, Field-rule, and `exists` expressions;
- `for` is semantically weak in diagnostics and search results compared with
  the explicit Resource factory `definePolicy`;
- it invites a stateful/fluent builder interpretation even though compilation
  needs one ordinary immutable Definition value.

If a future authoring study finds the curry materially clearer, it can be a
thin alias. It should not be the only canonical form and does not warrant a
second internal representation.

## Editor and negative-contract expectations

The proof must pin editor-visible behavior, not merely a successful compiler
exit.

| Expression                                     | Expected hover or completion                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| `message.`                                     | only Message Fields such as `channelId`, `authorId`, `moderationNote`                  |
| `channel.`                                     | only Channel Fields such as `id`, `spaceId`, `visibility`                              |
| `membership.` in `companyMemberships` callback | only Company-membership Fields                                                         |
| `message.channelId.`                           | operators supported by the UUID codec                                                  |
| `fields.` in Message Field map                 | exact Message Fields, including accepted local Augmentation Fields                     |
| `principal.`                                   | closed Principal operands; no request, database, mutable context or arbitrary app keys |
| `tenant.`                                      | the closed Tenant operand contract selected by the Context ticket                      |
| `authority.`                                   | closed Authority-class predicates; no normal-input System elevation                    |

Required negative fixtures:

```ts
// @ts-expect-error Channel Fields do not leak onto Message rows.
message.spaceId;

// @ts-expect-error Company-membership Fields do not leak onto Channel membership.
channelMembership.companyId;

// @ts-expect-error incompatible Field codecs cannot be compared.
membership.companyId.equal(message.createdAt);

// @ts-expect-error a broad string is not a typed Collection target.
policy.exists("companyMemberships", ({ row }) => row);

// @ts-expect-error the bounded Collection contract is not a recursive app graph.
message.channel.space.company.memberships;

// @ts-expect-error exact Message Field map rejects unknown members.
fields.secretThatDoesNotExist;

// @ts-expect-error extracted Message predicate cannot attach to Channels.
definePolicy(channels, {
	name: "channels.default",
	read: { rows: readableMessageRows },
});
```

The proof should also assert that callback parameters are not implicitly `any`
under `strict`, declarations preserve exact identities, completion does not
include ORM members, and property reordering inside the Policy body does not
change inference.

## Instantiation-risk analysis

Option A and option C have the same possible low-cost shape. Option B is safe
only if every helper receives one concrete leaf descriptor and never forms an
application-wide Collection union.

The implementation should preserve these boundaries:

1. **Project immediately.** Extract `{ identity, fields }` from a Collection
   value at the public boundary. Do not thread the entire `typeof messages`
   Definition return type through every expression.
2. **Keep each hop independent.** `exists<C>` maps only `C`'s Field contract.
   It must not recursively instantiate `C`'s Relations or possible targets.
3. **Do not build `AllCollections`.** Correlated access is expressed by explicit
   Collection arguments, not a union indexed by arbitrary identity.
4. **Brand extracted predicates invariantly.** Identity mismatch should be one
   cheap assignability error, not a recursive structural comparison.
5. **Alias mapped operands.** Reuse one `PolicyRow<Fields>` and
   `PolicyFieldMap<Fields>` alias per contract instead of recomputing nested
   conditional types in each Policy slot.
6. **Keep codecs nominal or shallow.** Operand compatibility should compare a
   bounded codec/value tag, not recursively compare Field builder option types.
7. **Measure accepted Augmentations.** Owner Fields plus the literal accepted
   Augmentation tuple remain bounded local inference. The proof must include a
   realistic maximum tuple and demonstrate that its cost is not multiplied by
   each `exists` depth.
8. **Emit concrete app types.** Generated output should contain concrete Policy
   identities and targets. It must not export the generic authoring machinery
   as a recursively instantiated resolved-app type.

The four-hop example should therefore add roughly the cost of five small Field
maps, not five traversals of an application graph. Exact asymptotics cannot be
accepted from prose; TypeScript diagnostics must measure them.

## Recommendation and executable proof gate

Choose option A as the sole candidate for the focused proof:

```ts
definePolicy(collection, body);
policy.exists(targetCollection, callback);
policy.rows(collection, callback); // only when extracting a reusable scope
```

The proof must compile the complete four-hop application snippet verbatim and
include:

1. local, accepted-Augmentation, and Package-owned Collection values;
2. exact outer and nested callback inference under `strict` and
   `noImplicitAny`;
3. the Field-authority maps and all negative fixtures above;
4. a reusable extracted predicate with positive same-target and negative
   different-target attachment;
5. declaration emit showing leaf-local Definition identity and no resolved app
   graph or ORM type;
6. a wide fixture, a four-hop fixture, and a combined wide-plus-four-hop
   fixture measured separately with `tsc --extendedDiagnostics`;
7. a depth comparison of one, two, and four `exists` hops to catch recursive or
   superlinear growth;
8. cold and warm check time, Types, Instantiations, memory, and declaration
   size against the existing foundational proof baseline;
9. compiler normalization showing that callbacks become closed expression
   nodes and that no function enters canonical bytes;
10. compiler diagnostics for an unresolved target, duplicate attached Policy,
    incompatible Field comparison, illegal expression node, and Package
    attachment without accepted authority.

Only after those checks pass should the broader Policy contract decide SQL
pushdown, Relation sugar, Context operands, nondisclosure, RLS projection and
runtime parity. TypeScript feasibility makes the syntax credible; it does not
prove the authorization semantics.
