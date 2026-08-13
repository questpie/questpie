# ADR 0009: Bind executable Definitions from the current App Contract

- Status: Accepted
- Date: 2026-08-12

## Context

Executable Definitions need the concrete generated application context at the
inline handler site. A framework-only factory cannot supply that type to stock
TypeScript. Ambient registration, repeated application generics, broad handler
contexts, and a compiler-previous-build contract are not acceptable sources.

Executable bodies must also stay outside controlled structural evaluation
without requiring authors to export a second binding, maintain a registry, or
organize files for the compiler.

## Decision

QUESTPIE binds executable Definitions from the current App Contract.

- The current virtual `#questpie/app` module exposes exactly six pure Definition
  factory values during compilation: `defineQuery`, `defineMutation`,
  `defineAction`, `defineRoute`, `defineReaction`, and `defineJob`.
- The compiler substitutes those six values with its closed factory
  implementation. It does not evaluate generated Runtime output. Every other
  generated value import from structural source remains invalid.
- Stock TypeScript and editors read the last complete generated App Contract
  after sync. QUESTPIE check, build, and sync use the current virtual contract
  and never give compile N authority over compile N+1.
- One exported executable Definition owns one built-in executable slot. The
  compiler slices an inline or ordinarily imported handler and its lexical
  dependencies into the Runtime Build. Authors do not maintain a handler
  registry, paired file, repeated Resource name, or per-operation capability
  map.
- Handler output is inferred locally when it has one supported wire contract.
  Acyclic same-build output references resolve in deterministic rounds. A
  recursive output component requires an explicit output pin.
- A closed Collection Operation Set expands before final collision resolution
  into ordinary Query and Mutation Resources. The set has no Resource identity
  or runtime dispatcher. Each child has its own identity, Owner, Origin,
  Package Inventory entry, exact generated member, and normal collision
  behavior.
- The application Context root uses fixed compiler identity `context:app`.
  Zero roots produce empty Context input, one root owns the singleton, and two
  roots collide. This decision assigns compiler identity only; it does not
  define Context Resolution semantics.
- A default Collection Policy remains a separate Policy Resource. Zero or two
  candidates fail wherever generated data access requires one implicit default;
  import order cannot select it. Policy behavior remains a separate decision.
- The Runtime Build pairs executable slots and their code with the exact Build
  Input, executable Manifest projection, App Contract, runtime graphs,
  toolchain, and server bundle. Missing, duplicate, stale, wrong-kind, and
  cross-build bindings refuse startup.
- A Package compiles against its own generated `#questpie/package` contract. It
  can activate into a wider host, but its source cannot see undeclared
  host-only Resources.
- ADR-0019 deliberately extends this allowlist to seven by adding
  `defineWorkflow` after the shared durable/checkpoint kernel passed its focused
  proof. All isolation and freshness rules in this ADR apply unchanged.

## Consequences

- The exact handler context has one visible stock-TypeScript source without an
  ambient application registry.
- First sync does not publish an empty or broad placeholder. Before a successful
  sync, the diagnostic tells the developer to run `bunx questpie sync`.
- Raw `tsc` remains type evidence against the last generated files. It is not a
  freshness check. CI and production builds use QUESTPIE check or build.
- A handler body-only change changes Runtime Build bytes but not schema, data,
  structural Query, operation-codec, or public App Contract bytes. A return
  contract change also changes the executable projection and generated types.
- Runtime performs no source discovery, Definition merge, Operation Set
  expansion, or best-effort slot binding.
- P1 accepts compiler mechanics only. Context, Policy, Operation, transaction,
  realtime, durable execution, client wire, and Runtime behavior remain owned
  by their later focused contracts.

## Rejected alternatives

- Ambient TypeScript application registration.
- `ctx: any`, `ctx: unknown`, broad Resource maps, or fallback capability bags.
- Compile N-1 generated output as compile N authority.
- A required source binder, whole-app generic on each Definition, or language-
  service-only type transform while the current-virtual factories are viable.
- Required handler files, handler references, registries, filename pairing, or
  per-operation Collection capability maps.
- A generated runtime application object as the authoring factory.
- A hidden CRUD dispatcher or runtime Resource Set expansion.
- Warning and continuation after a Runtime Build mismatch.
