# Explicit type sources for generated handler `ctx`

- Status: design evidence; no acceptance or implementation authority
- Date: 2026-08-12
- Scope: stock-TypeScript contextual typing for Query, Mutation, Reaction, Job,
  Action, and Route handlers
- Prototype: `docs/v4/prototypes/ctx-type-source-explicit/`
- Authority baseline: `SPEC.md`, ADR-0007, and the accepted generated-output
  rules in `docs/v4/definition-composition.md`

## Finding

The current design-fiction spelling cannot provide an exact application `ctx`
in stock TypeScript:

```ts
import { defineQuery } from "questpie";

export const overview = defineQuery({
	name: "channels.overview",
	handler: ({ ctx }) => ctx.data.channels.get(/* ... */),
});
```

The library import has no type edge to this application's generated App
Contract. The compiler can construct a virtual type for its own Program, but a
normal editor and a normal external `tsc` cannot infer that invisible edge.

The smallest design that obeys the existing authority is a **type-only import
of the generated `AppContract` plus a pure two-stage Definition binder**:

```ts title="src/questpie.ts"
import type { AppContract } from "#questpie/app";
import { bindDefinitions } from "questpie";

export const define = bindDefinitions<AppContract>();
```

```ts title="src/features/channel-overview.ts"
import { operation } from "questpie";
import { define } from "../questpie";

export const channelOverview = define.query({
	name: "channels.overview",
	input: { channelId: operation.uuid() },
	handler: async ({ input, ctx }) => {
		const channel = await ctx.data.channels.get({
			key: { id: input.channelId },
			select: { id: true, name: true },
		});

		return { channel };
	},
	network: true,
});
```

`bindDefinitions` is a type binder, not an application registry. It receives no
Resource values, performs no discovery, owns no identity, and stores no runtime
Application. Its returned methods are the ordinary closed Definition factories
with the exact generated handler context already fixed. Deleting the binder
would repeat the App type argument at every Definition, so it earns a small but
real amount of depth.

This direction preserves leaf-local input, error, and output inference because
the application type is fixed in the outer call and each method's Definition
generics remain free for the inner call.

The result is conditional. The prototype proves the TypeScript mechanism, but
does not solve compiler ordering for mutually dependent inferred Operation
outputs. That circularity needs a separate compiler proof before this spelling
can become authority.

## Requirements

The visible type source must satisfy all of these constraints:

1. Stock TypeScript language service and `tsc` provide exact positive and
   negative members after the generated contract exists.
2. No ambient declaration merge, global registry, TypeScript plugin, virtual-
   only editor transform, `any`, `unknown`, or broad string Resource map is
   required.
3. Structural source does not value-import generated output. ADR-0007 permits
   only a type-only `#questpie/app` edge.
4. One inline handler remains next to its local Definition contract. There is
   no paired handler file, binding registry, or repeated Resource name.
5. Input, declared errors, and awaited output remain locally inferred.
6. Query, Mutation, Reaction, Job, Action, and Route receive different exact
   mode contexts.
7. A Package can publish fixed Definition values without capturing its host
   application's generated contract.
8. `questpie sync` uses the current virtual contract, never compile N-1 disk
   types. A clean external `tsc` before first sync reports the accepted exact
   `questpie sync` recovery.
9. Generated declarations and TypeScript instantiations grow linearly.

## Design A: repeat an explicit App type at every Definition

This design changes only the factory call:

```ts
import type { AppContract } from "#questpie/app";
import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
	operation,
} from "questpie";

export const message = defineQuery<AppContract>()({
	name: "messages.get",
	input: { id: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
});

export const submit = defineMutation<AppContract>()({
	name: "messages.submit",
	input: { body: operation.text() },
	handler: async ({ input, ctx }) =>
		ctx.data.messages.create({
			input: { body: input.body },
			select: { id: true, body: true },
		}),
});

export const submitted = defineReaction<AppContract>()({
	name: "messages.submitted",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx, run }) =>
		ctx.actions["delivery.send"]({
			messageId: input.messageId,
			effectKey: run.effect("send"),
		}),
});

export const rebuild = defineJob<AppContract>()({
	name: "messages.rebuild",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		}),
});

export const send = defineAction<AppContract>()({
	name: "delivery.send",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.queries["messages.get"]({ id: input.messageId }),
});

export const webhook = defineRoute<AppContract>()({
	name: "delivery.webhook",
	handler: async ({ request, ctx }) => {
		const companyId = request.headers.get("x-company-id");
		if (companyId === null) return new Response(null, { status: 400 });
		await ctx.execution({ context: { companyId } }, ({ mutations }) =>
			mutations["messages.submit"]({ body: "received" }),
		);
		return new Response(null, { status: 204 });
	},
});
```

The two calls are necessary. TypeScript does not provide ergonomic partial
generic application in one call: fixing `AppContract` and still inferring the
local input/output generics requires currying or defaults that weaken
inference. `defineQuery<AppContract>()({...})` makes that staging honest.

This design has the smallest framework change and the clearest type edge. It
also repeats an application-wide concern on every leaf. Six factories expose
six visually noisy generic calls, and a rename of the generated contract type
touches every Definition module. It is a good proof primitive and a mediocre
finished developer interface.

## Design B: bind once, then author leaf Definitions

The leading design performs the same generic application once in ordinary
source:

```ts title="src/questpie.ts"
import type { AppContract } from "#questpie/app";
import { bindDefinitions } from "questpie";

export const define = bindDefinitions<AppContract>();
```

Every Resource kind remains a local one-object Definition:

```ts
import { operation } from "questpie";
import { define } from "../questpie";

export const message = define.query({
	name: "messages.get",
	input: { id: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
});

export const submit = define.mutation({
	name: "messages.submit",
	input: { body: operation.text() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.create({
			input: { body: input.body },
			select: { id: true, body: true },
		}),
});

export const submitted = define.reaction({
	name: "messages.submitted",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx, run }) =>
		ctx.actions["delivery.send"]({
			messageId: input.messageId,
			effectKey: run.effect("send"),
		}),
});

export const rebuild = define.job({
	name: "messages.rebuild",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		}),
});

export const send = define.action({
	name: "delivery.send",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.queries["messages.get"]({ id: input.messageId }),
});

export const webhook = define.route({
	name: "delivery.webhook",
	handler: async ({ request, ctx }) => {
		const companyId = request.headers.get("x-company-id");
		if (companyId === null) return new Response(null, { status: 400 });
		await ctx.execution({ context: { companyId } }, ({ mutations }) =>
			mutations["messages.submit"]({ body: "received" }),
		);
		return new Response(null, { status: 204 });
	},
});
```

The helper can live beside a feature instead of at `src/questpie.ts`; its path
has no compiler semantics. One application-level helper is simply the shortest
normal form. It does not list Definitions and importing it does not activate a
Package. Exported branded Definition values remain the only discovery roots.

The interface is deeper than Design A: one explicit type edge buys exact mode
contexts for every factory without asking every Resource to repeat it. It also
keeps the application-specific fact in application source instead of modifying
the global `questpie` module.

The cost is one new public word, `bindDefinitions`, and a small vocabulary
change from `defineQuery` to `define.query`. If retaining the current noun
spellings matters more, the helper can export aliases once:

```ts
const bound = bindDefinitions<AppContract>();

export const defineQuery = bound.query;
export const defineMutation = bound.mutation;
export const defineReaction = bound.reaction;
export const defineJob = bound.job;
export const defineAction = bound.action;
export const defineRoute = bound.route;
```

That variation preserves every Definition body in the design-fiction guide;
only the factory import moves from `"questpie"` to the local binder module.

## Design C: import generated specialized factories

The lowest-boilerplate form is a generated authoring module:

```ts
import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
} from "#questpie/definitions";
import { operation } from "questpie";

export const message = defineQuery({
	name: "messages.get",
	input: { id: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
});

export const submit = defineMutation({
	name: "messages.submit",
	input: { body: operation.text() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.create({
			input: { body: input.body },
			select: { id: true, body: true },
		}),
});

export const submitted = defineReaction({
	name: "messages.submitted",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx, run }) =>
		ctx.actions["delivery.send"]({
			messageId: input.messageId,
			effectKey: run.effect("send"),
		}),
});

export const rebuild = defineJob({
	name: "messages.rebuild",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.messageId },
			select: { id: true, body: true },
		}),
});

export const send = defineAction({
	name: "delivery.send",
	input: { messageId: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.queries["messages.get"]({ id: input.messageId }),
});

export const webhook = defineRoute({
	name: "delivery.webhook",
	handler: async ({ request, ctx }) => {
		const companyId = request.headers.get("x-company-id");
		if (companyId === null) return new Response(null, { status: 400 });
		await ctx.execution({ context: { companyId } }, ({ mutations }) =>
			mutations["messages.submit"]({ body: "received" }),
		);
		return new Response(null, { status: 204 });
	},
});
```

This looks closest to the current guide and gives the editor an explicit
generated import. It fails the accepted structural import rule. These are
runtime values imported from `.questpie/generated/**`, so controlled structural
evaluation now depends on derived output generated from the source that it is
trying to evaluate. Making the compiler intercept those imports would add a
special virtual runtime module, while an external `tsc` or Bun execution would
still see the disk copy.

That amendment buys only the removal of one ordinary source helper. It is not
worth reopening ADR-0007's one-way generated graph.

## Design D: use a generated `app` value as the factory

The most object-oriented spelling is also the most misleading:

```ts
import { app } from "#questpie/app";

export const message = app.query({
	/* inline handler */
});
export const submit = app.mutation({
	/* inline handler */
});
export const submitted = app.reaction({
	/* inline handler */
});
export const rebuild = app.job({
	/* inline handler */
});
export const send = app.action({
	/* inline handler */
});
export const webhook = app.route({
	/* inline handler */
});
```

It has the same generated value-import cycle as Design C. It also makes an
authoring factory look like the runtime Application returned by `createApp`,
suggests that Resource ownership flows through one central object, and gives
Packages no honest host-independent value to capture. Calling the value
`contract` instead of `app` removes the naming collision but not the cycle.

This design is rejected.

## Why a source-owned binder is not a registry

The leading binder has no collection of Definitions:

```ts
export const define = bindDefinitions<AppContract>();
```

It does not contain this rejected shape:

```ts
export const app = defineApp({
	collections: [companies, messages],
	queries: [channelOverview],
	mutations: [submitMessage],
});
```

The latter duplicates compiler discovery, makes import order and recursive
whole-application inference relevant, and turns one source object into an
ownership root. The former applies one erased type argument to stateless
factory functions. Resource Identity, Owner, Origin, collision detection, and
Package activation remain exactly where ADR-0007 puts them.

At runtime, `bindDefinitions<AppContract>()` can return one frozen framework
constant. The `AppContract` parameter is erased. The controlled evaluator sees
the same deterministic factory calls it already understands.

## Bootstrap, `sync`, and stale generated types

The binder uses the generated type edge already accepted for structural data
plans. It does not create a new freshness model.

### First application compile

1. `questpie init` installs the stable `#questpie/app` type path and creates no
   fake broad application type.
2. Before the first successful sync, stock external `tsc` cannot resolve the
   generated module and must report the exact `questpie sync` recovery.
3. `questpie sync` discovers the current structural skeleton, constructs the
   current virtual App Contract in memory, and resolves the type-only import
   against that contract.
4. It typechecks executable slices with the same current contract, emits the
   generated tree atomically, and then verifies a built consumer.
5. A normal stock editor and external `tsc` use the emitted declaration after
   that sync. `questpie dev` keeps it refreshed during ordinary editing.

This is already the documented two-step getting-started flow: define
Collections, run `questpie sync`, then import the exact generated contract for
structural data plans. The binder makes the same edge visible for handlers.

### What stock `tsc` can and cannot prove

Stock `tsc` proves the source against the generated file currently on disk. It
cannot compare that file's Build Input Digest with changed source by itself.
Therefore:

- `questpie check`, `questpie build`, CI, and deployment must reject a stale
  generated digest;
- `questpie dev` must regenerate after source changes;
- documentation must not claim that running bare `tsc` before sync proves
  freshness;
- a stale editor window can temporarily offer a removed Resource or omit a new
  one until sync completes, but stale output can never enter a successful
  QUESTPIE build.

This limitation is inherent in generated types without a language-service
plugin. Ambient merging would hide the type source, not remove the freshness
problem.

## The unresolved output-inference cycle

The explicit binder tells TypeScript where `ctx` comes from. It does not by
itself tell the compiler how to construct a current exact operation map whose
outputs are inferred from handlers that are being checked against that map.

The easy case is leaf-local:

```ts
export const message = define.query({
	name: "messages.get",
	handler: ({ ctx }) => ctx.data.messages.get(/* ... */),
});
```

Collection and Context types exist before Operation output materialization, so
the handler result can be inferred without its own generated client member.

The hard case is a same-compile Operation dependency:

```ts
export const digest = define.query({
	name: "reports.digest",
	handler: ({ ctx }) => ctx.queries["messages.get"]({ id }),
});
```

If `messages.get` is also new and has inferred output, its output must be known
before `reports.digest` receives an exact caller. Mutual calls form a real type
cycle.

The focused compiler proof must choose and measure one deterministic rule. The
leading candidate is:

1. collect all local structural input, error, mode, and optional output-pin
   skeletons;
2. infer leaf handler outputs in a dependency order;
3. permit exact same-build Operation calls only after their target contract is
   materialized; and
4. require an explicit output pin to break a strongly connected output cycle.

The compiler must derive those dependencies from supported exact calls and
issue an Origin-linked diagnostic for an unresolved cycle. It must not place
`unknown` in `ctx`, use compile N-1 output as truth, or silently widen a cyclic
caller. An alternative is to remove same-layer generated Operation maps from
handler contexts and use typed Definition references, but that would revise
the current design fiction and needs its own interface comparison.

Until this proof passes, the binder is a promising type-source answer, not a
complete executable-Operation contract.

## Package authoring

A fixed Package cannot bind its handlers to the activating application's
`AppContract`; that application does not exist when the Package is published.
It also cannot ask the application to call a composition factory, because
ADR-0007 currently accepts fixed Package Definition exports and defers Package
composition factories.

The compatible model is a narrow Package authoring contract produced while the
Package itself is built:

```ts
import type { AuditPackageContract } from "#questpie/package";
import { bindDefinitions } from "questpie";

const define = bindDefinitions<AuditPackageContract>();

export const auditEntry = define.query({
	name: "audit.entry",
	input: { id: operation.uuid() },
	handler: ({ input, ctx }) =>
		ctx.data.auditEntries.get({
			key: { id: input.id },
			select: { id: true, subjectId: true },
		}),
});
```

The Package contract contains only framework facts and exact Resources that
the Package owns or reaches through accepted typed dependencies. It is not a
partial host registry and cannot name arbitrary future host Collections,
Services, Context values, or Operations. Its emitted public Definition type
remains leaf-local: identity, input, output, errors, mode, and typed references.

On activation, the application compiler provides a wider concrete runtime
context only after it proves that every Package requirement resolves to the
same accepted Resource contract. Extra application members are harmless and
remain invisible to the already-checked Package handler. A Package that needs
host-specific behavior requires a future explicit typed Augmentation or Package
factory contract; it cannot obtain it by ambient merging.

The prototype's `package-definitions.ts` demonstrates this narrow-context
checking. The host-compatibility proof and published-package declaration
erasure remain compiler gates.

## Prototype result

The prototype models one explicit `AppContract`, the pure two-stage binder,
all six executable Resource kinds, mode-specific positive and negative
members, local input/output inference, and one narrow Package contract.

Command:

```bash
bunx tsc \
	-p docs/v4/prototypes/ctx-type-source-explicit/tsconfig.json \
	--extendedDiagnostics
```

Measured on the current repository toolchain, TypeScript 5.9.2:

```text
Files:                         67
Lines of TypeScript:          404
Types:                        883
Instantiations:              1409
Memory used:               68996K
Check time:                 0.07s
Total time:                 0.29s
```

The four TypeScript source files total 10,395 bytes. A second plain
`bunx tsc -p ... --pretty false` passed. The fixture verifies:

- exact Query read members and negative Query writes;
- exact Mutation writes and durable dispatch;
- exact Reaction and Job read/Action members;
- exact Action Operation callers and absence of `data`;
- exact Route nested Execution members;
- locally inferred Query and Mutation input/output types; and
- a Package-owned narrow handler context.

These numbers are a feasibility measurement, not the executable-Resource
budget. The prototype uses a handwritten generated contract and does not
measure compiler virtual-module creation, output dependency ordering, language-
service completion latency, emitted declaration bytes, or 1x-to-4x scaling.

## Comparison

Design A is technically honest and requires no new binder object, but repeats
the application type at every Resource. It is the simplest fallback if a
two-stage binder creates unexpected inference cost.

Design B has the best balance. One explicit type-only edge supplies every
exact context, the binder is a deep stateless module, normal Definition files
remain cohesive, and no accepted generated-import rule changes. It has one
small visible setup cost and one candidate naming decision.

Design C has the least per-project source, but requires generated runtime
imports in the structural graph and a compiler-only interception mechanism.
The saved helper does not justify that new seam.

Design D conflates authoring and Runtime Application values, creates the same
cycle, and is especially poor for fixed Packages.

## Recommendation and acceptance gates

Prototype Design B as the public candidate:

```ts
import type { AppContract } from "#questpie/app";
import { bindDefinitions } from "questpie";

export const define = bindDefinitions<AppContract>();
```

Do not project it into the API inventory or design-fiction guide yet. First
prove all of the following with Bun and stock TypeScript:

1. current virtual `AppContract` resolution during `sync` and exact on-disk
   editor types after sync;
2. first-sync recovery and stale-digest refusal without a placeholder type;
3. Query, Mutation, Reaction, Job, Action, Route, Context resolver, and later
   Workflow callback hovers plus negative members;
4. local inferred outputs, explicit pins, acyclic same-build Operation calls,
   and deterministic diagnostics for output cycles;
5. source slicing with no value import of generated output;
6. fixed Package build, published declaration, activation into a wider host
   contract, and rejection of undeclared host dependencies;
7. inline and imported handler parity;
8. 1x-to-4x linear type/declaration scaling and the existing operation budget;
9. unchanged Manifest/Data/Schema bytes for a binder-only refactor; and
10. one focused fresh Opus-medium contract review after every proof passes.

If the output-cycle proof requires `ctx: unknown`, compile N-1 types, a global
registry, or a TypeScript plugin, stop. Reconsider generated Operation calls in
handler contexts rather than weakening the exact-context guarantee.
