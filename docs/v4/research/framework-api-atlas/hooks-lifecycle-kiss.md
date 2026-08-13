# KISS lifecycle contract: useful v3 jobs without the v3 hook bag

- Status: design evidence; no v4 acceptance authority
- Atlas ticket: #6
- Scope: the smallest first-usable lifecycle surface for normalizing input,
  assigning server-owned values, enforcing cross-Collection invariants,
  recording transactional audit facts, and starting post-commit external work
- Fixed premises: explicit ordinary timestamp Fields; one Mutation-owned
  transaction; Policy never rewrites values; durable work starts from
  transactionally committed intent; external effects belong to Actions

## Recommendation in one sentence

Keep a tiny, closed Field-input normalization seam and the existing declarative
Mutation Value Program for ordinary Collection operations; use one inline named
Mutation as soon as business logic reads or writes another Collection; commit a
typed Reaction intent in that transaction; let the durable Reaction call a
named external Action with a stable effect identity.

Do not ship a general Collection lifecycle Resource or a `before*`/`after*`
callback catalogue in the first usable layer. That interface is shallow: the
author must learn many phase names while QUESTPIE still cannot make an arbitrary
callback deterministic, retry-safe, transaction-safe, or durable.

This recommendation preserves the useful v3 jobs. It rejects only the v3
mechanisms whose failure is already demonstrated: write callbacks before the
write transaction, unrestricted hook context, output failure after commit, and
lossy in-memory `afterCommit` effects.

## The use case every design must express

The comparison uses one `messages.create` capability. It must:

1. trim `title` as a Field-local normalization;
2. derive a slug from the normalized title;
3. force `companyId` from Tenant and `createdBy` from Principal;
4. initialize explicit ordinary `createdAt` and `updatedAt` Fields;
5. prove inside the Mutation transaction that the Channel belongs to the
   selected Company and accepts posts;
6. insert a `messageAudits` row in the same transaction;
7. commit durable intent for a post-commit notification; and
8. send email through an external Action, safely under Reaction retry.

The examples use the accepted explicit Fields. There is no hidden `id`,
`createdAt`, or `updatedAt`, and no Field-name convention updates a timestamp.
`default: "now"` could initialize the two timestamp Fields on create; these
examples assign `ctx.operationTime` instead so the complete Mutation post-image
and audit fact visibly share one stable transaction-owned value. An update must
likewise assign `updatedAt` explicitly.

The exact syntax in all three variants is design fiction. It exists to compare
developer interfaces before executable proof.

## Variant A: familiar, phase-constrained Collection hooks

### Complete end-application code

```ts title="src/features/messages.ts"
import {
	defineAction,
	defineCollectionLifecycle,
	defineReaction,
	lifecycle,
	operation,
	reaction,
} from "questpie";
import {
	channels,
	messageAudits,
	messages,
	users,
} from "../model/collaboration";

const slugify = (value: string) =>
	value
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export const sendMessageCreatedEmail = defineAction({
	name: "email.sendMessageCreated",
	input: operation.object({
		to: operation.email(),
		messageId: operation.uuid(),
		title: operation.text({ maximumLength: 200 }),
		idempotencyKey: operation.text({ maximumLength: 200 }),
	}),
	handler: async ({ input, ctx }) =>
		ctx.services.mailer.send({
			to: input.to,
			template: "message-created",
			data: { messageId: input.messageId, title: input.title },
			idempotencyKey: input.idempotencyKey,
		}),
});

export const messageCreated = defineReaction({
	name: "messages.created",
	input: operation.object({ messageId: operation.uuid() }),
	runAs: reaction.caller(),
	retry: reaction.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, attempt }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, createdBy: true, title: true },
		});

		if (message === null) return;

		const author = await ctx.data.users.get({
			key: { id: message.createdBy },
			select: { email: true },
		});

		if (author === null) return;

		await ctx.actions["email.sendMessageCreated"]({
			to: author.email,
			messageId: message.id,
			title: message.title,
			idempotencyKey: attempt.effect("message-created-email"),
		});
	},
});

export const messageLifecycle = defineCollectionLifecycle(messages, {
	name: "messages.lifecycle",

	hooks: {
		normalize: {
			create: ({ input }) => ({
				...input,
				title: input.title.trim(),
			}),
		},

		derive: {
			create: ({ normalized, principal, tenant, operationTime }) => ({
				...normalized,
				slug: slugify(normalized.title),
				companyId: tenant.id,
				createdBy: principal.id,
				createdAt: operationTime,
				updatedAt: operationTime,
			}),
			update: ({ normalized, operationTime }) => ({
				...normalized,
				updatedAt: operationTime,
			}),
		},

		beforeWrite: {
			create: async ({ candidate, ctx, errors }) => {
				const channel = await ctx.data.channels.get({
					key: { id: candidate.channelId },
					select: { companyId: true, postingEnabled: true },
				});

				if (
					channel === null ||
					channel.companyId !== candidate.companyId ||
					!channel.postingEnabled
				) {
					throw errors.channelUnavailable();
				}
			},
		},

		afterWrite: {
			create: async ({ after, ctx }) => {
				await ctx.data.messageAudits.create({
					input: {
						messageId: after.id,
						kind: "created",
						principalId: ctx.principal.id,
						occurredAt: ctx.operationTime,
					},
					select: { id: true },
				});

				await ctx.dispatch["messages.created"]({ messageId: after.id });
			},
		},
	},
});
```

The framework would have to promise that `normalize`, `derive`, `beforeWrite`,
the canonical Message write, `afterWrite`, the audit insert, and dispatch-intent
insert all execute after one Mutation transaction opens and before it commits.
Every thrown error rolls all of them back. `afterWrite` is therefore a
transaction hook, despite the dangerous familiarity of the word “after.” It is
not post-commit.

The contextual types are strong in principle:

- `defineCollectionLifecycle(messages, ...)` types `input`, `candidate`, and
  `after` from `messages`;
- the `channels` and `messageAudits` members come from the concrete generated
  Mutation `ctx`;
- `principal`, `tenant`, and `operationTime` are closed Mutation operands;
- `ctx.dispatch["messages.created"]` is generated from the Reaction input; and
- the Reaction and Action handlers receive their own generated mode-specific
  contexts.

The cost is hidden control flow. Any `ctx.data.messages.create` now invokes code
that is not visible at its call site. Re-entrant writes, ordering between local
and Package hooks, bulk operations, per-hook error identity, and which lifecycle
version applies to historical durable work all become public questions. Four
callbacks and one new Resource exist to express logic that fits naturally in
one Mutation handler. This is familiar, but it is not KISS.

## Variant B: closed normalize/value/check/write programs

### Complete end-application code

```ts title="src/features/messages.ts"
import {
	defineAction,
	defineCollectionOperations,
	defineReaction,
	mutation,
	operation,
	query,
	reaction,
	text,
} from "questpie";
import {
	channels,
	messageAudits,
	messages,
	users,
} from "../model/collaboration";
import { messagePolicy } from "./message-policy";

export const sendMessageCreatedEmail = defineAction({
	name: "email.sendMessageCreated",
	input: operation.object({
		to: operation.email(),
		messageId: operation.uuid(),
		title: operation.text({ maximumLength: 200 }),
		idempotencyKey: operation.text({ maximumLength: 200 }),
	}),
	handler: async ({ input, ctx }) =>
		ctx.services.mailer.send({
			to: input.to,
			template: "message-created",
			data: { messageId: input.messageId, title: input.title },
			idempotencyKey: input.idempotencyKey,
		}),
});

export const messageCreated = defineReaction({
	name: "messages.created",
	input: operation.object({ messageId: operation.uuid() }),
	runAs: reaction.caller(),
	retry: reaction.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, attempt }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, createdBy: true, title: true },
		});
		if (message === null) return;

		const author = await ctx.data.users.get({
			key: { id: message.createdBy },
			select: { email: true },
		});
		if (author === null) return;

		await ctx.actions["email.sendMessageCreated"]({
			to: author.email,
			messageId: message.id,
			title: message.title,
			idempotencyKey: attempt.effect("message-created-email"),
		});
	},
});

export const messageOperations = defineCollectionOperations(messages, {
	name: "messages",
	policy: messagePolicy,
	network: true,

	create: {
		input: ["channelId", "title", "body"],
		normalize: ({ input }) => ({
			title: text.trim(input.title),
		}),
		values: ({ input, principal, tenant, operationTime }) => ({
			slug: mutation.overwrite(text.slug(input.title)),
			companyId: mutation.overwrite(tenant.id),
			createdBy: mutation.overwrite(principal.id),
			createdAt: mutation.overwrite(operationTime),
			updatedAt: mutation.overwrite(operationTime),
		}),
		validate: ({ candidate, exists }) =>
			exists(channels, ({ row: channel }) =>
				query.and(
					channel.id.equal(candidate.channelId),
					channel.companyId.equal(candidate.companyId),
					channel.postingEnabled.equal(true),
				),
			),
		afterWrite: ({ row, write, dispatch }) => [
			write.create(messageAudits, {
				messageId: row.id,
				kind: "created",
				principalId: row.createdBy,
				occurredAt: row.createdAt,
			}),
			dispatch(messageCreated, { messageId: row.id }),
		],
		select: {
			id: true,
			channelId: true,
			title: true,
			slug: true,
			createdAt: true,
			updatedAt: true,
		},
	},

	update: {
		input: ["title", "body"],
		normalize: ({ input }) => ({
			title: text.trimIfPresent(input.title),
		}),
		values: ({ input, operationTime }) => ({
			slug: mutation.overwriteIfPresent(input.title, text.slug(input.title)),
			updatedAt: mutation.overwrite(operationTime),
		}),
		select: { id: true, title: true, slug: true, updatedAt: true },
	},
});
```

Every callback above builds a closed structural program; none is an executable
user callback. The compiler can serialize the exact normalization, assignment,
correlated existence check, audit insert, and dispatch target. The Runtime opens
one Mutation transaction before evaluating that program. There is no I/O
capability to misuse in `normalize` or `values`, and the only post-write steps
are compiler-known transactional writes.

Contextual typing comes from visible structural arguments:

- `messages` supplies the input Field names, candidate, returned row, and
  assignment targets;
- `channels` supplies the nested `channel` Fields;
- `messageAudits` supplies the exact audit insert shape;
- `messageCreated` supplies the dispatch payload; and
- closed `principal`, `tenant`, and `operationTime` operands come from the
  generated Collection Mutation contract.

This interface is highly inspectable and AI-friendly. Its weakness is depth.
The first real application condition that does not fit `exists`, one insert,
and one dispatch expands the public grammar into branching, loops, multiple
reads, error mapping, and write dependencies. QUESTPIE would be building a
second programming language beside TypeScript. `afterWrite` is also a misleading
name because it still runs before commit. Renaming it `transaction` or `steps`
improves correctness but does not remove the mini-workflow language.

## Variant C: one named Mutation, no Collection lifecycle layer

### Complete end-application code

```ts title="src/features/messages.ts"
import {
	defineAction,
	defineMutation,
	defineReaction,
	operation,
	policy,
	reaction,
} from "questpie";

const slugify = (value: string) =>
	value
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const createMessageInput = operation.object({
	channelId: operation.uuid(),
	title: operation.text({ minimumLength: 1, maximumLength: 200 }),
	body: operation.text({ minimumLength: 1, maximumLength: 20_000 }),
});

export const sendMessageCreatedEmail = defineAction({
	name: "email.sendMessageCreated",
	input: operation.object({
		to: operation.email(),
		messageId: operation.uuid(),
		title: operation.text({ maximumLength: 200 }),
		idempotencyKey: operation.text({ maximumLength: 200 }),
	}),
	handler: async ({ input, ctx }) =>
		ctx.services.mailer.send({
			to: input.to,
			template: "message-created",
			data: { messageId: input.messageId, title: input.title },
			idempotencyKey: input.idempotencyKey,
		}),
});

export const messageCreated = defineReaction({
	name: "messages.created",
	input: operation.object({ messageId: operation.uuid() }),
	runAs: reaction.caller(),
	retry: reaction.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, attempt }) => {
		const message = await ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, createdBy: true, title: true },
		});
		if (message === null) return;

		const author = await ctx.data.users.get({
			key: { id: message.createdBy },
			select: { email: true },
		});
		if (author === null) return;

		await ctx.actions["email.sendMessageCreated"]({
			to: author.email,
			messageId: message.id,
			title: message.title,
			idempotencyKey: attempt.effect("message-created-email"),
		});
	},
});

export const createMessage = defineMutation({
	name: "messages.create",
	input: createMessageInput,
	policy: policy.authenticated(),
	errors: {
		channelUnavailable: operation.error({
			code: "CHANNEL_UNAVAILABLE",
			status: 404,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const title = input.title.trim();
		const slug = slugify(title);

		if (title.length === 0) {
			throw operation.validationError({ path: ["title"] });
		}

		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, companyId: true, postingEnabled: true },
		});

		if (
			channel === null ||
			channel.companyId !== ctx.tenant.id ||
			!channel.postingEnabled
		) {
			throw errors.channelUnavailable();
		}

		const message = await ctx.data.messages.create({
			input: {
				channelId: channel.id,
				companyId: ctx.tenant.id,
				createdBy: ctx.principal.id,
				title,
				slug,
				body: input.body,
				createdAt: ctx.operationTime,
				updatedAt: ctx.operationTime,
			},
			select: {
				id: true,
				channelId: true,
				title: true,
				slug: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		await ctx.data.messageAudits.create({
			input: {
				messageId: message.id,
				kind: "created",
				principalId: ctx.principal.id,
				occurredAt: ctx.operationTime,
			},
			select: { id: true },
		});

		await ctx.dispatch["messages.created"]({ messageId: message.id });
		return message;
	},
	network: true,
});
```

All application-specific write logic is next to the Resource that owns the
transaction. `ctx.data.channels.get`, both inserts, and the dispatch-intent
write join that transaction. If normalization, validation, either insert, or
dispatch throws, no Message, audit, or Reaction intent commits. The Runtime
encodes success only after commit.

The callback types have visible sources:

- `input` comes from the local `createMessageInput` codec;
- `errors` comes from the local literal error map;
- `ctx` is the concrete generated application context narrowed to Mutation
  mode;
- each Collection member and its `key`, `input`, `select`, and result come from
  the generated App Contract; and
- `ctx.dispatch["messages.created"]` comes from the exact Reaction Definition.

The weakness is repetition for mundane CRUD. Every simple Collection author
should not hand-write the same Tenant, Principal, and `updatedAt` assignments.
Pure normalizers are also ordinary functions in this variant, so the compiler
cannot explain them beyond their Origin or prove them deterministic. The
variant is nevertheless the strongest fallback: it uses TypeScript for unusual
business logic instead of growing a second language.

## Comparison

| Criterion                         | A: constrained hooks                | B: closed programs                 | C: named Mutation                              |
| --------------------------------- | ----------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Familiar to v3 authors            | highest                             | medium                             | medium                                         |
| Happy-path boilerplate            | low                                 | lowest while the grammar fits      | moderate                                       |
| Visible transaction owner         | obscured by Collection lifecycle    | generated Mutation member          | explicit named Mutation                        |
| Compiler explainability           | callback Origins and phase metadata | exact structural program           | exact calls plus opaque ordinary TypeScript    |
| Cross-Collection flexibility      | high, but ambient hook behavior     | low until the DSL grows            | full TypeScript                                |
| Hidden behavior on nested writes  | high                                | medium                             | low                                            |
| Retry reasoning                   | hard for arbitrary callbacks        | strongest                          | explicit but application-owned                 |
| Risk of a second language         | low                                 | highest                            | none                                           |
| Risk of restoring the v3 hook bag | highest                             | medium                             | lowest                                         |
| Interface depth                   | shallow phase catalogue             | deep only for bounded common cases | deep generated `ctx`, ordinary TS for the rest |

Variant A preserves source familiarity but imports too much invisible lifecycle
semantics. Variant B is excellent for a genuinely closed common case but becomes
a Mutation DSL if asked to model application workflows. Variant C provides the
best ownership and escape hatch, but needs a small declarative layer so ordinary
CRUD does not become repetitive.

## Recommended KISS beta layer: a B/C hybrid

The first usable layer should have four concepts, not one universal lifecycle
bag.

### 1. Closed Field-local normalization

Allow a small closed transform list when an Operation reuses a Collection Field
as public input. `trim`, bounded Unicode normalization, case folding, and other
accepted transforms have canonical semantics. They run after the Mutation
transaction opens and before candidate construction. They have no `ctx`, I/O,
clock, random, database, Service, or dispatch capability.

Illustrative syntax:

```ts
const createMessageInput = operation.fields(messages, {
	channelId: true,
	title: { normalize: [operation.text.trim()] },
	body: true,
});
```

This preserves the useful Field-input-hook job without publishing arbitrary
Field callback execution. The Collection Field remains the codec and bound
source; the Operation owns whether that Field is accepted and normalized.

If the word `hooks` is important for familiarity, this is the only safe beta
meaning it may have:

```ts
title: {
	hooks: { normalize: [operation.text.trim()] },
}
```

`hooks.normalize` would be syntactic grouping only. It would not accept an
arbitrary function or receive application context. The shorter `normalize`
member is clearer and should be preferred.

### 2. Closed server assignments for ordinary Collection operations

Keep the candidate `values` member already present in the Operation Set design:

```ts
create: {
	input: ["channelId", "title", "body"],
	values: ({ principal, tenant, operationTime }) => ({
		companyId: mutation.overwrite(tenant.id),
		createdBy: mutation.overwrite(principal.id),
		createdAt: mutation.overwrite(operationTime),
		updatedAt: mutation.overwrite(operationTime),
	}),
},
update: {
	input: ["title", "body"],
	values: ({ operationTime }) => ({
		updatedAt: mutation.overwrite(operationTime),
	}),
},
```

The callback builds a closed assignment program. It is not executable business
logic. Assignment targets come from the bound Collection; operands come from
the Operation input or immutable Execution; no database or Service is exposed.
This is the low-boilerplate path for generated CRUD.

Slug derivation may join this program only if the compiler accepts a small,
canonical text-transform grammar. Otherwise write the one-line `slugify`
calculation in a named Mutation. Do not add arbitrary `derive` hooks merely to
avoid that line.

### 3. One inline named Mutation for real transaction logic

The moment an operation must read a Channel, enforce a cross-Collection
invariant, insert an audit row, branch, or map an application error, use
Variant C. The Mutation is the visible owner of:

- the PostgreSQL transaction and stable `operationTime`;
- normalization and application validation ordering;
- Policy-enforced reads and writes;
- current/candidate state and lock recheck where applicable;
- transactional audit writes;
- durable dispatch intent;
- cancellation, deadline, declared errors, output, and commit.

The Mutation stays in the same feature file as the Reaction and Action if the
author prefers. Compiler discovery must not force one file per phase. A larger
application may extract ordinary TypeScript helpers; source organization is not
framework semantics.

There is no beta `beforeChange`, `afterChange`, `beforeDelete`, `afterDelete`,
`afterRead`, global hook chain, hook priority, or hook registry. These names
would hide transaction ownership and composition ordering. A future focused
vertical may add a narrowly proven transaction hook, but it must be equivalent
to code inside the owning Mutation and never run before that transaction.

### 4. Reaction after commit; Action for the external effect

`ctx.dispatch["messages.created"](...)` inserts durable intent in the Mutation
transaction. Awaiting it means “intent joined this transaction,” not “email was
sent.” The Reaction starts only from committed intent, receives a new physical
Execution per attempt, and is at least once. It rereads current authorized data
under its declared run-as strategy.

The email provider call crosses a named Action. Reaction retry reuses one stable
logical effect key. If the provider supports idempotency, duplicate attempts
converge on one provider effect. If it does not, the Action contract must expose
at-least-once or ambiguous outcome; QUESTPIE cannot manufacture exactly-once
external delivery.

`afterCommit` cannot remain a hook name for this job. It suggests an in-memory
callback attached to a completed transaction, which is exactly the lossy v3
mechanism. The different names communicate different ownership:

| Job                                       | Public concept                                 | Why                                 |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| capability-free local canonicalization    | `normalize` (optionally grouped under `hooks`) | no I/O or lifecycle authority       |
| server-owned Field assignment             | Mutation `values`                              | inspectable value provenance        |
| cross-Collection invariant and audit      | named Mutation handler                         | visible transaction owner           |
| work that must survive commit and restart | Reaction dispatch                              | durable at-least-once state         |
| email, payment, webhook, or provider call | Action                                         | outside automatic transaction retry |

## Exact lifecycle ordering for the recommended layer

The first proof should pin this order:

1. resolve the Mutation Resource and immutable Execution;
2. structurally bound and decode untrusted input without executing user code;
3. open the Mutation-owned transaction and freeze `operationTime`;
4. evaluate closed Field-local normalizers;
5. enforce caller-supplied Field authority;
6. apply schema defaults, then `setIfMissing`, then `overwrite` assignments;
7. validate the complete candidate and enforce candidate Policy;
8. run the inline Mutation handler's Policy-aware reads and writes;
9. write transactional audit and typed dispatch intent;
10. validate the result and apply output Field authority;
11. commit once, then encode successful completion;
12. independently lease the committed Reaction intent;
13. create a fresh Reaction Execution and recheck current Policy;
14. call the external Action with a stable logical effect key;
15. persist attempt success, retry schedule, terminal failure, or ambiguity.

The runtime must not automatically retry an arbitrary named Mutation handler in
the first layer until duplicate call identity, response loss, Service safety,
and replayability are proven. Reaction attempts are explicitly retryable and
at-least-once. An external Action is not wrapped in the business transaction.

## What remains open for focused proof

This note recommends ownership and a beta-size interface, not accepted syntax.
The next proof must close:

- whether closed normalization belongs on `operation.fields`, the Collection
  Operation Set, or a separate reusable input codec without changing accepted
  foundational Field bytes;
- exact canonical text normalization and slug rules;
- whether operation decoding or Field authority wins when a supplied value is
  both malformed and forbidden;
- create/update/delete candidate construction and lock/recheck ordering;
- the generated `ctx` types for Mutation, Reaction, and Action modes;
- Reaction run-as and Context reconstruction, especially after membership
  revocation;
- dispatch/run/attempt/effect identities and retry bounds;
- Action idempotency and ambiguous-result declarations;
- output-codec failure after database commit; and
- TypeScript hover, negative fixtures, declarations, and instantiation budget.

## Acceptance position

Adopt the B/C hybrid as the next prototype target. Reject Variant A as the beta
default, but preserve its vocabulary lesson: authors understand “normalize” and
“validate,” while generic “before” and “after” names conceal too much.

The deletion test supports the hybrid. If `values` and closed normalization
were removed, repetitive safe assignment and canonicalization would reappear in
every ordinary CRUD Mutation. They earn a small structural interface. If the
general lifecycle Resource were removed, its application-specific branches,
queries, audit and dispatch simply return to one ordinary TypeScript handler
with a clearer transaction owner. It does not earn its large interface.
