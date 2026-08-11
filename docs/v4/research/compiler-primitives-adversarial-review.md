# Compiler Primitives Adversarial Review

- Status: Accepted architecture input
- Date: 2026-08-10
- Scope: Static composition, Capability authoring, Auth lowering, and the
  Same-Primitives Law
- Language: ASD-STE100-inspired Simplified Technical English

## 1. Purpose

This review tests one question: how can QUESTPIE add deep first-party
Capabilities without rebuilding v3 Modules or exposing an unproven compiler
plugin system?

Auth is the stress case. The public Auth factory must accept native Better Auth
plugins, preserve their server and client types, convert supported plugin schema
to normal Data resources, and keep runtime values out of generated structural
artifacts.

The review used an adversarial loop between two architecture reviewers. One
reviewer attacked the current ADR set. The other reviewer attacked the proposed
corrections. The loop stopped when the remaining trade-off became explicit.

## 2. Source decisions

The review used these accepted decisions:

- Static composition replaces runtime Module merging.
- Exported branded Definitions are the application inputs.
- The compiler uses the TypeScript TypeChecker and controlled build evaluation.
- Auth hard-requires Data.
- Better Auth is the required Auth implementation in v4.0.
- `betterAuthPlugin()` is one generic typed server and client pair.
- V4.0 has no public compiler SPI.
- Capability roots are not generic Definition containers.

## 3. Found contradiction

ADR 0056 says that Auth-owned Collections are separate visible Definitions.
The Auth design also says that the compiler derives these Collections from the
core Better Auth schema and plugin schemas.

Both statements cannot be exact at the same time. A derived Collection has no
separate authored export. It is a materialized Contribution whose Definition
Source is the exported Auth Definition.

The corrected distinction is:

```text
Auth Definition Source
  -> Better Auth structural schema
  -> materialized Data Contributions
  -> normal Collection resources in the Compiled Manifest
```

The materialized Collection has a normal Resource Identity, Owner,
Augmentation Contracts, collision behavior, migration behavior, and runtime
behavior. Its Origin Chain starts at the exported Auth Definition and continues
through the Better Auth plugin, model, and field.

## 4. Rejected compiler shapes

### 4.1 Generic Capability container

This shape is rejected for v4.0:

```ts
capability("acme.analytics", {
	contributions: [events, profiles, dashboard],
});
```

It gives one value atomic activation authority over arbitrary resources. It is
a stateless Feature Kit. Removing runtime merge, ordering, options, and
lifecycle makes it safer than a v3 Module, but it does not remove its authoring
container semantics.

Auth and File are real compound product contracts. A reusable Booking package
is different. It is application functionality and can export its Collections,
Queries, and Mutations as independent Definitions.

### 4.2 Public lowering SPI

A public lowering or Definition-kind SPI is rejected for v4.0. It would require
callback execution rules, output validation, version compatibility,
diagnostics, conformance tests, and security constraints. No current external
Package needs this interface.

### 4.3 Hardcoded Auth phase in compiler core

The core compiler must not contain an `if (definition.kind === "auth")` schema
lowering branch. That branch would couple the Bootstrap Kernel to a product
Capability and create a private first-party composition path.

## 5. Recommended v4.0 shape

The core compiler is product-neutral. It knows Definition Sources, standard
Contribution IR, validation, generation, and runtime binding emission. It does
not know Better Auth.

`questpie/auth` is a deep public authoring module. Its implementation knows
Better Auth. During controlled build evaluation, `auth()` and
`betterAuthPlugin()` read structural native plugin values and materialize
standard Contributions before the compiler normalizes the exported value.

The compiler does not call a Package callback or look up a lowerer. It receives
a branded value that already contains standard structural output.

The current recommendation deliberately permits a first-party
capability-specific factory to materialize more than one standard Contribution.
It does not expose this as a generic container or Package-author SPI in v4.0.

## 6. Anti-Module invariant

A capability-specific Definition can materialize multiple Contributions only
when all these rules hold:

1. The factory accepts capability-specific structural parameters. It cannot
   accept arbitrary Definitions or Contributions from the caller.
2. The factory has no generic `definitions`, `resources`, or `contributions`
   option.
3. The Definition envelope is discarded after normalization.
4. No downstream rule can address all output from the factory as a runtime
   group.
5. Source order does not select a winner or change semantics.
6. Each materialized resource has its own Resource Identity, Owner, and Origin
   Chain.
7. Each resource uses normal collision, augmentation, migration, and runtime
   rules.
8. Runtime lifecycle belongs to normal Service and scope primitives. It does
   not belong to the authoring envelope.

Deleting one Auth Definition removes its materialized resources because the
Definition was their source. Runtime does not remove them through a parent
container lifecycle.

## 7. Small compiler model

The following pseudotypes describe roles. They do not accept final public names
or syntax.

```ts
declare const definitionContract: unique symbol;

type DefinitionValue<TKind, TContract> = {
	kind: TKind;
	identity: ResourceIdentity;
	requirements: readonly RequirementDraft[];
	materialized: readonly ContributionDraft[];
	readonly [definitionContract]: (value: TContract) => TContract;
};

type ContributionIR =
	| {
			operation: "define";
			resource: ResourceIR;
			identity: ContributionIdentity;
			source: ResourceIdentity;
	  }
	| {
			operation: "augment";
			identity: ContributionIdentity;
			source: ResourceIdentity;
			target: ResourceIdentity;
			contract: AugmentationContractRef;
			patch: AugmentationIR;
	  };

type RuntimeBinding = {
	id: string;
	slice: EnvironmentSliceIdentity;
	slot: string;
};

type RequirementIR = {
	identity: RequirementIdentity;
	kind: RequirementKind;
	source: ResourceIdentity;
	payload: RequirementPayload;
};

type CompilerInput = {
	definitions: readonly DiscoveredDefinition[];
	compilerConfig: CompilerConfig;
};

type NormalizationResult = {
	contributions: readonly ContributionIR[];
	requirements: readonly RequirementIR[];
	runtimeBindings: readonly RuntimeBinding[];
	typeProjectionSources: readonly TypeProjectionSource[];
};
```

Opaque runtime values are not serialized. Resource Kind factory types mark
server and client Environment Slots in one Definition source. The compiler
creates isolated source slices, preserves each slot's transitive code and
closures, and emits bindings to the generated slice exports. The serializable
Compiled Manifest contains only binding identities.

Origin data remains in a separate diagnostic map. Owner is derived from the
producing Definition. Neither is a free property on authored Contribution
drafts.

The TypeScript TypeChecker reads the concrete generic type of the Auth
Definition. It produces the `ctx.auth` and `client.auth` projections. Better Auth
schema lowering does not infer native plugin methods.

## 8. Compiler flow

1. Create one TypeScript Program for configured Source Roots and imports.
2. Find activated type-level Definition candidates and record provenance.
3. Start a Capability Closure work queue with those candidates.
4. Canonicalize, slice, link, gate, and server-evaluate each candidate.
5. Cross-check its evaluated descriptor and TypeChecker leaf contract while
   excluding runtime-only Environment Slots.
6. Read its Requirement drafts. Add unseen typed Capability targets to the work
   queue.
7. Repeat steps 4 through 6 until Capability Closure reaches a fixpoint.
8. Read Contribution drafts that capability-specific factories materialized
   during server-slice evaluation.
9. Discard the authoring surface. Retain the producing Resource Identity.
10. Normalize drafts to Contribution IR and Requirement IR.
11. Validate Resources, Requirements, ownership, augmentation, collisions, and
    unsupported structural inputs.
12. Build candidate sets and verify pinned application Resolutions.
13. Apply explicit Resolutions, then safe defaults to unresolved targets.
14. Validate every reference again after Resolution.
15. Build one Compiled Manifest and one Origin Map.
16. Use the TypeChecker and manifest to emit concrete server and client types.
17. Emit executable bindings to generated Environment Slice exports.
18. Runtime loads validated output. Runtime does not merge Definitions.

## 9. Auth compile flow

```text
exported auth() value
  -> generic betterAuthPlugin() pairs
  -> split server and client Environment Slots from one source
  -> evaluate only the server slice
  -> infer each identity from server.id
  -> read supported native server.schema values
  -> materialize core and plugin Data Contributions
  -> retain native server and client generic types
  -> preserve server and client closures in separate generated ESM slices
  -> core compiler flattens standard Contributions
  -> Auth requirement reaches Data Capability
  -> validate Collections and Augmentations normally
  -> generate QUESTPIE PostgreSQL migration graph
  -> generate native ctx.auth and client.auth types
  -> generate runtime binding that injects QUESTPIE Drizzle PostgreSQL adapter
```

Plugin schema and native API typing are separate mechanisms:

- Schema lowering produces Data Contributions and migrations.
- TypeScript generic inference produces native server and client methods.

An unsupported schema property is a hard compile error in v4.0. Better Auth is
version-constrained. A later manual mapping contract needs one concrete blocked
plugin before it can become public.

## 10. Refined Same-Primitives Law

The current law is too broad when it implies that every internal authoring
factory or lowering implementation must be reproducible by an external Package.
That requirement conflicts with the accepted decision to use Better Auth
without a generic Auth or compiler SPI.

The proposed law is:

> Every Capability produces standard Contribution IR. After normalization,
> every source uses the same identity, ownership, augmentation, collision,
> migration, manifest, generation, and runtime rules. Origin is diagnostic
> metadata and cannot select functional behavior. A public
> capability-specific factory is available to application code and external
> Packages that extend that Capability. Its internal lowering implementation
> can remain private.

Owner and Application Authority remain functional inputs. Origin and
first-party provenance do not grant authority.

This law does not guarantee that an external Package can invent a new
Definition kind or replace Better Auth with another Auth implementation in
v4.0.

## 11. Required conformance tests

### 11.1 Augmentation parity

Apply equivalent authorized Augmentations to one Auth-derived Collection and
one user-authored Collection. Both must use the same Augmentation IR and
validation rules.

### 11.2 Collision symmetry

Let Auth produce `collection:users`. Also export a user-authored owner for
`collection:users`. Compilation must report an ownership conflict with both
origins. Auth cannot win because it is first-party.

### 11.3 Migration parity

Compile structurally equivalent Auth-derived and user-authored Collections.
Both must use the same PostgreSQL field, constraint, index, and migration
pipeline. Migration code cannot branch on Origin.

### 11.4 Runtime parity

CRUD, Policy, transaction, realtime observation, and introspection behavior for
an Auth-derived Collection must use the same Data runtime as a user-authored
Collection.

## 12. Honest replaceability boundary

V4.0 can replace or extend Better Auth plugins through the public Auth factory.
It can augment Auth-owned Data resources and use normal Policies. It can move
the existing Auth authoring module to another Package without changing
downstream Contribution semantics.

V4.0 does not guarantee replacement of Better Auth, the Auth schema lowering
implementation, or the binding of `capability:auth` to native Better Auth
server and client contracts.

## 13. Public compiler SPI stop condition

Reopen a public lowering SPI only when one concrete external Package meets all
these conditions:

1. It must lower a third-party foreign schema into multiple QUESTPIE
   Contributions.
2. Independent exported Definitions create proven duplication or drift from
   that foreign schema.
3. The Package author does not control the foreign schema.
4. Existing public Definition factories cannot express the required contract.
5. A working prototype proves the missing seam and supplies conformance tests.

## 14. Decision

The refined Same-Primitives Law and the capability-specific
multi-Contribution factory exception are accepted in ADR 0061. ADR 0044, ADR
0056, and the Package composition documentation use the corrected model.
