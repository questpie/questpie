# Executable Operation authoring and binding designs

- Status: design evidence; no v4 acceptance authority
- Scope: let an application author define one named Query or Mutation in one
  local declaration while the compiler keeps structural evaluation and
  executable code in separate internal graphs

## Start with the application interface

The normal application interface should be one Definition with one inline
handler. The exact Policy and codec spellings below are illustrative until
their focused contracts close, but the locality requirement is normative for
this design ticket.

```ts
// src/features/workspaces/dashboard.ts
export const workspaceDashboard = defineQuery({
  name: "workspace.dashboard",
  input: operation.object({
    workspaceId: operation.uuid(),
    statuses: operation.list(operation.text(), { maximumItems: 10 }),
  }),
  policy: workspaceDashboardPolicy,
  errors: {
    workspaceUnavailable: operation.error({ status: 404 }),
  },
  handler: async ({ input, ctx, errors }) => {
    const workspace = await ctx.data.workspaces.get({
      key: { id: input.workspaceId },
      select: { id: true, name: true },
    });
    if (workspace === null) throw errors.workspaceUnavailable();

    const membership = await ctx.data.memberships.get({
      key: {
        workspaceId: input.workspaceId,
        principalId: ctx.execution.principal.id,
      },
      select: { workspaceId: true, principalId: true, role: true },
    });
    if (membership === null) throw errors.workspaceUnavailable();

    const tasks = await ctx.data.run(taskPage, {
      workspaceId: input.workspaceId,
      statuses: input.statuses,
      first: 20,
      after: null,
    });

    return { workspace, tasks, membership };
  },
  network: true,
});
```

The generated client remains one typed call:

```ts
const dashboard = await client.queries["workspace.dashboard"]({
  workspaceId,
  statuses: ["open", "blocked"],
});
```

Every callback parameter above needs a concrete contextual type source:

| Callback value | Type source |
| --- | --- |
| `input` | the Operation's closed `input` codec |
| `ctx` | the current virtual generated App Contract promised by `SPEC.md` |
| `errors` | the Operation's literal declared-error map |
| awaited return | local TypeChecker inference, later validated against the closed output algebra |

The handler example is invalid if any member widens to `any`, `unknown`, broad
`string`, or a recursive whole-application authored generic. The executable
Operation proof must compile each documented end-app form verbatim, assert
unknown inputs/Collections/errors fail, inspect emitted declarations, and report
hover-shape plus TypeScript instantiation/check-time budgets.

A custom multi-Collection write has the same shape. The only semantic change is
that `defineMutation` owns one PostgreSQL transaction and its generated context
also exposes Policy-enforced writes:

```ts
export const moveTask = defineMutation({
  name: "tasks.move",
  input: moveTaskInput,
  policy: moveTaskPolicy,
  handler: async ({ input, ctx, errors }) => {
    const task = await ctx.data.tasks.update({
      key: input.key,
      data: input.patch,
      select: { id: true, status: true },
    });
    if (task === null) throw errors.taskUnavailable();
    await ctx.data.taskEvents.create({
      data: { taskId: task.id, kind: "moved" },
      select: { id: true },
    });
    return task;
  },
  network: true,
});
```

There is no required handler file, handler export, registry entry, route file,
or manually repeated Resource name. A developer may import a handler function
when it is genuinely large, but that is ordinary TypeScript organization, not
a framework protocol:

```ts
import { runDashboard } from "./run-dashboard";

export const workspaceDashboard = defineQuery({
  // structural contract
  handler: runDashboard,
});
```

The handler import still becomes the same compiler-owned runtime slot. Its file
path is Origin and build input, never Resource Identity.

## Why the earlier two-export recommendation was wrong

The first synthesis recommended a structural Definition plus a separately
exported Runtime Binding. That makes the compiler implementation easier, but it
projects an internal compiler concern onto every application author. It weakens
locality, duplicates the Qualified Resource Name, creates orphan and pairing
failure modes, and turns one business capability into two author-facing things
that must always change together.

By the deletion test, removing the separate binding interface does not move
application complexity elsewhere; it moves graph separation into the compiler,
where it can be implemented and verified once. The compiler is the deep module.
Its small interface should hide slicing, binding, codec generation, dependency
hashing, and bundling rather than require every application to model them.

Separate files remain useful as an optional code-organization choice. They are
not a semantic safety boundary: a path convention or explicit `handlerRef`
still needs compiler linking, hashing, diagnostics, and runtime binding.

## Historical reconciliation

ADR 0007 requires compile-time composition, deterministic artifacts, explicit
identity and ownership, and no runtime discovery or merge. It does **not**
require one file per Resource or a separate handler export. It explicitly lets
later Resource kinds add their own closed Definition contracts.

The earlier compiler model in
[`compiler-primitives-adversarial-review.md`](../compiler-primitives-adversarial-review.md)
already describes opaque runtime Environment Slots in one Definition source.
The compiler slices their transitive code and closures, evaluates only the
structural slice, and emits generated runtime bindings. This is the original
high-leverage interface direction.

The accepted composition chapter later made a narrower first-tracer cut: it
evaluates a candidate structural module as one complete ESM module and defers
statement-level slicing. It also says that a later executable-Resource vertical
must keep handler modules outside the structural evaluation graph. These facts
are compatible when “outside” is an internal compiled graph property rather
than an author-facing file-layout rule.

The Operations vertical therefore needs a narrow amendment and proof for one
closed executable slot. It must not reopen a generic compiler plugin, arbitrary
callback extraction, or runtime registry.

## Recommended compiler contract

`handler` is an executable slot owned by the Query or Mutation Definition:

1. One directly exported `defineQuery` or `defineMutation` call remains the
   discovery root and Owner of one Resource.
2. The factory contract marks exactly the `handler` member as opaque executable
   code. It is not serialized into the structural contract and is never invoked
   by controlled structural evaluation.
3. Before evaluation, the compiler creates a structural source slice in which
   the handler is replaced by a stable binding marker. Only declarations and
   imports reachable from structural members enter that graph.
4. The compiler creates a separate runtime source slice containing the handler
   and its transitive lexical dependencies. Handler-only imports and module
   initializers never run during controlled structural evaluation.
5. A value used by both graphs must satisfy the structural restrictions for its
   structural use. Ambiguous or unsliceable capture is a compile error with the
   handler and captured declaration Origins; the compiler never silently moves
   an impure dependency into the structural graph.
6. The handler is contextually typed from the same leaf-local Definition for
   decoded input and declared errors. The TypeChecker derives its supported
   return contract locally. The handler receives the concrete generated
   application `ctx` promised by `SPEC.md`, not an ambient registry generic or
   a generated previous-build type.
7. The normalized Resource records a stable executable-slot identity, not
   handler source text or file path. Handler source and dependency bytes belong
   to a matched deterministic Runtime Build artifact.
8. Origin Map records the inline handler source span. `questpie explain` joins
   Resource identity, structural contract, handler Origin and runtime digest,
   so internal graph separation is visible without becoming author ceremony.
9. Generated runtime code binds the compiled slot statically. Runtime performs
   no source discovery, filename pairing, Definition merge, or handler lookup.
10. Direct and Fetch execution enter the same bound Resource, codecs, Policy,
    snapshot or transaction owner, handler, limits, output validation, and
    declared-error encoder.

This is first-party Operations compiler behavior only. It is not a public
source-slicing SPI and Packages cannot invent additional executable members.

## Generated context, not a per-Operation capability manifest

`SPEC.md` already decides that a handler receives the concrete `ctx` generated
for its application and does not enumerate Services at each call site. A
required per-Operation `data` map would repeat Collection, Policy, selection,
and key facts before the handler could perform an ordinary read. It would make
the interface shallower without proving an additional beta guarantee.

The recommended interface is therefore `ctx.data`:

```ts
const workspace = await ctx.data.workspaces.get({
  key: { id: input.workspaceId },
  select: { id: true, name: true },
});

const tasks = await ctx.data.run(taskPage, {
  workspaceId: input.workspaceId,
  first: 20,
  after: null,
});
```

Having the application Collections available in a generated context is not the
same as ambient database authority. The interface must enforce these rules:

- every Collection call reuses the immutable Principal, Tenant, Authority,
  cancellation, deadline, locale, and trace facts of the owning Execution;
- the target Collection Policy and exact operation Field authority always run;
- a Query context exposes reads only and joins one owned read-only snapshot;
- a Mutation context exposes supported reads and writes, all joined to its one
  owned transaction;
- callers still provide exact keys, inputs, selections, or accepted Query
  Template parameters; they do not receive free SQL or arbitrary query objects;
- inaccessible and missing keyed rows follow the same non-oracle result;
- Runtime records reads that actually execute for later observability and Live
  Query dependency capture, rather than trusting a duplicate declaration;
- no raw SQL, database pool, driver, transaction handle, Policy bypass,
  execution replacement, `asSystem`, or System Authority constructor appears
  in the generated context.

Policy is the authorization model. Query/Mutation mode is the lifecycle model.
The generated context is their typed application interface, not a second
authorization model.

An application author can always import an unrelated PostgreSQL driver and
open another connection. Such code is outside QUESTPIE Policy, transaction,
observation, and Live Query guarantees; QUESTPIE does not present it as a
supported alternate data interface.

Calling another named Mutation remains deferred in beta.1 because transaction
ownership is not yet closed. Reusable read templates use `ctx.data.run(...)`;
reusable business behavior remains a named Query or Mutation.

## Inferred output and runtime codecs

The Resource must have one exact output contract, but the normal author should
not write the same shape once as a codec and again as a handler return. This is
already the direction in `SPEC.md`: leaf Definitions infer local input and
output, and the generated App Contract materializes their exact resolved types.

The default authoring form therefore omits `output`:

```ts
export const workspaceDashboard = defineQuery({
  name: "workspace.dashboard",
  input: dashboardInput,
  policy: workspaceDashboardPolicy,
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
});
```

The TypeChecker reads the local awaited handler return type. The Operations
compiler validates it against a closed transport-result algebra and emits:

- one canonical normalized output contract in the Query or Mutation Resource;
- one concrete generated client result type;
- one runtime encoder/validator used by direct and Fetch execution;
- diagnostics at the unsupported return member and its Origin.

The accepted Field codecs and generated `ctx.data` results are known leaves.
The beta output algebra must additionally close exact objects, nullable values,
arrays/pages, optional redacted properties, and discriminated declared-error
results before implementation. Arbitrary classes, functions, symbols, cyclic
objects, `Map`, `Set`, unresolved generics, `any`, `unknown`, broad index
signatures, and other shapes without one canonical wire meaning fail compile.
The compiler does not silently JSON-stringify them.

An explicit `output` remains a voluntary pin and escape hatch:

```ts
export const workspaceDashboard = defineQuery({
  name: "workspace.dashboard",
  input: dashboardInput,
  output: dashboardOutput,
  policy: workspaceDashboardPolicy,
  handler: async ({ input, ctx }) => {
    // The compiler proves the awaited return assignable to dashboardOutput.
  },
});
```

Use it when a Package intentionally publishes a stable contract independent of
implementation inference or when a supported result cannot be inferred without
an explicit schema. It is not required ceremony for ordinary application code.
An explicit output codec narrows or pins the public contract; it cannot make an
otherwise unsupported runtime value serializable by assertion.

Changing handler implementation while preserving the same inferred output
changes Runtime Build bytes only. Changing the inferred output shape also
changes the normalized Operation output contract, generated App Contract, and
client surface. An explicit output pin makes incompatible handler changes fail
instead of silently changing that public contract.

Input and declared error payloads remain closed runtime codecs because they
enter from outside the handler. The handler receives decoded input; the runtime
validates/encodes its returned value and declared error payload before success
can commit or reach Fetch. Unknown thrown values become one sanitized internal
failure.

## Runtime build identity

The structural Build Input already identifies the source graph but its semantic
contract digest intentionally excludes an executable body. Operations must add
a matched deterministic Runtime Build artifact containing at least:

- the structural Build Input and Compiled Manifest identities;
- the runtime slice graph digest;
- generated App Contract digest;
- compiler, Bun, and bundler versions;
- emitted server bundle digest.

A body-only handler change that preserves the inferred output changes Runtime
Build bytes, not Schema, Data, structural Query, or operation codec bytes. A
return-contract change also changes the Operation codec and generated App
Contract as described above. Runtime loads only a matched Compiled Manifest and
Runtime Build.

## File-count and locality budget

Files and folders are Feature organization, never compiler semantics. The
contract must support all of these without a registry:

- one small feature file containing its Collection, Policy, Query Template,
  Collection Operation Set, and a custom Query;
- two or three feature-local files split by schema, authority, and operations;
- an optionally extracted large handler imported into its one Definition.

The default Collection CRUD surface is one Collection Operation Set export,
not five Resource files. A custom Query or Mutation is one Definition export,
not a Definition-plus-binding pair. A beta fixture that needs thirty files to
express one Collection has failed this interface requirement even if it
compiles correctly.

## Proof required before acceptance
The design cannot be accepted from prose alone because it amends the current
whole-module evaluator. A focused prototype must prove:

1. an inline handler and a handler imported from another file produce the same
   normalized executable-slot contract;
2. handler-only imports with observable module initialization are not evaluated
   during structural compilation;
3. structural nondeterminism is still rejected and cannot hide in a handler
   capture shared with structural members;
4. a body-only handler change with an identical inferred output changes Runtime
   Build bytes but not structural artifact bytes, while a return-shape change
   changes the exact Operation output and generated client contract;
5. missing, unsliceable, cross-graph, and incorrectly typed captures produce
   stable diagnostics with exact Origins;
6. inferred and explicitly pinned output forms emit identical canonical codecs
   for the same shape; unsupported leaves and incompatible pins fail with exact
   Origins;
7. generated handler and client types are exact without a recursive
   whole-application generic or stale generated files, and remain inside the
   TypeScript budget;
8. runtime startup statically binds every required slot exactly once and rejects
   mismatched artifact pairs;
9. inline and imported forms have equal direct/Fetch behavior and no runtime
   discovery.

Only after those goldens and TypeScript/build budgets pass should the focused
contract receive its one Opus-medium acceptance review.

## Rejected defaults

- a required second Runtime Binding export or handler file;
- a repeated Qualified Resource Name used only to pair a handler;
- a required per-Operation map that enumerates every Collection access;
- a required output declaration that merely repeats an inferable handler return;
- treating TypeScript assignability or `JSON.stringify` as a runtime codec;
- filename or directory pairing;
- a generated or hand-maintained runtime registry;
- naive whole-module evaluation of inline handler dependencies;
- handler source paths as Resource Identity;
- raw SQL, database, transaction handle, Policy override, Execution replacement,
  or System bypass in the generated context;
- a public generic compiler callback, source-transform, or lowering SPI;
- hiding the executable split from Origin, Runtime Build, or structured
  explanation output.
