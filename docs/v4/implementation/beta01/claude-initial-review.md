# BETA-01 initial implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `2c4d2c1100ff72a463a6110d7e458a4e76221f2e`
- Reviewed head: `78a08b1eec8bd0c9459a76157171ac0425e4e23a`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

```text
VERDICT: BLOCKED

The slice compiles, produces canonical artifacts, and the recorded verification is real (goldens, hostile suite, measured budgets, tarball inspection). But several pieces of production compiler code are specialized to the fixture or diverge from the accepted composition contract in ways the supplied tests cannot detect.

## Blockers

### B1. `#questpie/package` is a hardcoded, fixture-named, inert stub

`packages/compiler/src/artifacts.ts` emits a literal key `internal/package-contracts/collaboration-audit.ts`. `renderPackageContract()` takes no input and emits all seven factories as `(definition: never) => never` plus an empty `PackageData`. The artifact is fixture-named, emitted unconditionally, cannot cover multiple Packages, does not specialize a sealed Package contract, and the host-leak test passes only because its parameter is `never`.

Repair: derive the Package contract path and content from each resolved active Package and its inventory; emit one contract per active Package; make the host-leak test prove a Package-owned Resource resolves while a host-only Resource does not.

### B2. Barrel re-export makes Origin order-dependent

`evaluateModules` dedupes Definition values with a `seen` WeakSet across visited module records, so the recorded path/export is whichever module is visited first. Reverse traversal changes it. A barrel re-export therefore causes a false `QP-COMPOSE-011` or unstable Origin.

Repair: resolve the declaration site through the TypeScript checker (or record only the declaring module) and add a barrel hostile case.

### B3. Package structural validation covers only the activation entry file

`packageSourceFiles(entry)` returns only the entry. A sibling re-export can import generated host values without validation. `moduleGraphDigest` likewise covers only the entry instead of the complete activation graph.

Repair: walk the reachable graph from the activation subpath for validation and hashing, including the framework graph.

### B4. Build Input does not pin the TypeScript configuration that governs compilation

Only the root `tsconfig.json` bytes are hashed; reachable `extends` and project references are omitted. Typechecking ignores the application config and synthesizes private compiler options.

Repair: hash the resolved config graph and derive current-contract typechecking from the application configuration.

### B5. Controlled structural evaluation has neither isolation nor purity enforcement

The compiler bundles source and imports it in-process. There is no child-process restriction or `QP-COMPOSE-010`, and forbidden imports/globals, environment, clock, random, network, subprocess and filesystem access are not rejected.

Repair: move evaluation into the specified restricted child process and add forbidden-capability scanning plus a negative-control test.

## Non-blocking observations

- The diagnostic registry/envelope is partial and qualified Resource Name grammar is not yet validated.
- `postgres.minimumMajor` is fixed to exactly 16 even though later gates target PostgreSQL 17.
- `postgres.physicalNames` keys are not yet resolved against compiled targets.
- The fixture lockfile is a small synthetic fixture lockfile.
- Workspace Package resolution is directory-shaped rather than general registry `exports` resolution.
- The determinism comparison is narrower than the full accepted comparison and does not itself use a second synthetic checkout root.
- `.questpie/` is not ignored.
- Empty app/Package executable kinds are emitted as `never`; absent beta APIs need explicit scope treatment.
- `GeneratedQueries` evidence is mostly load-bearing through exact `ctx.data` typing.
- `client.ts` does not yet include later BETA-05 context scoping.
- Build Input goldens will deliberately change with compiler/framework inputs.
- Later build-spec test directories are not all materialized in BETA-01.
```
