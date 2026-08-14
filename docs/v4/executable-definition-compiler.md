# Executable Definition compiler contract

- Status: Accepted
- Projection: verified in public documentation
- Date: 2026-08-12
- Scope: executable Definition binding, current App Contract, source slicing,
  output materialization, Collection Operation Set expansion, compiler
  ownership facts, Runtime Build pairing, and compiler budgets
- Authority: ADR-0009 and proof head
  `713485a64bcc4795d960d576fea51da56bc4dcdd`

## Boundary

This contract accepts compiler mechanics only. It does not define the runtime
meaning of Query, Mutation, Action, Route, Reaction, Job, Context, or Policy.
Those contracts remain in later proof chapters.

The accepted foundational Schema, Data Contract, and structural Query bytes at
`d03358b7` remain fixed. An executable change cannot reinterpret them.

## Current application factories

Application executable Definitions import their specialized factories from the
generated application contract:

```ts
import {
	defineAction,
	defineJob,
	defineMutation,
	defineQuery,
	defineReaction,
	defineRoute,
	defineWorkflow,
} from "#questpie/app";
```

The Controlled Structural Evaluator recognizes only these seven value exports,
as fixed by ADR-0019.
It substitutes the compiler-owned pure factory values from the current virtual
module. It never evaluates the emitted `app.ts`, `createApp`, a generated
Runtime table, or a private binding file.

All structural builders remain normal imports from `questpie`. A value import
from generated output that is not one of the seven current-virtual factories is
invalid structural source.

## First sync and freshness

`questpie init` writes the stable import map but does not write a broad App
Contract. Before the first successful sync, external TypeScript reports the
missing `#questpie/app` module and QUESTPIE reports this recovery:

```text
bunx questpie sync
```

Sync, check, and build construct the current virtual application contract in
memory. They typecheck executable slots against the same current compile and
publish the generated tree only after every check passes.

Stock editors and raw TypeScript use the last complete on-disk tree. They can
therefore be temporarily stale. QUESTPIE check and build ignore its semantic
authority, compare current Build Input, and reject stale output. A successful
CI or deployment build cannot use compile N-1 as compile N truth.

## One Definition and one executable slot

Each of the seven executable Definition kinds has one built-in `handler` slot.
The author exports one Definition with an inline handler:

```ts
import { defineQuery } from "#questpie/app";
import { codec } from "questpie";

export const messageSummary = defineQuery({
	name: "messages.summary",
	input: codec.object({ id: codec.uuid() }),
	handler: ({ input, ctx }) =>
		ctx.data.messages.get({
			key: { id: input.id },
			select: { id: true, body: true },
		}),
	network: true,
});
```

The factory supplies the exact mode-specific application context. The compiler
does not ask the Definition to list Collections or other application members.

An author can move a large handler into an ordinary imported function. The
function can use a generated handler type with `satisfies`. The Definition
member still owns the only slot. The compiler does not discover the imported
export independently or pair it by path or name.

The compiler creates two private graphs:

1. The structural graph contains the stable executable-slot marker and excludes
   the handler body and handler-only imports.
2. The Runtime graph contains the handler, lexical dependencies, and handler-
   only imports.

A value that reaches both graphs must satisfy the structural determinism rules.
An impure or ambiguous shared capture fails with the Definition and captured
declaration Origins.

## Output materialization

Input comes from the local codec. Context comes from the current App Contract.
The handler return remains leaf-local TypeScript inference.

The compiler materializes supported outputs in deterministic current-build
rounds:

1. collect Resource identities, modes, inputs, and explicit pins;
2. infer outputs that depend only on local values, generated data, or resolved
   Operations;
3. update the current virtual Operation map;
4. repeat until stable;
5. report the remaining recursive component with every Origin.

One explicit output pin breaks a recursive output component. The compiler never
substitutes a broad placeholder or a previous-build result. An explicit pin is
a runtime codec contract, not a cast.

A body-only handler change changes Runtime Build bytes. It does not change the
executable Manifest projection, operation codec, generated public declarations,
Schema Projection, Data Contract Projection, or structural Query bytes. A
return-contract change also changes the output codec and generated declarations.

## Collection Operation Set

A Collection Operation Set is a closed compile-time Resource Set. Its literal
`list`, `get`, `create`, `update`, and `delete` members expand before final
identity collision resolution.

Each present member establishes one ordinary Query or Mutation Resource. It has:

- one normal Resource Identity and Owner;
- the set export and literal member as Origin;
- one structural-contract digest and Package Inventory entry;
- one canonical exact-key App Contract identity entry and one nested-only
  generated server capability member in its Query or Mutation kind map;
- one generated Collection client alias;
- the normal collision behavior of its Resource kind.

The set itself has no Resource Identity, handler slot, runtime object, or CRUD
dispatcher. A handwritten Resource or another set that establishes one child
identity causes the ordinary duplicate-identity error.

## Compiler ownership facts

The application Context root is a singleton compiler protocol Definition with
fixed identity `context:app`. It is not a public Package-extensible Resource
Kind. Zero roots produce empty generated Context input. One root owns the
singleton. Two roots collide and report both Origins. P2 defines resolution and
runtime behavior.

A Policy remains an ordinary Policy Resource that targets a Collection. Where
generated data access needs an implicit default Policy, zero candidates fail,
one exact target succeeds, and two candidates fail with both Origins. The
compiler never attaches a Policy through import order or Collection patching.
P2 defines the program, phases, SQL lowering, and enforcement.

## Package isolation

A fixed Package uses its own generated `#questpie/package` factory surface. Its
contract contains only its owned Resources and accepted typed dependencies.
The Package emits nameable declarations without referring to a future host.

Application activation can provide a structurally wider runtime context only
after the compiler proves the Package contract. Wider host members remain
invisible to the Package source. A Package cannot access them through ambient
merging, consumer retyping, or a string lookup.

## Runtime Build

The Runtime Build is the versioned executable partner of the compiled
application artifacts. It records:

- Application Identity and Build Input Digest;
- exact executable Manifest and App Contract content digests;
- every required Resource slot, mode, Runtime graph digest, and bundle export;
- compiler, Bun, and bundler versions;
- the server bundle digest;
- its own domain-separated digest.

The generated loader binds every slot statically. It refuses startup when a
slot is missing, duplicated, stale, the wrong Resource kind, or from another
Runtime Build. Runtime does not inspect source, discover Definitions, expand a
Resource Set, or continue after a mismatch.

## Origins and explanation

The Origin Map records each executable Definition, handler, and Operation Set
member. `questpie explain --json` joins that map with canonical executable
projections, generated-member metadata, and the matched Runtime Build. Explain
does not execute source or infer identity from bundle text.

Reverse discovery order and absolute checkout relocation preserve semantic,
generated, Origin, and Runtime Build bytes. A logical source move preserves
semantic and Runtime contract bytes but changes Origin and Build Input.

## Accepted proof and budgets

The focused proof head is
`713485a64bcc4795d960d576fea51da56bc4dcdd`. One fresh Claude Opus review at
medium effort independently ran the proof and returned `PASS`.

The final proof measured on Linux x64, AMD Ryzen 5 5600G, Bun 1.3.14, and
TypeScript 5.9.2:

| Measurement                                 |      Result | Accepted ceiling |
| ------------------------------------------- | ----------: | ---------------: |
| Types                                       |       1,855 |         reported |
| TypeScript instantiations                   |       3,901 |          125,000 |
| TypeScript memory                           |  24,136 KiB |       98,304 KiB |
| TypeScript total time                       |      0.41 s |            1.5 s |
| warm completion p95                         |  below 1 ms |           100 ms |
| warm hover p95                              |  below 1 ms |           100 ms |
| public application plus client declarations | 5,680 bytes |    262,144 bytes |
| largest private binding record              |   219 bytes |      4,096 bytes |
| 4x instantiation growth                     |      3.629x |               5x |
| 4x declaration growth                       |      1.872x |               5x |

The proof records exact bundle bytes and per-Resource-kind deltas. Production
implementation must replace the proof's synthetic graph, relocation, and
collision observations with real compiler and relocated-build integration
tests. Those implementation tests cannot weaken the accepted bytes, ownership,
freshness, or refusal rules.
