# Compiler source reads after PostgreSQL driver import

The integrated release lane exposed another source-loading failure in Bun
1.3.14. The application bundle already read physical source files through the
compiler's loader, but the structural evaluation build still used Bun's default
reader. Under `bun test`, importing `pg` before compiling both reference
applications left that structural reader using unavailable cached descriptors.

## Red and repair

The existing loaded-source regression was extended to compile Collaboration
and Team Support Desk after a static `pg` import. Before changing structural
evaluation, Collaboration passed and Team Support Desk failed with
`Unexpected reading file` for `pg/esm/index.mjs` (1 pass, 1 fail). The existing
application-bundle source reader was already present in this red run.

Both Bun build sites now use one private compiler source-reading policy. It
reads physical JavaScript, TypeScript and JSON bytes freshly for each build,
preserves Bun's extension-inferred loaders, and does not intercept virtual
namespaces. The existing resolver rules, structural validation, isolated
evaluation, executable-slot handling, canonicalization and artifact generation
remain their existing owners. There is no retry, version switch, fallback,
driver-specific exception or test detection.

## Verification

```sh
bun test --timeout=15000 tests/integration/compiler-loaded-source.test.ts tests/integration/deep-dx-query-authoring.test.ts
bun test tests/hostile/beta01-compiler-hostile.test.ts --test-name-pattern 'rejects generated structural values|validates the transitive Package graph|keeps runtime-only imports|uses declaration Origins'
bun run --cwd packages/compiler types:check
bun run lint --deny-warnings packages/compiler/src/build-source.ts packages/compiler/src/discovery.ts packages/compiler/src/runtime/application-bundle.ts tests/integration/compiler-loaded-source.test.ts
bun run architecture:check
git diff --check
```

The original Query-authoring cases and both loaded-driver consumer compiles
pass: 4 tests, 23 assertions. The focused structural hostile cases pass:
4 tests, 11 assertions. They preserve generated-import refusal, ambient-registry
refusal, impure-structure refusal, executable-only Service imports, declaration
Origins and traversal-order independence. Compiler strict typecheck,
warning-denying lint, formatting, architecture and whitespace checks pass.

The complete sorted Collaboration `generatedFiles` map was hashed before the
repair and compared afterward, including filenames and every content byte.
All 56 generated files are unchanged. No artifact golden was updated.

The 15-second integration timeout is the existing repository quality-lane
setting. An initial direct invocation used Bun's unrelated 5-second default
and timed out during typechecking; it is not a passing verification result.
The repository timeout and all production limits are unchanged.

This is a compiler correctness repair and deterministic regression evidence,
not formal acceptance of ADR-0043 or a release verdict. The parent integrated
lane owns full quality and release verification. No database connection or
credential was needed for these compiler tests.

## Discovered structural entry imports

After the Team Support Desk domain-folder move, the original-fixture lifecycle
test and loaded-driver Team Support Desk compile failed before structural
evaluation. Bun reported four existing absolute imports as unresolved:
`src/demo-ids.ts`, `src/demo-seed.ts`, `src/execution.ts`, and
`src/identity-seed.ts`. Compiling copied fixtures or calling the compiler outside
`bun test` did not reproduce that failure.

A failing Linux syscall trace of `openat` and `getdents64` showed the directory
listing reporting all four as regular files and compiler validation successfully
opening them. The Bun bundler then tried opening those exact `.ts` paths with
`O_DIRECTORY`, received `ENOTDIR`, and rejected their imports. A broader trace
changed the timing and passed; that successful trace is not negative evidence.
An exploratory source-build warm-up also avoided the failure, but no warm-up or
retry was retained.

The first structural repair resolved only its compiler-generated entry imports
from the exact already-discovered source-path set. Both entry-importer identity
and exact path membership must match. The returned path is unchanged: no
extension search, normalization, candidate synthesis, or general resolution
fallback was added. Authored relative imports, package imports and virtual
factories retained their existing rules. Structural validation, lowering and
isolated evaluation remained unchanged.

The pre-existing direct lifecycle and loaded-source tests reproduce the defect
without mocks; the direct lifecycle test changes from unresolved-import failure
to 1 passing test / 31 assertions after the repair. The temporary diagnostic
test was deleted. No fixture source, generated artifact or accepted authority
was changed by this compiler repair.

```sh
bun test --timeout=15000 tests/integration/compiler-loaded-source.test.ts tests/unit/adr0031-lifecycle-compiler.test.ts
bun test --timeout=15000 tests/hostile/beta01-compiler-hostile.test.ts --test-name-pattern 'rejects generated structural values|validates the transitive Package graph|keeps runtime-only imports|uses declaration Origins'
bun node_modules/typescript/bin/tsc -p packages/compiler/tsconfig.json --noEmit
bun run lint --deny-warnings packages/compiler/src/discovery.ts
bun run format:check packages/compiler/src/discovery.ts docs/v4/prototypes/static-job-schedules/COMPILER-SOURCE-READ-EVIDENCE.md
bun run architecture:check
git diff --check
```

Both direct consumer compiles and the complete lifecycle compiler suite pass:
20 tests / 91 assertions. The focused structural hostile cases pass:
4 tests / 11 assertions. Compiler strict types, warning-denying lint, formatting,
architecture and whitespace checks pass. These runs use the existing
15-second ordinary-test timeout and change no test or production limit.

## Authored local imports after earlier client builds

The integrated ordinary suite exposed a remaining boundary: after the generated
Query Resource tests, compiling Team Support Desk rejected all six authored
`./demo-ids` or `../demo-ids` imports. The target remained a regular, unchanged
tracked source file. The generated-entry binding above did not own these
authored edges.

The same failure reproduced in an isolated worktree: first with the 27-file
ordinary prefix, then its last 13 files, then just these two retained suites:

```sh
bun test --timeout=15000 tests/integration/qri01-generated-query-resource.test.ts tests/integration/compiler-loaded-source.test.ts
```

Before the repair, that pair passed 15 tests and failed the Team Support Desk
compile with the six unresolved imports. Loading fixture modules, repeated
compiles, copied-fixture cleanup, and a client build added after the first
application compile did not reproduce it alone. Those exploratory probes were
not added to repository tests or production code. No further claim about Bun's
internal cache mechanism follows from this reduction.

The structural build now binds authored relative imports through the same
`resolveSourceModule` owner already used for structural validation. Both the
importer and resolved target must belong to the exact evaluated source-path
set, and Bun's existing synchronous resolver must agree with that target. The
agreement guard matters: the inherited validation search prefers `.ts` to
`.tsx`, whereas pinned Bun selects `.tsx` when both exist. This repair does not
change validation's search or choose between ambiguous candidates. When the
resolvers disagree or Bun cannot resolve the edge, ordinary bundler handling
remains in force. The generated-entry binding is retained; package names,
virtual factories, authored absolute imports, and imports outside that set keep
their existing handling. This adds no second resolution algorithm, retry,
warm-up, or general resolution fallback and does not bypass source validation,
lowering, or isolated evaluation.

The unchanged two-file sequence passes all 16 tests / 72 assertions after the
repair. A retained structural-evaluation regression first failed by selecting
`.ts` instead of `.tsx`; with the agreement guard it and directory-only and
explicit-extension controls pass. Running those controls with the original
pair passes 19 tests / 75 assertions. The 13-file sequence's compiler consumers
also pass, but that run is not a full PASS: an unrelated existing Action test
with a 5ms duration failed while testing non-settling Service disposal.
The four existing structural hostile cases above pass with 11 assertions;
compiler strict types, warning-denying lint, formatting, architecture, and
`git diff --check` also pass.

In the same plain-process context, all 59 Team Support Desk artifact paths and
bytes are identical before and after the repair. A separate comparison before
the agreement guard against mixed `bun test` compilation found different
dependency chunk identities; the same-context comparison did not explain or
justify that difference, and no golden was refreshed.

After adding the agreement guard, the exact 13-file sequence passes: 48 tests,
two already-registered gated skips, zero failures, and 256 assertions in
208.20 seconds. Comparing its Team Support Desk output immediately afterward
against the original plain-process baseline finds all 59 artifact paths and
bytes identical. The final three-file run above also matches that baseline.
Tiny conditional-package controls preserve distinct import/require identities,
and a two-version PostgreSQL graph preserves both installed versions in plain,
host-loaded, and `bun test` contexts. These results qualify the final repair's
output in the observed contexts; they do not establish an internal Bun cache
cause for the earlier difference or justify a package-resolution workaround.

The existing 15-second ordinary-test timeout and all production limits remain
unchanged. This is candidate compiler evidence, not a release verdict or formal
acceptance of ADR-0043.
