# Definition discovery and composition

- Status: Accepted
- Projection: verified against public documentation
- Date: 2026-08-11
- Scope: Definition discovery, Package activation, Resource Identity, Owner,
  Augmentation, Build Input, Origin, and generated output
- Language: ASD-STE100-inspired Simplified Technical English

## Purpose

This workbench defines how application source and installed Packages become
the exact input to the Static Application Compiler. It also defines the
accepted Resource Identity, Owner, Augmentation, Origin, and generated-output
boundaries for this vertical.

The design has two separate boundaries:

1. source Definitions and explicit Package activations are compiler inputs;
2. the compiler writes deterministic generated output that the QUESTPIE Runtime loads.

Generated output never becomes a discovery input.

## Accepted direction from the grill

### Application root

QUESTPIE uses one committed, non-executable `questpie.json` root. It replaces
the provisional `questpie.app.ts` and `questpie.packages.json` shapes. The file
has a published JSON Schema and contains compiler inputs, not
Definitions or runtime values:

```json
{
	"$schema": "https://questpie.dev/schema/application-v1.json",
	"version": 1,
	"application": {
		"name": "barbershop"
	},
	"postgres": {
		"schema": "barbershop",
		"minimumMajor": 16,
		"databaseCollation": "C.UTF-8",
		"databaseCType": "C.UTF-8",
		"extensions": [],
		"physicalNames": {}
	},
	"source": {
		"root": "src",
		"exclude": []
	},
	"packages": {}
}
```

The root supplies the Application Identity and PostgreSQL profile accepted by
the schema lifecycle. It never contains a `definitions` array. The application,
PostgreSQL, and source sections are user-owned; `questpie init` may
create their initial values. The Package map and its accepted Package Inventory digests are
machine-owned by `questpie add`, `questpie package accept`, and
`questpie deactivate`. Manual edits still use the same schema and validation.

The v1 schema rejects unknown keys at every level. QUESTPIE canonicalizes this
file with RFC 8785 and one trailing LF before hashing it. `source.exclude` and
`postgres.extensions` are semantic sets: values must be unique and QUESTPIE
stores and hashes them in UTF-8 byte order.
`postgres.physicalNames` is a user-owned map from an exact schema target
identity to a physical PostgreSQL name. It is the escape hatch for a
Package-owned target whose derived name collides. An identity cannot declare
both an inline `postgres.name` and a root override, even when the strings match.
Every key must resolve to one compiled non-`application:` schema target. An
unknown, stale, or application identity reports `QP-SCHEMA-003 invalidReference`;
QUESTPIE never ignores an override.

More than one root is an error. The compiler includes the canonical root bytes
in the Build Input Digest. Runtime does not load this file.

### Local Definitions

QUESTPIE discovers exported branded Definitions under the application source
root. The default source root is `src/`. A user does not maintain a central
`definitions: [...]` array.

Folders below the source root have no semantic meaning. A file name, file path,
and export name record Origin only. Moving an unchanged Definition cannot
change its Resource Identity or its semantic artifact bytes.

The compiler creates its TypeScript Program from the application `tsconfig`.
It inspects `.ts`, `.tsx`, and `.mts` source files under `src/` that
belong to that Program. It excludes these paths:

```text
**/*.d.ts
**/*.test.*
**/*.spec.*
**/__tests__/**
**/__fixtures__/**
**/fixtures/**
```

Exclusion patterns are anchored to the normalized source root and use `/` as
separator. `*` matches zero or more non-separator characters, `?` matches one
non-separator character, and `**` matches across separators. Character classes,
brace expansion, negation, and platform-native separators are not supported in
v1. Dotfiles participate in matching normally.

An application can add exclusions. It cannot add a discovery root outside the
application package in v1. A monorepo Package enters through Package activation,
not through a path that escapes the application.

The compiler does not traverse directory symlinks. It resolves file symlinks to
real paths, requires the real path to remain inside the source root, and keys a
Definition declaration by real path plus exported symbol. The structural
Program uses `preserveSymlinks: false`. A top-level QUESTPIE Definition call in
application-owned Program source outside the root is
`QP-COMPOSE-022 definitionOutsideSourceRoot`, not a silent omission.
Application-owned Program source means a Program file whose real path is inside
the application package, outside `node_modules`, and not excluded by the test or
fixture patterns. Excluded test and fixture paths can construct Definitions
without becoming discovery roots and without producing this diagnostic.

A local Definition must be a value export of a source module. It does not need
to be re-exported from a barrel or root source module. A private value is not a
discovery root.

The TypeScript TypeChecker resolves export aliases to their declaration symbol.
Re-exporting the same Definition through one or more barrels does not create a
second contribution. For a local Definition, the declaration site is the only
recorded Origin; intermediate barrel aliases are intentionally omitted.

Two separate Definition factory calls remain two Definition Sources. If they
produce the same Resource Identity, QUESTPIE reports a collision even when
their normalized bytes are equal. The compiler never deduplicates Definitions
by semantic bytes.

### Package installation and activation

Installing a Package does not activate it. `bun add` only changes the dependency
graph and lockfile.

The recommended workflow is:

```bash
questpie add @acme/barbershop-audit
```

The command performs two independent operations:

1. it installs the Package with Bun;
2. it records an explicit activation and Package Inventory digest in `questpie.json`.

The Package activation map in `questpie.json` is source-controlled compiler
input. It is not generated output:

```json
{
	"packages": {
		"@acme/barbershop-audit": {
			"inventoryDigest": "0000000000000000000000000000000000000000000000000000000000000000"
		}
	}
}
```

The application records the accepted public Package Inventory. V1 freezes
the activation subpath to the public `./questpie` export; Package metadata does
not configure another path. The compiler rejects a Package whose current
Package Inventory differs from the accepted value.

The normal user does not edit this file. A user can make the same change
manually when automation is unavailable. The manual path has identical
validation and semantics.

`questpie deactivate @acme/barbershop-audit` removes the activation. It does not
remove the Bun dependency, apply a migration, or delete data. The next compile
and migration plan show the semantic effect of removing the Package. The user
can run `bun remove @acme/barbershop-audit` separately when no ordinary
application code needs the dependency.

Before it edits `questpie.json`, `questpie deactivate` compiles a simulated
configuration without the Package. If application source still references a
Package Definition or Augmentation, the command refuses the edit and
prints every acceptance or reference site with the required source change. If
no references remain, it prints every removed Resource, Augmentation, generated
member, and schema classification and then edits the activation map. This
preview is not a second destructive-acceptance protocol; the exact Migration
Plan Digest remains the only database-change gate. An unresolved or invalid
Package is an error and never becomes an inferred deactivation.

Only direct entries in the application Package map are active.
Transitive dependencies never activate themselves.

Package provenance is the direct activated Package export through which a
Definition or Augmentation entered application composition. That export must be
present in the Package's accepted Package Inventory. A terminal dependency recorded in
`declaredAt` does not require independent activation because the direct
activated Package owns the public entry. Otherwise QUESTPIE reports
`QP-COMPOSE-005` with the exact `questpie add` recovery command. Importing a type or ordinary helper
cannot activate a Package or add a Resource. The manual activation path edits
the same Package map that `questpie add` edits.

### Package publication contract

A Package that supports activation publishes a public ESM subpath and a static
QUESTPIE manifest in its `package.json`:

```json
{
	"name": "@acme/barbershop-audit",
	"type": "module",
	"exports": {
		".": "./dist/index.js",
		"./questpie": {
			"types": "./dist/questpie.d.ts",
			"import": "./dist/questpie.js"
		}
	},
	"questpie": {
		"manifestVersion": 1,
		"framework": "^4.0.0"
	}
}
```

The activation subpath can export branded Definitions, branded Resource-kind
Augmentations, and TypeScript types. Another runtime value is an error. Root
Definitions enter composition when the Package is active. An Augmentation is
inert until an owning Definition accepts that exact value. The subpath cannot
export a compiler callback, discovery hook, lifecycle hook, lowering
implementation, arbitrary generator, or composition factory. QUESTPIE resolves
the subpath through the Package `exports` contract and validates every
composition value through the same normalization path as local source.

`questpie add` validates the static manifest before it changes the application
Package map. QUESTPIE does not invoke a Package-provided install hook
or generator. Bun retains authority over dependency installation and its
trusted-dependency policy.

The v1 activation subpath has one ESM implementation for compilation. It can
use `types`, `import`, and `default` conditions only. When both `import` and
`default` exist, they must resolve to the same file. Platform-specific,
environment-specific, and user-defined conditions are invalid on this
subpath. Runtime never uses this subpath for discovery or activation. The later
Operations and Auth grills must define how executable Package code reaches
generated runtime bindings without creating a second divergent entry point.

The Package manifest version is an integer protocol version. The compiler
rejects an unknown version, an incompatible framework range, a missing public
subpath, a non-ESM target, and a target outside the Package. The dependency
lockfile pins resolution. The activation-graph content digest pins actual bytes,
including workspace and linked Package source.

An activation name must equal the resolved Package's declared `name`. V1
rejects dependency aliases as activation roots. Workspace Packages use their
declared package name and the same publication contract as registry Packages.
A workspace Package can map `./questpie` directly to TypeScript source. If it
maps the export to built output, QUESTPIE treats that output and its reachable
module graph as the Package contract and hashes those bytes; it does not infer
or compare an unpublished source tree behind `dist/`.

Activation includes the complete set of branded composition exports from the
activation subpath. QUESTPIE canonicalizes the exported Package Inventory
as export category plus explicit identity and stores its digest in
`questpie.json`. A Package update that adds, removes, or changes the identity or
structural contract of an exported Definition or Augmentation fails with
`QP-COMPOSE-008 packageInventoryChanged`. `questpie package accept <package>` prints the
exact entry and normalized member-level diff, including old and new structural
contract digests, and updates the reviewed digest. `questpie sync` only
regenerates application artifacts and never accepts a Package Inventory change.
No Runtime or database change occurs before that acceptance.

The canonical Package Inventory sorts entries by category, identity, and export name,
in that order. Its entry type is:

```ts
interface PackageInventoryEntryV1 {
	exportName: string;
	category: "definition" | "augmentation";
	resourceKind: string;
	identity: string;
	structuralContractDigest: string;
}
```

`structuralContractDigest` covers the normalized serializable contract but not
an executable handler body, Origin, Package path, or export name. Inventory JSON
uses RFC 8785 plus one LF. The Package Inventory digest is lowercase SHA-256 over those
bytes prefixed by `questpie-package-inventory-v1\0`, rendered as
64 lowercase hexadecimal characters. Export name remains in each entry so an export
rename is a reviewed Package API change even when semantic identity is stable.
Each structural contract digest uses the same canonical JSON rule with the
prefix `questpie-structural-contract-v1\0`.

The Build Input Digest also contains a content digest of the complete
path-relative module graph reachable from the activation subpath. Registry
integrity is recorded when available, but it never replaces the content digest.
This rule also covers workspace, link, file, and Git dependencies.

### Controlled compilation

Discovery finds candidate exports. It does not execute every application
module. The compiler builds one TypeScript Program, identifies candidate
Definition modules, and evaluates each candidate module as one complete ESM
module in v1. Statement-level code slicing is deferred.

The compiler detects direct calls to the closed QUESTPIE Definition factories
before it trusts the inferred result type. A TypeScript error in a candidate
module or its structural import graph is fatal. An unresolved active Package is
fatal. QUESTPIE never emits a partial Compiled Manifest, and migration planning
never interprets a failed discovery or evaluation as Resource removal.

For every candidate, the compiler compares the identity and invariant leaf
contract inferred from published TypeScript declarations with the evaluated
structural value. A stale or dishonest `.d.ts` that disagrees with runtime ESM
is `QP-COMPOSE-006 invalidPackageManifest`, not a generated-type and Compiled
Manifest split.

A top-level call to a closed Definition factory that does not reach one direct
value export is `QP-COMPOSE-001 unreachableDefinition`. Exporting Definitions only inside an
array, object, map, or another generic container is also an error. Calls inside
a user-authored factory function are not roots; the exported branded value that
the function returns is the root.

An Augmentation is reachable when the Package Inventory exports it or an
exported owning Definition accepts it. A direct configured factory call inside
an Owner's accepted literal list is therefore reachable without a separate
export.

Structural compilation cannot depend on environment variables, time, random
values, network access, filesystem reads, process execution, machine or process
identity, locale-sensitive formatting, or mutable global state. Runtime
Environment Slots use a separate generated binding path. Application and
Package composition modules cannot use `import.meta.url`, directory or path
introspection, current working directory, PID, hostname, platform, architecture,
runtime-version probes, `os.*`, `Bun`, `Deno`, `navigator`, `Intl`,
`localeCompare`, or any `toLocale*` method to influence a structural value.

The v1 compiler enforces this boundary in every compile:

1. it rejects forbidden imports and global references in the transitive
   structural graph;
2. it evaluates the graph in a fresh module realm inside a child process with an empty application
   environment, no network, no subprocess permission, no writable filesystem,
   fixed locale and timezone, and deterministic replacements for clock and
   random APIs that throw on access.

Each candidate graph gets a fresh realm. A module-scope mutable value cannot be
shared across candidates or influence compilation. `questpie build` and
`questpie check` perform exactly two complete compilations. The second uses
reversed candidate order and a different synthetic checkout root while
preserving logical paths. QUESTPIE compares normalized structural drafts,
semantic artifacts, Origin Map bytes, and generated bytes. A mismatch is
`QP-COMPOSE-011 nondeterministicEvaluation` and reports the first different canonical path.
The non-writing `questpie dev` watch loop evaluates once for latency. Any
command that writes a Committed Migration or Seed artifact, including
`questpie migration create` and `questpie migration dev`, performs the same
two-run determinism proof before it writes or applies bytes.

The controlled evaluator is a determinism boundary for trusted application and
Package code. It is not a security sandbox for hostile code. Package trust and
dependency review remain application responsibilities. A compiler diagnostic
must include the Definition Origin and the import or call chain that reaches a
forbidden capability.

Application and Package composition modules cannot use WebAssembly, dynamic
imports whose specifier is not a string literal, `eval`, `Function`, CommonJS
`require`, or top-level `await`. A third-party dependency is not rejected only
because its published implementation is CommonJS, but its complete reachable
graph remains subject to forbidden-capability checks, child restrictions, and
differential evaluation. Native addons remain forbidden because the compiler
cannot inspect or constrain their effects. Pure local helpers and deterministic
third-party libraries are permitted under those rules.

A structural module cannot value-import `.questpie/generated/**` or an
arbitrary `#questpie/app` value. A type-only import is permitted and is erased
before controlled evaluation. ADR-0009 plus ADR-0019 permit exactly seven pure
current-virtual factory values: `defineQuery`, `defineMutation`, `defineAction`,
`defineRoute`, `defineReaction`, `defineJob`, and `defineWorkflow`. The evaluator
substitutes those values from the compiler's current draft and never loads
emitted Runtime output. Another generated value remains `QP-COMPOSE-012`.

QUESTPIE resolves the Current App Contract from the current normalized draft,
not compile N−1 on disk. It then writes the generated surface and typechecks
the separate Runtime graph. QUESTPIE does not emit a broad placeholder. A
direct external typecheck before the first sync fails with the exact
`questpie sync` recovery.

Source order, filesystem traversal order, export order, and Package activation
manifest order cannot select a winner. After normalization, QUESTPIE sorts
semantic inputs by canonical identity and reports collisions.

### Build Input Digest

`build-input.json` has this exact v1 shape:

```ts
interface BuildInputArtifactV1 {
	format: "questpie.build-input";
	version: 1;
	digest: string;
	originMapDigest: string;
	inputs: {
		compilerVersion: string;
		bunVersion: string;
		applicationConfigDigest: string;
		packageManifestDigest: string;
		typescriptConfigGraphDigest: string;
		lockfileDigest: string;
		structuralGraphDigest: string;
		dependencies: Array<{
			name: string;
			role: "framework" | "activatedPackage" | "library";
			resolutionDigest: string;
			moduleGraphDigest: string;
			inventoryDigest: string | null;
		}>;
	};
}
```

Each component digest is lowercase SHA-256 over its canonical bytes with a
component-specific `questpie-build-input-component-v1:<field>\0` prefix. The
lockfile component hashes its exact bytes. `packageManifestDigest` hashes the
canonical application `package.json`, including the managed `imports` map.
`structuralGraphDigest` hashes every module reachable during structural
compilation, including application source, the resolved QUESTPIE framework,
activated Packages, and ordinary third-party structural libraries. Each module
entry contains a resolution-scoped logical path and file-content digest and is
sorted by those bytes. `typescriptConfigGraphDigest`
hashes the normalized raw `tsconfig` root, every reachable `extends` file, and
every project-reference config as application-relative path plus exact content
digest, sorted by path; `compilerVersion` separately fixes interpretation. No
resolved absolute path or host-default compiler option enters these bytes.
Dependency entries sort by role, name, and resolution digest. The framework is
always present. A `library` entry is exactly a resolved Package that contributes
at least one module to `structuralGraphDigest` and is neither the framework nor
an activated Package. Only an activated Package has a non-null
`inventoryDigest`.

`resolutionDigest` is the `PackageResolutionV1.id` for the same resolution.
`moduleGraphDigest` is SHA-256 over RFC 8785 JSON plus one LF for the array of
Package-relative `{ path, contentDigest }` entries, sorted by path, with the
prefix `questpie-module-graph-v1\0`. A dependency instance appears once even
when more than one structural import reaches it.

The top-level Build Input Digest hashes canonical `inputs` bytes plus one LF
with `questpie-build-input-v1\0`. It is rendered as
64 lowercase hexadecimal characters. It proves which inputs produced a build. It does not
classify a semantic change, approve a migration, or enter a semantic artifact
digest. `originMapDigest` verifies the generated diagnostic artifact but is
outside `inputs` and the Build Input Digest, so no digest cycle exists.

### Explicit generated output

The compiler writes an explicit generated application under
`.questpie/generated/`. This directory is derived output and is ignored by
source discovery.

The Compiled Manifest keeps accepted composition facts separate from physical
schema projection:

```ts
interface CompiledManifestV1 {
	format: "questpie.manifest";
	version: 1;
	application: { name: string };
	composition: {
		resources: Array<{
			identity: ResourceIdentityTextV1;
			contributions: Array<{
				identity: ContributionIdentityV1;
				structuralContractDigest: string;
			}>;
		}>;
	};
	schema: SchemaProjectionV1;
	data: DataContractProjectionV1;
}
```

Resources sort by Resource Identity and contributions sort by Contribution
Identity. Accepted contribution identities are semantic composition facts.
Paths, spans, Package versions, and export names remain only in the Origin Map.
The Schema Projection contains the resolved database structure but no
contribution identity, so a contribution rename with identical structure does
not create a migration.

`data` contains the resolved runtime Data Contract accepted by the later data
model and structural Query vertical. Adding this required semantic member is an
explicit amendment to the original closed manifest shape; it does not change
`format` or `version` because no Compiled Manifest Digest or deployed v1 reader
exists. Data-only changes such as an inverse Relation still do not create a
migration. Field structure accepted by the reopened unreleased Schema
Projection—including inline leaves and JSONB-backed Fields—changes schema bytes
through the normal reviewed migration lifecycle.

The generated application contains at least:

```text
.questpie/generated/
├── manifest.json
├── schema-projection.json
├── origin-map.json
├── build-input.json
├── app.ts
└── internal/
```

- `manifest.json` is the deterministic Compiled Manifest.
- `schema-projection.json` contains the exact schema artifact bytes accepted by
  the schema lifecycle.
- `origin-map.json` is the diagnostic Origin Map. Its bytes do not affect
  semantic identity.
- `build-input.json` records the Build Input Digest and its component digests.
- `app.ts` exposes the concrete typed application contract and loader without
  ORM types.
- `internal/` is compiler-private and has no source-compatibility guarantee.

The Operations and generated-client vertical adds the frontend-neutral client
entry only after its protocol and types are accepted. Composition does not
publish an empty speculative client API.

The deployment bundle includes `origin-map.json` so Studio and diagnostics can
explain generated Resources. Runtime behavior and schema application do not
depend on Origin data.

The generated application does not own the process entry, port, environment, or
signal handling. The host loads the public application loader and validated
artifacts. Runtime does not scan source files, inspect `node_modules`, activate
Packages, merge Definitions, or choose collision winners.

The canonical `questpie.json`, application `package.json`, source modules and
logical paths, TypeScript configuration graph, dependency lockfile, activated
Package inventories, complete structural dependency graph, compiler version,
and Bun version are the reproducible build input. Generated output is not an
authoring registry.
CI and deploy fail when generated output does not match those inputs.

QUESTPIE writes generated output to a sibling temporary directory and validates
all files and digests before replacement. Directory replacement is recoverable,
not falsely described as one atomic filesystem operation: QUESTPIE renames the
previous directory to a backup, renames the validated directory into place,
then removes the backup. If the second rename fails, it restores the backup. On
startup, the CLI removes no directory until it has identified one complete,
checksum-valid generated tree. A failed compile before replacement leaves the
last complete output untouched.

Runtime can verify artifact versions, digests, and internal consistency inside
a deployment bundle. Runtime cannot prove source freshness when source inputs
are not deployed. `questpie build` and CI own that guarantee: they recompute the
Build Input Digest and package only the output of the same successful build.

`.questpie/generated/` is not committed by default. `questpie dev` and
`questpie build` regenerate it. `questpie check` uses the same two-compilation
protocol above. Origin remains excluded from semantic identity and migration
checksums; diagnostic does not mean nondeterministic. Committed Migrations
remain source-controlled under the schema lifecycle contract.

The project ignores the complete `.questpie/` directory. The separate
`questpie/` directory contains Committed Migrations and committed Seed artifacts
and cannot be ignored:

```gitignore
.questpie/
```

Stable application imports use `app.ts`. Files below
`.questpie/generated/internal/` are compiler-private. Executable handler binding
output belongs to the Operations and Auth grills and has no public path in this
vertical. The file checksum manifest and deployment bundle shape remain to be
closed.

`questpie init` manages these application `package.json` imports:

```json
{
	"imports": {
		"#questpie/app": "./.questpie/generated/app.ts",
		"#questpie/source/*": "./src/*"
	}
}
```

Application structural modules can import types and the seven ADR-0009/0019
current-virtual Definition factories from `#questpie/app`. Another value import
is `QP-COMPOSE-012`. Packages use their own generated `#questpie/package`
factory contract and cannot bind to host-only Resources.
Generated private code uses `#questpie/source/*`, not an absolute or `../../src`
path. A configured source root updates that mapping. `questpie check` builds in
a sibling directory below `.questpie/` and compares bytes that use the same
stable aliases, so the temporary directory name and depth cannot affect output.

Absolute checkout paths never enter generated artifacts or digests. Application
Origins use NFC-normalized, application-package-relative POSIX paths; Package
Origins use NFC-normalized, resolved-package-relative POSIX paths. The Build
Input Digest includes those logical paths because a path change can change
executable bindings and Origin. Semantic artifact digests exclude Origin paths
under their own canonical contracts.

QUESTPIE rejects source paths that collide after Unicode normalization or
portable case folding. One compile uses one discovery TypeScript Program,
including its resolved project references. The second-phase runtime typecheck
uses the current virtual App Contract. The same declaration cannot enter
discovery twice through project references or another Program.

If `questpie add` installs a dependency and validation then fails, it leaves the
dependency installed but inactive. It does not edit the Package map.
The diagnostic tells the user to install a compatible version or remove the
inert dependency. QUESTPIE does not guess whether the dependency existed for
ordinary application code before the command.

## Capability classification

| Capability                                                           | Classification    | Contract                                                                                                              |
| -------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| Automatic local Definition discovery under `src/`                    | v1                | Exported branded Definitions only                                                                                     |
| Explicit direct Package activation                                   | v1                | Source-controlled `questpie.json` Package map and Package Inventory digest                                            |
| `questpie add`, `questpie package accept`, and `questpie deactivate` | v1                | Installation plus activation, reviewed Package Inventory replacement, or activation removal only                      |
| Manual Package-map edit                                              | escape hatch      | Same compiler path and guarantees as the CLI                                                                          |
| Package install auto-activation                                      | rejected          | Dependency presence cannot change the App Contract                                                                    |
| Transitive Package auto-activation                                   | rejected          | Only application activations are roots                                                                                |
| Package install callback or generator                                | rejected          | No arbitrary code executes during activation                                                                          |
| Runtime discovery or Definition merge                                | rejected          | Runtime loads compiler output only                                                                                    |
| Public compiler or lowering plugin API                               | rejected for v4.0 | Reopen only after two concrete implementations prove one seam                                                         |
| Configured Package activation profiles                               | deferred          | No tracer case requires them                                                                                          |
| Package composition factory                                          | deferred          | Add only when one capability vertical proves an exact typed contract                                                  |
| Target-side patch of a sealed Package Definition                     | rejected          | Vendor the Package composition locally                                                                                |
| Re-exporting one local Definition                                    | v1                | One source; local barrel aliases do not enter the Origin Map                                                          |
| Importing a Package composition value without activation             | rejected          | Diagnostic gives the explicit `questpie add` recovery                                                                 |
| Discovery roots outside the application package                      | deferred          | Activate workspace Packages through their publication contract                                                        |
| Pre-generating normal source Definitions                             | escape hatch      | An external tool can write source before compile; QUESTPIE receives no hook and trusts only the resulting Definitions |

## Whole-system layer map

| Layer                  | Effect of this contract                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring API          | Users export independent branded Definitions. They do not maintain a registry array.                                                                                                                                                      |
| Discovery and compiler | Local source is discovered automatically. Package input is explicitly activated and deterministically normalized.                                                                                                                         |
| Canonical artifacts    | The Compiled Manifest excludes Origin paths and activation order. The Origin Map remains diagnostic.                                                                                                                                      |
| PostgreSQL and Runtime | Neither layer discovers or merges Definitions. Schema changes use the reviewed migration contract.                                                                                                                                        |
| Protocol and CLI       | `questpie add`, `questpie package accept`, `questpie deactivate`, and `questpie sync` change Build Input or regenerate output only. Compile reports activation, Package Inventory, compatibility, determinism, and collision diagnostics. |
| Generated client       | Members exist only for accepted compiled Resources. Package absence removes those members on regeneration.                                                                                                                                |
| Studio and operations  | Studio reads compiled identities and Origin data. It cannot activate Packages or override a collision.                                                                                                                                    |

## Resource Identity

### Canonical form

A Resource Identity is the ordered pair of one closed Resource Kind and one
Qualified Resource Name:

```ts
type ResourceIdentityV1 = {
	kind: ResourceKindV1;
	name: QualifiedResourceNameV1;
};
```

Canonical JSON stores the fields as `kind` and `name`. Diagnostics, explicit
references, and Origin Map keys use this lossless text form:

```text
<kind>:<qualified-resource-name>
```

Examples are:

```text
collection:appointments
query:booking.availability
mutation:appointments.schedule
seed:barbershop.demo.v1
```

The name grammar excludes `:` and `/`. The text form therefore needs no escape
rule. Nested schema members continue to use the versioned member identity
grammar accepted by the schema lifecycle.

### Qualified Resource Name grammar

V1 uses ASCII names. This ABNF is normative:

```abnf
qualified-resource-name = segment *("." segment)
segment                 = lower *(lower / upper / digit)
lower                   = %x61-7A
upper                   = %x41-5A
digit                   = %x30-39
```

Each segment contains 1 to 63 characters. The complete name, including dots,
contains at most 255 characters. Names are case-sensitive and are not
case-folded or Unicode-normalized because Unicode is not permitted.

`then` remains a valid segment and a valid non-Operation Resource name. An
Operation projected into a generated server capability map cannot use `then`
as its final segment because the callable leaf would make that namespace
Promise-like. Compilation reports `QP-COMPOSE-024`. A non-final `then` segment,
such as `then.fire`, remains valid.

These names are valid:

```text
appointments
booking.availability
oauth2Clients
barbershop.demo.v1
```

These names are invalid:

```text
Appointments
booking..availability
booking_availability
booking-availability
booking.availability.
```

Package authors should use an explicit stable vendor or product segment for
owned reusable Resources, such as `acme.auditLog`. QUESTPIE does not derive,
rewrite, or validate that segment against the Package name. A Package rename
therefore cannot rename Resources.

QUESTPIE reserves no Qualified Resource Name prefix for first-party code. Core,
official Packages, external Packages, and application source use the same
identity and collision rules. Framework protocol objects that are not Resources
use a separate internal protocol and cannot claim a Resource namespace.

### Resource Kind protocol

Resource Kind is a versioned, lowercase ASCII token from the closed compiler
protocol. The product vocabulary reserves these possible top-level tokens:

```text
collection
global
policy
query
mutation
action
route
service
reaction
job
workflow
seed
```

Reservation does not allocate a token in schema artifact v1. The accepted schema
vertical currently allocates `collection` and `seed`. Each later vertical must
accept its own Definition Contract and artifact allocation before use. External
Packages cannot add a Resource Kind in v4.0.

`application:<name>` is a schema-target and receipt namespace from the schema
lifecycle. It is not a discovered Resource Kind or a Definition identity. The
compiler protocol reserves that prefix separately so it cannot be mistaken for
a Package-extensible Resource Kind.

Fields, Constraints, Indexes, and Relations are members of an owning schema
Resource. They are not top-level Resource Kinds. Their semantic identities use
the member grammar from the schema lifecycle.

### Identity invariants

The following facts cannot change Resource Identity:

- application file or directory;
- export name or re-export chain;
- Package name, version, scope, or registry;
- local, workspace, Git, or registry installation;
- discovery and activation order;
- TypeScript variable name;
- physical PostgreSQL name;
- normalized Resource contents.

Two Resources of different kinds can use the same Qualified Resource Name.
For example, `collection:appointments` and `query:appointments` are distinct.
Two separately authored Definitions of the same kind and name collide even
when their contents are byte-identical.

A name can be a strict dotted prefix of another name, such as `booking` and
`booking.availability`. The Compiled Manifest, App Contract identity index,
receipts, references, CLI, Studio, and external projections preserve exact
`<kind>:<qualified-name>` keys and can represent both.

Generated server Operation capability maps are a separate, nested-only call
projection. Within one Operation kind, a leaf cannot also be a namespace
prefix: `action:booking` plus `action:booking.availability` fails with
`QP-COMPOSE-023`. Equal names in different kinds remain valid. The nested call
spelling never replaces or reinterprets canonical Resource Identity.

Changing `kind` or `name` creates a different Resource. V1 has no Resource
Identity alias. Schema recovery uses the explicit migration rename mapping.
Operation and client identity changes are remove-and-add changes and can break
external callers.

The canonical Compiled Manifest sorts Resources first by Resource Kind byte
value and then by Qualified Resource Name byte value. Origin, activation order,
and source order never participate in this comparison.

### Exact authoring examples

Identity is an explicit factory argument. The variable and path do not supply
defaults:

```ts
// src/data/appointments.ts
import { constraint, defineCollection, field } from "questpie";

export const appointments = defineCollection({
	name: "appointments",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
});
```

The compiler reports a missing or invalid name at the Definition factory call.
It cannot infer `appointments` from the export.

## Ownership

Owner is a role, not a second identity namespace. The Owner of a Resource is the
one establishing Definition for that Resource Identity. The Owner Reference is
therefore the Resource Identity itself. Package, application, file, and export
facts remain Origin.

Exactly one establishing Definition can exist for one Resource Identity. A
second establishing Definition is an ownership collision even when its bytes
are identical or both Definitions come from the same Package. A TypeScript
alias or re-export of one declaration is not a second Definition.

Moving, renaming, vendoring, or republishing the establishing source does not
change Resource Identity. When the current build removes a Package Definition
and supplies one local establishing Definition with the same identity, QUESTPIE
does not force a table drop or invent an Ownership Transfer protocol. Changed
Resource contents still use the normal schema, behavior, and compatibility
gates. Origin records the new source.

Only the establishing Definition can accept Augmentations because acceptance is
written inside that Definition. Owner does not grant Runtime Authority, bypass
Policy, mutate history, add Resource Kinds, or select a collision winner.

A fixed Definition exported by a Package is sealed because the application does
not own its `augmentations` list. QUESTPIE does not provide a target-side patch
or merge escape hatch. The application can vendor the Package composition
locally, deactivate the Package root, and then accept Augmentations in local
source. Because activation is Package-wide, the application must vendor every
Package composition export it still needs.
The normal Package Inventory, collision, schema, and migration gates still
apply; customization cannot silently mutate a Package-owned Resource.

For a nested schema member, the container reference is its containing Collection
identity. The schema artifact records this as `containerIdentity`; it is not a
second Owner namespace. An accepted Augmentation has its own contribution
Origin, but it does not take ownership of the Collection or added members.

## Augmentation

### Owner-accepted value

An Augmentation is a branded, Resource-kind-specific value that proposes
additive members. It has no target. The Owner authorizes it by importing that
exact value and placing it in the owning Definition's `augmentations` list.
This list entry is the Augmentation Contract.

At the application-authored acceptance site, `augmentations` must be a syntactic
array literal. Each entry is one direct value reference or one direct QUESTPIE
`define*Augmentation` call. A variable holding the authored array, spread,
conditional entry, loop result, or widened
`CollectionAugmentation[]` is `QP-COMPOSE-021 nonLiteralAugmentationList`. This keeps the
Resource-local inferred member set equal to the compiled member set.

```ts
// @acme/barbershop-audit/questpie
import { defineCollectionAugmentation, field, index } from "questpie";

export const auditFields = defineCollectionAugmentation({
	name: "acme.auditFieldsV1",
	fields: {
		auditId: field.uuid({ nullable: true }),
		createdAt: field.timestamp({ nullable: true, withTimezone: true }),
	},
	indexes: {
		byAuditId: index({ fields: ["auditId"] }),
	},
});
```

```ts
// src/data/appointments.ts
import { auditFields } from "@acme/barbershop-audit/questpie";
import { constraint, defineCollection, field } from "questpie";

export const appointments = defineCollection({
	name: "appointments",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
	},
	augmentations: [auditFields],
});
```

The accepted contribution identity combines target and Augmentation name:

```text
collection:appointments/augmentation:acme.auditFieldsV1
```

The Compiled Manifest records every accepted contribution identity and its
normalized structural contract digest under the target Resource. The Schema
Projection records only the resulting database structure and excludes
contribution identity. Renaming an Augmentation therefore changes Compiled
Manifest bytes and the Package Inventory, but it does not change Schema Projection
bytes when the projected structure is identical.

The same reusable value can be accepted by more than one Collection.

An Augmentation exported by an active Package but not referenced by an owning
Definition is inert. CLI and Studio can list it as available. It cannot change
the App Contract, Schema Projection, Runtime, or client.

### Boundary

The first tracer accepts Collection Augmentation for Fields, Constraints, and
Indexes. Relations remain deferred to the Relations grill because cross-owner
typed references are not yet accepted. Later Resource kinds must define a
closed Augmentation value in their own vertical. V1 has no generic `patch`,
`merge`, wildcard target, object merge, middleware order, or arbitrary JSON
Augmentation.

A Collection Augmentation cannot replace, remove, or modify a member; change
the target identity, physical table, or options; add Policy or runtime behavior;
publish another Augmentation Contract; or augment another Augmentation.
Policies and Operations remain separate Resources. Their cross-owner attachment
authority is a mandatory decision in their own grills and is not implied by
Collection Augmentation.

The accepted Package Inventory digest covers each exported Augmentation's
identity and normalized structural contract. A Package update that changes its
members blocks until `questpie package accept <package>` shows and accepts that
diff.
Normal schema and migration review still applies after Package Inventory acceptance.

### Two type worlds

Authored Definition types are Resource-local. Because the Owner accepts a
literal tuple of Augmentation values, `defineCollection` can infer the Owner's
members plus the members of those accepted values. Seeds and other structural
consumers therefore see the exact local Collection field contract.

This merge stops at the Resource boundary. A typed reference carries target
identity and the target's small invariant Definition Contract; it does not
recursively pull the target's references or the complete application into the
source type. The generated App Contract remains the only exact source for
application-wide Relation graphs, Operations, context, transport, and client
types.

The implementation must measure the local Augmentation tuple against the
TypeScript instantiation budget. It cannot replace the bounded tuple fold with
ambient augmentation or a recursive whole-application generic.

An Owner Constraint or Index can reference Owner-declared Fields and Fields from
its literal accepted Augmentation tuple. An Augmentation Constraint or Index can
reference only Fields declared by that same Augmentation because the reusable
value has no target context. A cross-contribution composite authored by an
Augmentation remains deferred.

### Resolution and order

The compiler collects every establishing Definition and the Augmentation values
that each Owner accepts. It then establishes the unique Owner, checks member
collisions across the Owner and all accepted Augmentations, validates references
against the complete candidate, sorts contributions by canonical identity, and
emits one resolved Resource.

An Augmentation cannot inspect partial resolved state or branch on another
Augmentation. Two contributions that add the same member collide even when
their definitions are byte-identical. No priority, before/after edge,
activation order, or last-wins rule exists.

## Origin Map

### Purpose and boundary

Origin explains the source of one establishing Definition, accepted
Augmentation, and resolved member. It cannot create identity, ownership,
authorization, precedence, or runtime authority.

The Origin Map is a separate versioned artifact. It uses semantic and
contribution identities as lookup keys, but no semantic artifact contains an
Origin ID, source path, export name, source span, Package version, or Origin Map
Digest. A source relocation can therefore change Origin bytes and the Build
Input Digest without changing Compiled Manifest semantic bytes, Schema
Projection bytes, Migration Plan bytes, or Committed Migration checksums.

### Exact v1 shape

```ts
type ResourceIdentityTextV1 = `${string}:${string}`;

type ContributionIdentityV1 =
	`${ResourceIdentityTextV1}/augmentation:${string}`;

type MemberIdentityV1 = `${ResourceIdentityTextV1}/${string}`;

interface OriginMapV1 {
	format: "questpie.origin-map";
	version: 1;
	buildInputDigest: string;
	packages: PackageResolutionV1[];
	resources: ResourceOriginV1[];
}

interface PackageResolutionV1 {
	id: string;
	name: string;
	version: string;
	resolution: "registry" | "workspace" | "git" | "file" | "link";
	integrity: string | null;
	commit: string | null;
	contentDigest: string;
}

interface ResourceOriginV1 {
	identity: ResourceIdentityTextV1;
	establishedAt: ConstructedOriginV1;
	augmentations: Array<{
		identity: ContributionIdentityV1;
		definedAt: AugmentationOriginV1;
		acceptedAt: SourceLocationV1;
	}>;
	members: Array<{
		identity: MemberIdentityV1;
		contributionIdentity: ContributionIdentityV1 | null;
		declaredAt: SourceLocationV1 | null;
	}>;
}

interface DefinitionOriginV1 {
	kind: "export";
	packageId: string | null;
	path: string;
	exportName: string;
	span: SourceSpanV1 | null;
	declaredAt: {
		packageId: string;
		path: string;
		exportName: string;
		span: SourceSpanV1 | null;
	} | null;
}

type ConstructedOriginV1 =
	| DefinitionOriginV1
	| {
			kind: "callSite";
			location: SourceLocationV1;
	  };

type AugmentationOriginV1 = ConstructedOriginV1;

interface SourceLocationV1 {
	packageId: string | null;
	path: string;
	span: SourceSpanV1 | null;
}

interface SourceSpanV1 {
	start: { line: number; column: number };
	end: { line: number; column: number };
}
```

The string types above describe the lossless separators, not an open semantic
grammar. QUESTPIE validates Resource, contribution, and member identities using
the closed grammar of the corresponding Compiled Manifest Resource Kind. This
lets the diagnostic artifact carry later accepted kinds without changing its
version.

The numeric span values are positive, one-based line numbers and one-based
UTF-16 columns. They match TypeScript editor positions. A Package without
published declaration sources uses its public activation export and sets
`declaredAt` to `null`.

For a local value, `DefinitionOriginV1` records its declaration site and
`declaredAt` is `null`. For a Package value it records the direct activated
Package export; `declaredAt` optionally records one terminal declaration when
that export re-exports a value from another Package. Intermediate barrel chains
do not enter the artifact.

An exported Definition or Augmentation uses the same Origin. An Augmentation
created inline records its call site. A member records the nearest recoverable
syntactic location. A spread or helper-generated member uses `null`; its
contribution or establishing Definition still identifies the source.

`PackageResolutionV1.id` is lowercase SHA-256 over canonical resolution fields
except `id`, prefixed by `questpie-package-resolution-v1\0`, and rendered as
64 lowercase hexadecimal characters. Every non-null `packageId` resolves to exactly one
entry in `packages`.

### Paths and Package data

Application paths are NFC-normalized POSIX paths relative to the application
package. Package paths are NFC-normalized POSIX paths relative to the resolved
Package root. Absolute paths, home directories,
registry credentials, URL query strings, environment values, and source text
are forbidden in the artifact.

For registry resolution, `integrity` is the lockfile integrity value. For Git
resolution, `commit` is the resolved full commit hash. Workspace, file, and
link resolution use `null` integrity and commit unless a Git commit is part of
the actual resolution. Every resolution includes the activation-graph content
digest.

When an activated Package re-exports a Definition or Augmentation from a
dependency, `packageId` records the activated Package and `declaredAt` records
the terminal declaring Package. This does not activate the dependency as an
independent root.

### Canonical bytes and lookup

QUESTPIE encodes `origin-map.json` as RFC 8785 canonical JSON plus one LF.
Package entries sort by `id`. Resource entries sort by Resource Identity.
Augmentations sort by Contribution Identity. Members sort by member identity.

The Origin Map Digest is SHA-256 over those bytes with the prefix
`questpie-origin-map-v1\0`. `build-input.json` records it outside the hashed
`inputs` object. It verifies the diagnostic artifact only; the Compiled
Manifest, Schema Projection, Migration Plan, and Committed Migration
cannot contain it.

CLI joins current Origins to semantic diagnostics by Resource, contribution,
or member identity. A collision has no resolved Resource entry, so the compiler
diagnostic carries all candidate `DefinitionOriginV1` values directly, sorted by
their canonical bytes. Studio reads the same Origin Map and cannot edit it or
use it to resolve a collision.

### Relocation behavior

| Source change                                       | Resource or contribution identity                    | Semantic artifact   | Origin Map                      | Required action                                                         |
| --------------------------------------------------- | ---------------------------------------------------- | ------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| Move a Definition file                              | unchanged                                            | unchanged           | path and span change            | regenerate                                                              |
| Rename an export                                    | unchanged                                            | unchanged           | public export changes           | regenerate                                                              |
| Add or remove a local intermediate barrel re-export | unchanged                                            | unchanged           | unchanged                       | none                                                                    |
| Move a Package activation implementation            | unchanged when public Package Inventory is unchanged | unchanged           | declaration path can change     | accept the changed Package content through the normal dependency update |
| Change Resource `name`                              | changed                                              | remove and add      | changed                         | use the applicable compatibility or migration workflow                  |
| Create a second Definition with the same identity   | collision                                            | no artifact emitted | candidates appear in diagnostic | remove or rename one Definition                                         |

## Collision and diagnostic contract

### Closed v1 codes

Composition diagnostics use the composition-specific structured envelope and
this closed code registry:

| Code             | Class                               | Trigger                                                                                                                          | Exit |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `QP-COMPOSE-001` | `unreachableDefinition`             | A top-level Definition factory call does not reach one direct value export                                                       | 2    |
| `QP-COMPOSE-002` | `duplicateResourceIdentity`         | Two establishing Definitions claim one Resource Identity                                                                         | 2    |
| `QP-COMPOSE-003` | `invalidResourceName`               | Kind or Qualified Resource Name violates the v1 grammar                                                                          | 2    |
| `QP-COMPOSE-004` | `unknownReference`                  | A typed semantic reference has no resolved target                                                                                | 2    |
| `QP-COMPOSE-005` | `packageCompositionNotActivated`    | A Package Definition or Augmentation did not enter through one direct active export in the accepted Package Inventory            | 2    |
| `QP-COMPOSE-006` | `invalidPackageManifest`            | The static Package contract or activation subpath is invalid                                                                     | 2    |
| `QP-COMPOSE-007` | `incompatiblePackage`               | Package framework range does not include the compiler protocol                                                                   | 2    |
| `QP-COMPOSE-008` | `packageInventoryChanged`           | Current exported Package Inventory differs from the accepted digest                                                              | 4    |
| `QP-COMPOSE-009` | `ambiguousPackageInstance`          | More than one physical instance can satisfy one active Package name                                                              | 2    |
| `QP-COMPOSE-010` | `impureStructuralGraph`             | Static or child-process evaluation reaches a forbidden capability                                                                | 2    |
| `QP-COMPOSE-011` | `nondeterministicEvaluation`        | Two required complete compilations produce different structural drafts, semantic artifacts, Origin Map bytes, or generated bytes | 2    |
| `QP-COMPOSE-012` | `structuralImportOfGeneratedOutput` | A structural graph imports `.questpie/generated/**`                                                                              | 2    |
| `QP-COMPOSE-013` | `structuralTypeError`               | A candidate module or structural dependency has a TypeScript error                                                               | 2    |
| `QP-COMPOSE-014` | `augmentationMemberCollision`       | Owner or accepted Augmentations add one member identity more than once                                                           | 2    |
| `QP-COMPOSE-015` | `invalidAugmentation`               | A Resource accepts the wrong Augmentation kind or invalid structural value                                                       | 2    |
| `QP-COMPOSE-016` | `pathNormalizationCollision`        | Two source paths collide after realpath, NFC, or portable case folding                                                           | 2    |
| `QP-COMPOSE-017` | `invalidApplicationRoot`            | `questpie.json` is missing, duplicated, or invalid                                                                               | 2    |
| `QP-COMPOSE-018` | `generatedOutputStale`              | Generated Build Input Digest differs from the current successful compile                                                         | 4    |
| `QP-COMPOSE-019` | `generatedOutputCorrupt`            | Generated file checksum, version, or internal digest is invalid                                                                  | 4    |
| `QP-COMPOSE-020` | `duplicateContributionIdentity`     | One Resource accepts the same Augmentation contribution identity more than once                                                  | 2    |
| `QP-COMPOSE-021` | `nonLiteralAugmentationList`        | An `augmentations` list is not a closed syntactic array literal of direct references or direct `define*Augmentation` calls       | 2    |
| `QP-COMPOSE-022` | `definitionOutsideSourceRoot`       | An application-owned top-level Definition factory call belongs to the Program but is outside the configured source root          | 2    |
| `QP-COMPOSE-023` | `operationProjectionCollision`      | One Operation name is both a leaf and namespace prefix within one generated kind map                                             | 2    |
| `QP-COMPOSE-024` | `operationProjectionUnsafeName`     | An Operation's final name segment is `then` and would make a capability namespace thenable                                       | 2    |

Exit `2` means invalid source, configuration, or composition. Exit `4` means a
reviewed artifact, accepted Package Inventory, or digest must be refreshed. An internal
compiler failure uses exit `1` and cannot masquerade as a registered user
diagnostic.

Every registered composition diagnostic has severity `error`. Codes 008, 018,
and 019 have blocking effect `deploy`; all other registered codes have blocking
effect `fatal`. This mapping is part of v1 and an implementation cannot choose a
different severity or blocking effect.

```ts
type CompositionDiagnosticCodeV1 =
	| "QP-COMPOSE-001"
	| "QP-COMPOSE-002"
	| "QP-COMPOSE-003"
	| "QP-COMPOSE-004"
	| "QP-COMPOSE-005"
	| "QP-COMPOSE-006"
	| "QP-COMPOSE-007"
	| "QP-COMPOSE-008"
	| "QP-COMPOSE-009"
	| "QP-COMPOSE-010"
	| "QP-COMPOSE-011"
	| "QP-COMPOSE-012"
	| "QP-COMPOSE-013"
	| "QP-COMPOSE-014"
	| "QP-COMPOSE-015"
	| "QP-COMPOSE-016"
	| "QP-COMPOSE-017"
	| "QP-COMPOSE-018"
	| "QP-COMPOSE-019"
	| "QP-COMPOSE-020"
	| "QP-COMPOSE-021"
	| "QP-COMPOSE-022"
	| "QP-COMPOSE-023"
	| "QP-COMPOSE-024";

type CompositionDiagnosticClassV1 =
	| "unreachableDefinition"
	| "duplicateResourceIdentity"
	| "invalidResourceName"
	| "unknownReference"
	| "packageCompositionNotActivated"
	| "invalidPackageManifest"
	| "incompatiblePackage"
	| "packageInventoryChanged"
	| "ambiguousPackageInstance"
	| "impureStructuralGraph"
	| "nondeterministicEvaluation"
	| "structuralImportOfGeneratedOutput"
	| "structuralTypeError"
	| "augmentationMemberCollision"
	| "invalidAugmentation"
	| "pathNormalizationCollision"
	| "invalidApplicationRoot"
	| "generatedOutputStale"
	| "generatedOutputCorrupt"
	| "duplicateContributionIdentity"
	| "nonLiteralAugmentationList"
	| "definitionOutsideSourceRoot"
	| "operationProjectionCollision"
	| "operationProjectionUnsafeName";

type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| CanonicalJsonValue[]
	| { [key: string]: CanonicalJsonValue };

interface QuestpieDiagnosticBaseV1 {
	format: "questpie.diagnostic";
	version: 1;
	code: string;
	class: string;
	severity: "info" | "warning" | "error";
	blocking: "none" | "choice" | "deploy" | "fatal";
	identity: string | null;
	origins: ConstructedOriginV1[];
	summary: string;
	expected: CanonicalJsonValue | null;
	actual: CanonicalJsonValue | null;
	recovery: Array<{ description: string; command: string | null }>;
}

interface CompositionDiagnosticV1 extends QuestpieDiagnosticBaseV1 {
	code: CompositionDiagnosticCodeV1;
	class: CompositionDiagnosticClassV1;
	severity: "error";
	blocking: "deploy" | "fatal";
}
```

`blocking` describes progression of build and deployment, not whether the
current request succeeds. A Runtime diagnostic can terminate its current bind
or execution and still use `blocking: "none"` because compiled artifacts and a
later deployment remain valid.

The registry table closes the actual `code` and `class` values; implementations
cannot emit another `QP-COMPOSE-*` value without revising v1. Recovery entries
are in executable order. A diagnostic cannot contain a database URL, registry
credential, environment value, or source text.

`QP-COMPOSE-023` recovers by renaming either Operation so no same-kind leaf is
also a namespace prefix. `QP-COMPOSE-024` recovers by renaming the Operation's
final `then` segment. Both diagnostics have severity `error`, blocking effect
`fatal`, exit `2`, and carry every conflicting or rejected Origin without
secret source.

### Hostile collision matrix

| Case                                                                  | Result                                                                                      | Recovery                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| One local declaration re-exported through two barrels                 | one Definition at its declaration Origin                                                    | none                                                                                 |
| Two factory calls produce one Resource Identity                       | `QP-COMPOSE-002`                                                                            | remove or rename one Definition                                                      |
| Two active Packages establish one Resource Identity                   | `QP-COMPOSE-002`                                                                            | choose compatible versions, deactivate one root, or vendor and rename one Definition |
| Two different Resource Kinds use one Qualified Resource Name          | allowed                                                                                     | none                                                                                 |
| One dotted name is a prefix of another outside one Operation kind map | allowed; exact identity maps preserve both                                                  | none                                                                                 |
| One same-kind Operation leaf is a prefix of another                   | `QP-COMPOSE-023`; no capability declaration is emitted                                      | rename either leaf or namespace                                                      |
| An Operation's final segment is `then`                                | `QP-COMPOSE-024`; no capability declaration is emitted                                      | rename the final segment; non-final `then` remains valid                             |
| Owner and Augmentation add one member identity                        | `QP-COMPOSE-014`                                                                            | remove or rename the contributed member                                              |
| Two Augmentations add one member identity                             | `QP-COMPOSE-014`                                                                            | remove or rename one contribution                                                    |
| The same Augmentation value appears twice in one Owner list           | `QP-COMPOSE-020`                                                                            | keep one acceptance                                                                  |
| The same Augmentation value is accepted by two Owners                 | allowed; two target-qualified contribution identities                                       | none                                                                                 |
| Active Package update changes its public Package Inventory            | `QP-COMPOSE-008`                                                                            | inspect and run `questpie package accept <package>`                                  |
| Active Package cannot resolve or evaluate                             | fatal compile; never a Resource removal                                                     | repair installation or activate a compatible version                                 |
| Inactive Package composition value is imported                        | `QP-COMPOSE-005`                                                                            | run the printed `questpie add` command                                               |
| Active Package re-exports a transitive Definition                     | part of the direct Package Inventory with activated export and terminal declaration Origins | none                                                                                 |
| One Package name resolves to two physical instances                   | `QP-COMPOSE-009`                                                                            | deduplicate or align dependency versions                                             |
| Two paths collide only after filesystem normalization                 | `QP-COMPOSE-016`                                                                            | rename one path                                                                      |
| Semantic names derive one PostgreSQL physical name                    | schema physical-name collision                                                              | set an inline or `questpie.json` physical-name override                              |

## Accepted risks and deferred breadth

- The controlled evaluator is not a security sandbox for hostile dependencies;
  dependency trust remains an application responsibility.
- Executable handler slicing, output materialization, and Runtime Build pairing
  are accepted in ADR-0009. Production implementation remains blocked on the
  connected tracer and later runtime-semantic gates.
- Multiple configured instances of one Package remain deferred because the
  first tracer has no consumer. A future design cannot weaken explicit
  activation, provenance, identity, or Package Inventory review.
- Ergonomic generated-client aliases remain deferred. Exact full-name identity
  maps remain canonical and collision-free. Generated server call maps are
  nested-only and compile only after 023/024 projection safety checks.
