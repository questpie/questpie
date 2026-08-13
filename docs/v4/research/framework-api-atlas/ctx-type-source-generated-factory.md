# Generated application-specialized Definition factories

- Status: design and TypeScript feasibility evidence; no acceptance or public
  API authority
- Date: 2026-08-12
- Scope: the visible exact type source for executable Definition handlers
- Prototype: `docs/v4/prototypes/ctx-type-source-generated/`
- Authority baseline: `SPEC.md` sections 5-7, ADR-0007, and the current
  compiler-realization and design-fiction workbench pages

## Finding

Use application-specialized named Definition factories from the existing
generated `#questpie/app` surface:

```ts
import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
} from "#questpie/app";
import { durable, operation, policy } from "questpie";
```

This is the smallest visible type source that gives stock TypeScript the exact
application `ctx` without an ambient registry, a manually enumerated data map,
a central application registry, or a whole-application generic at every
Definition.

`#questpie/app` is already the generated exact application authority in
`SPEC.md`. Adding the specialized factories makes that authority visible at
the callback site. A separate `#questpie/define` alias would make the compiler
boundary slightly more obvious, but it would introduce another concept and
import path without changing the cycle, freshness, or evaluator problem.

This recommendation requires one narrow amendment to ADR-0007's current rule:
the Controlled Structural Evaluator may resolve an allowlist of generated
Definition-factory value exports from the compiler's **current virtual**
`#questpie/app` module. It must not evaluate the emitted server application
module from disk. A value import of `createApp`, a generated runtime binding,
or any other `#questpie/app` member from the structural graph remains an error.

The TypeScript prototype proves the contextual-typing half of this design. It
does not yet prove the compiler's virtual-module production, multi-round output
resolution, source slicing, or first-sync diagnostics. Those remain explicit
focused proof gates.

## Complete end-application surface

The developer writes ordinary cohesive Definitions. The generated import is
the only application-wide type source:

```ts
import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
} from "#questpie/app";
import { durable, operation, policy } from "questpie";

const companyInput = operation.object({
	companyId: operation.uuid(),
});

export const companySummary = defineQuery({
	name: "companies.summary",
	input: companyInput,
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		const company = await ctx.data.companies.get({
			key: { id: input.companyId },
			select: { id: true, name: true },
		});
		return company === null ? null : { name: company.name };
	},
	network: true,
});

export const renameMessage = defineMutation({
	name: "messages.rename",
	input: operation.object({
		id: operation.uuid(),
		body: operation.text({ maximumLength: 20_000 }),
	}),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		const message = await ctx.data.messages.update({
			key: { id: input.id },
			patch: { body: input.body, updatedAt: ctx.operationTime },
			select: { id: true, body: true, updatedAt: true },
		});

		if (message !== null) {
			await ctx.dispatch.messageRenamed({ messageId: message.id });
		}

		return message;
	},
	network: true,
});

export const sendDelivery = defineAction({
	name: "delivery.send",
	input: operation.object({
		body: operation.text(),
		effectKey: operation.text(),
	}),
	policy: policy.authenticated(),
	handler: async ({ input, ctx }) => {
		ctx.signal.throwIfAborted();
		return provider.send(input, { signal: ctx.signal });
	},
});

export const messageRenamed = defineReaction({
	name: "messageRenamed",
	input: operation.object({ messageId: operation.uuid() }),
	runAs: durable.caller({ whenDenied: "fail" }),
	handler: async ({ input, ctx, run }) => {
		const delivery = await ctx.queries["messages.deliveryView"](input);
		if (delivery === null) return { kind: "unavailable" as const };

		const sent = await ctx.actions["delivery.send"]({
			...delivery,
			effectKey: run.effect("deliver"),
		});
		return { kind: "sent" as const, providerId: sent.providerId };
	},
});

export const companyDigest = defineJob({
	name: "companyDigest",
	input: companyInput,
	runAs: durable.service({
		principal: digestWorker,
		context: ({ input }) => ({ companyId: input.companyId }),
	}),
	handler: async ({ input, ctx }) => {
		const summary = await ctx.queries["companies.summary"](input);
		return { title: summary?.name ?? "Unavailable" };
	},
});

export const deliveryWebhook = defineRoute({
	name: "delivery.webhook",
	method: "POST",
	path: "/webhooks/delivery",
	policy: policy.public(),
	handler: async ({ request, ctx }) => {
		const event = await verifyProviderRequest(request);

		await ctx.execution(
			{
				principal: deliveryPrincipal,
				context: { companyId: event.companyId },
			},
			({ mutations }) =>
				mutations["delivery.recordEvent"]({ eventId: event.id }),
		);

		return new Response(null, { status: 204 });
	},
});
```

The exact mode-specific members come from the generated factory type:

| Handler  | Exact generated `ctx` surface                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| Query    | immutable Execution facts, Policy-enforced reads, named Queries, signal/deadline, observation              |
| Mutation | immutable facts, transactional reads/writes, named Queries, operation time, transactional dispatch         |
| Reaction | fresh run-as facts, reads, named Queries/Mutations/Actions, durable run/attempt operands                   |
| Job      | the same fresh durable Execution surface plus Job-specific dispatch/schedule/result semantics              |
| Action   | facts, signal/deadline, named Operations; no Collection data, transaction, or automatic retry              |
| Route    | raw Request/Response protocol facts and explicit root `ctx.execution`; no implicit application Tenant/data |

The generated type is an affordance, not an authorization boundary. Runtime
Policy, operation mode, Transaction ownership, and Authority still enforce the
same contract when JavaScript is untyped or hostile.

## Why named generated imports win

| Candidate                                                | DX                                                                              | Exact stock-editor `ctx` | Composition and cycle cost                                 | Decision                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `import { defineQuery } from "#questpie/app"`            | one obvious application-specific import                                         | yes after sync           | needs one compiler-owned virtual-module exception          | recommended                                                                  |
| `import { defineQuery } from "#questpie/define"`         | precise name, but another generated concept                                     | yes after sync           | same virtual/current-draft problem                         | valid fallback only if the evaluator cannot safely isolate named app exports |
| `const { defineQuery } = app`                            | suggests a central runtime object and forces authors to move it through modules | yes                      | invites registry/import cycles and contradicts discovery   | reject                                                                       |
| `defineQuery<AppContract>(...)`                          | repeated whole-app generic and easy wrong/stale import                          | yes                      | leaks compiler plumbing into every Definition              | reject                                                                       |
| ambient `QuestpieApp` declaration merging                | superficially short                                                             | yes                      | global collision, package ambiguity, rejected by `SPEC.md` | reject                                                                       |
| language-service-only virtual typing                     | no source ceremony                                                              | editor-plugin dependent  | stock `tsc` and other editors disagree                     | reject                                                                       |
| broad library `defineQuery` with `ctx: any`/base context | short                                                                           | no                       | hides failure until Runtime                                | stop condition                                                               |

The recommended code tells a developer and an agent exactly why
`ctx.data.companies` autocompletes: the factory is imported from the concrete
generated application contract. There is no invisible global registration to
remember.

## The generated module is a typed factory binding, not a registry

Conceptually, the compiler emits this public shape:

```ts
import { __definitionFactories } from "questpie/internal/definition";
import type {
	ActionFactory,
	JobFactory,
	MutationFactory,
	QueryFactory,
	ReactionFactory,
	RouteFactory,
} from "questpie/internal/types";

interface CurrentAppContract {
	// Concrete generated Collection, Operation, durable, Service, Context,
	// error, and exposure maps. No broad string index.
}

export const defineQuery: QueryFactory<CurrentAppContract> =
	__definitionFactories.defineQuery;
export const defineMutation: MutationFactory<CurrentAppContract> =
	__definitionFactories.defineMutation;
export const defineReaction: ReactionFactory<CurrentAppContract> =
	__definitionFactories.defineReaction;
export const defineJob: JobFactory<CurrentAppContract> =
	__definitionFactories.defineJob;
export const defineAction: ActionFactory<CurrentAppContract> =
	__definitionFactories.defineAction;
export const defineRoute: RouteFactory<CurrentAppContract> =
	__definitionFactories.defineRoute;
```

The runtime factory values are framework-owned closed constructors. The module
does not contain discovered Definitions, executable handlers, a name-to-handler
table, or mutable application state. Discovery still finds direct exported
branded Definitions below the source root and accepted Package inventory.

Generated Collection row, operation input/output, and other values reachable
from exported Definition declarations must themselves be exported under stable
generated names. The prototype initially kept `Message`, `Company`, and
`AuditEvent` private. `--declaration` then failed with `TS4023` because an
exported inferred Definition result referred to an unnameable generated type.
Exporting the concrete generated value types fixes declaration emit without
widening them.

## Bootstrap and first sync

There are two consumers of `#questpie/app`, and they must not be confused:

1. the compiler uses an in-memory virtual module derived from the **current**
   normalized draft;
2. stock editors and direct TypeScript commands read the last atomically
   published `.questpie/generated/app.ts`.

The first synchronization is therefore:

```text
questpie init
  -> writes package import maps, but no fake broad App Contract

questpie sync/check/dev
  -> discover source and Package roots
  -> expose compiler-owned Definition factory values to structural evaluation
  -> collect current Resource/input/data skeletons
  -> construct current virtual #questpie/app declarations
  -> typecheck executable slots and materialize inferred outputs
  -> emit exact app/client declarations and private runtime bindings
  -> typecheck the complete current build
  -> atomically publish .questpie/generated
```

Before the first successful sync, stock TypeScript reports that
`#questpie/app` is missing and the framework diagnostic gives the exact
recovery `bunx questpie sync`. It must not emit an empty, `any`-typed, or broad
stub merely to remove the red underline. A fake stub would allow invalid code
or produce misleading negative completions precisely when the developer is
learning the API.

`questpie dev` owns continuous regeneration after the first sync. Atomic
replacement prevents editors from observing a half-written generated tree.
The generated directory remains recoverable output, not committed source.

## Stale generated types and `tsc`

The last on-disk generated module can be temporarily stale between a source
edit and the next successful compiler pass. Stock `tsc` has no general way to
hash arbitrary source, Package, lockfile, configuration, and compiler inputs
and compare them with the declaration that it imported. Claiming otherwise
would require an editor/TypeScript plugin or committed ambient state.

The contract should be explicit:

- `questpie check`, `questpie build`, CI, and production packaging ignore the
  semantic authority of compile N-1 output; they build the current virtual
  contract and verify the current Build Input;
- the project `check` script runs QUESTPIE check before or as the owner of the
  final TypeScript check; raw `tsc` alone is not a freshness proof;
- `questpie dev` keeps editor output current and reports an Origin-linked sync
  failure while retaining the last complete generated tree;
- Runtime Build pairing refuses a Manifest/App Contract/binding mismatch;
- a direct raw `tsc` may show temporary stale completion or even pass code that
  `questpie check` subsequently rejects, so docs must never call raw `tsc` the
  authoritative application build.

This preserves ordinary stock editor behavior without making stale generated
files the compiler's truth.

## Structural evaluation and inline handler splitting

The compiler recognizes only built-in executable members. For a Query, the
source:

```ts
export const summary = defineQuery({
	name: "companies.summary",
	input: companyInput,
	handler: async ({ input, ctx }) => {
		return ctx.data.companies.get({ key: { id: input.companyId } });
	},
});
```

becomes two private graphs:

```text
structural graph
  generated defineQuery binding -> compiler-owned pure factory
  { name, input, handler: slot(query:companies.summary, handler) }

runtime graph
  inline handler + its lexical runtime dependencies
  -> private static binding for query:companies.summary/handler
```

The evaluator never loads the emitted `#questpie/app` server module. Its module
resolver replaces only allowlisted generated factory bindings with the matching
framework/compiler implementation and supplies current virtual declarations to
the TypeChecker. Importing `createApp` or generated runtime tables into the
structural slice fails before evaluation.

Handler-only imports are pruned with the handler. A shared value reachable from
both graphs must obey structural determinism. An impure module initializer is
not executed at compile time merely because the inline handler closes over one
of its exports.

There is still one authored Definition, one Owner, and one runtime slot. The
generated factory import does not add a handler export, binding registry, file
pair, or runtime discovery pass.

## Local input and output inference

The specialized factory keeps leaf inference local:

```ts
interface QueryFactory<App> {
	<Name extends string, InputCodec, Output>(definition: {
		name: Name;
		input: InputCodec;
		handler(args: {
			input: Decode<InputCodec>;
			ctx: QueryContext<App>;
		}): Output;
	}): QueryDefinition<Name, Decode<InputCodec>, Awaited<Output>>;
}
```

`input` comes from the local codec. `ctx` comes from the generated application
factory. `Output` remains the awaited local handler return and is then checked
against the closed wire algebra. An optional explicit `output` stays a contract
pin, not required repetition.

The compiler cannot obtain current outputs by trusting the previous generated
module. A focused compiler proof should use current-draft rounds:

1. collect all Resource identities, modes, local inputs, explicit output pins,
   and exact data/durable/service maps;
2. give unresolved Operation outputs private compiler placeholders in the
   virtual contract;
3. typecheck handlers whose outputs can resolve from local code, generated
   data, pinned Operations, and already resolved Operations;
4. materialize their codecs and regenerate the virtual Operation map;
5. repeat until stable;
6. if an unresolved strongly connected output dependency remains, require an
   explicit output pin at the cycle boundary and report every involved
   Definition Origin.

The rounds are a compiler implementation candidate, not proven authority. The
acceptance property is simpler: common acyclic nested Operations infer without
an output declaration; genuinely recursive output contracts cannot become
`any`, `unknown`, or compile-N-minus-one types and must be pinned explicitly.

## Imported handlers

Inline is the zero-boilerplate happy path. TypeScript does not retroactively
contextually type a separately declared function merely because it is later
placed in a Definition. A large imported handler therefore needs one explicit
generated handler type, but no binding convention:

```ts
// company-summary-handler.ts
import type { QueryHandler } from "#questpie/app";
import { companyInput } from "./company-summary";

export const companySummaryHandler = (async ({ input, ctx }) => {
	const company = await ctx.data.companies.get({
		key: { id: input.companyId },
		select: { name: true },
	});
	return company === null ? null : { name: company.name };
}) satisfies QueryHandler<typeof companyInput>;
```

```ts
// company-summary.ts
import { defineQuery } from "#questpie/app";
import { companySummaryHandler } from "./company-summary-handler";

export const companySummary = defineQuery({
	name: "companies.summary",
	input: companyInput,
	handler: companySummaryHandler,
});
```

`satisfies` gives the function exact input and `ctx` while preserving its
locally inferred return type. The import is ordinary TypeScript organization.
The compiler still binds the handler from the Definition member and does not
pair the two files or discover the handler export independently.

If importing the input back from the Definition module would create a source
cycle, place the codec in a third ordinary module. This is a normal JavaScript
cycle rule, not QUESTPIE composition.

## Package authoring

A reusable Package cannot import the consuming application's
`#questpie/app`. That would make the Package's handler surface depend on an
unknown host, allow accidental host-only calls, and make publisher declaration
emit non-reproducible.

The package workspace instead has its own generated alias:

```json
{
	"imports": {
		"#questpie/package": "./.questpie/generated/package.ts"
	}
}
```

```ts
import { defineQuery } from "#questpie/package";
import { operation } from "questpie";

export const auditEvent = defineQuery({
	name: "acme.audit.event",
	input: operation.object({ id: operation.uuid() }),
	handler: ({ input, ctx }) =>
		ctx.data.auditEvents.get({ key: { id: input.id } }),
});
```

The Package contract contains only Resources in its accepted closed
composition inventory and exact imported typed Resource references. A Package
handler cannot see an arbitrary host `messages` Collection. Package publication
checks and emits this contract and its declaration names; consuming application
compilation normalizes the Package Definitions under ordinary identity,
collision, artifact, and runtime-binding rules. The host Runtime may carry a
larger concrete context, but Package source remains typed against its stable
published projection.

If a Package needs an application-provided Resource, it needs a separately
accepted explicit typed-reference composition seam. It must not gain host
access through ambient declaration merging, a string lookup, or consumer
retyping. The current accepted model has no general Package composition
factory, so this report does not invent one.

## Import graph and cycle rules

The public and private graph must remain one-way:

```text
application structural source
  -> current virtual #questpie/app factory declarations
  -> compiler-owned closed factory implementation during evaluation

application runtime handler slices
  -> current virtual #questpie/app types
  -> ordinary handler dependencies

generated public app declarations
  -> concrete emitted named types
  -X-> no typeof-import of application Definitions

generated private runtime bindings
  -> #questpie/source/* handler slices
  -> matched Runtime Build
```

The generated public module must emit concrete named declarations. Building it
from `typeof import("#questpie/source/...")` would form type cycles when those
sources import the specialized factories and would make relocation and Package
declaration behavior harder to explain. Source paths belong in the Origin Map
and private static bindings, not in public generated type identity.

Application source also must not import generated private files. Only public
generated types/factories and the server/client entry surfaces are stable.

## Prototype evidence

The isolated prototype contains:

- generated application-specialized Query, Mutation, Reaction, Job, Action,
  and Route factories;
- exact mode-specific data, Operation, dispatch, and direct Execution maps;
- inline and imported handlers with inferred output;
- negative TypeScript assertions for a missing Collection, missing dispatch,
  Query write, and Action data access;
- a Package-local specialized contract that rejects a host-only Collection;
- declaration emit proving every inferred exported type is nameable.

Command:

```bash
bunx tsc \
  -p docs/v4/prototypes/ctx-type-source-generated/tsconfig.json \
  --extendedDiagnostics
```

Measured on the proof host with TypeScript 5.9.2:

| Measurement                |                          Result |
| -------------------------- | ------------------------------: |
| TypeScript source files    | 69 including standard libraries |
| Prototype TypeScript lines |                             472 |
| Types                      |                          17,602 |
| Instantiations             |                           7,091 |
| Memory                     |                     119,560 KiB |
| Check time                 |                          0.45 s |
| Total time                 |                          0.67 s |
| Diagnostics                |                               0 |

Declaration-only emit also passed after generated row types were exported. The
emitted `application.d.ts` preserves exact inferred Query, Mutation, Action,
Reaction, Job, and Route inputs/outputs. All emitted prototype declarations
together measured 11,182 bytes.

These measurements show the specialized factory itself is cheap in a small
fixture. They do not replace the compiler-realization map's connected
six-Collection, language-service latency, scaling, generated-size, and bundle
budgets.

## Required focused proof

The candidate is ready for a focused compiler prototype only if it proves all
of the following together:

1. the documented `#questpie/app` import compiles verbatim under stock
   TypeScript after sync and provides positive/negative completion fixtures;
2. first sync succeeds using only the current virtual module when no generated
   directory exists;
3. `questpie check` ignores deliberately stale on-disk declarations and rejects
   code invalid under the current draft;
4. structural evaluation resolves only allowlisted factory values and never
   evaluates generated Runtime code or handler-only imports;
5. inline and imported handler slicing preserve deterministic structural bytes;
6. local inferred output, optional pinned output, acyclic nested calls, and an
   unresolved recursive output cycle have stable expected results;
7. generated declarations use nameable concrete types and contain no source
   `typeof import` cycle, broad string index, `any`, or ambient registry;
8. application and Package factory contracts remain separate and Package code
   cannot see host-only Resources;
9. body-only changes affect Runtime Build bytes but not Operation codec or
   generated public types; return-shape changes affect the exact expected
   artifacts;
10. `questpie dev`, check/build, atomic generated replacement, Runtime Build
    pairing, editor refresh, and failure recovery are demonstrated;
11. TypeScript instantiation, language-service hover/completion latency,
    declaration bytes, linear scaling, and bundle deltas pass the existing
    candidate budgets.

## Decision boundary

Adopt the generated specialized factory direction if the focused proof passes.
It gives the developer the smallest honest API and makes the exact type source
explainable in one sentence: **this Definition factory comes from this compiled
application**.

Fall back to a dedicated `#questpie/define` generated alias only if a prototype
shows that named allowlisted factory resolution cannot be isolated safely from
the rest of `#questpie/app`. Do not fall back to `app.defineQuery`, an ambient
registry, compile-N-minus-one authority, a per-handler application generic, or
a broad `ctx`.
