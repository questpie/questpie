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
