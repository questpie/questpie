# Compiler readiness for `4.0.0-beta.1`

- Status: research evidence; no acceptance or implementation authority
- Date: 2026-08-12
- Scope: discovery/composition, artifacts, schema/migrations, generated App
  Contract, typed Collection Query, and server execution seams
- Revisions inspected: v3 `main` at `9873f08e`; docs-first v4 at `e2b8ed36`;
  Query proof at `d03358b7`

## Finding

The v4 compiler is design-ready, not implementation-ready. Its accepted
contract already closes static composition, Build Input, Compiled Manifest,
Origin Map, Schema and Data Contract Projections, generated App Contract
boundaries, canonical diagnostics, and structural Query bytes. The executable
proofs validate the hardest data/query canonicalization and type-budget choices.

There is also a working first-generation QUESTPIE compiler and server stack in
git history and on `main`, but it is the v3 file-convention codegen architecture.
It proves useful behaviors and contains reusable low-level techniques. It does
not implement the accepted v4 Static Application Compiler or a usable v4 beta
vertical.

The v4 worktree intentionally contains documentation and proofs, not framework
packages. Its root `package.json` has only the `apps/*` workspace. Commit
`48816aa1` removed the v3 packages when it established the docs-first v4
foundation. The executable Query work at `d03358b7` is a golden/type witness,
not compiler, PostgreSQL, server, or generated-client implementation.

Commit `48816aa1` deliberately made this separation: its parent `11617485`
(`v3.26.1`) contains the old packages, while the commit removes them and keeps
the docs application as the executable shell for a docs-first v4 rebuild.
Therefore “compiler v1 is ready” should mean that its first contract is ready to
implement. It must not be reported as an already implemented v4 package, and it
does not need an undiscovered external branch to unblock the beta plan.

## Readiness matrix

| Beta area | Verified implementation evidence | Gap against accepted v4 |
| --- | --- | --- |
| Discovery and composition | `packages/questpie/src/cli/codegen/discover.ts` scans by-type and Feature layouts, ignores private/test files, derives keys, and rejects duplicate discovered keys. `packages/questpie/src/cli/codegen/index.ts` gives every generated target one owner and rejects conflicting output ownership. The focused discovery/codegen run passed 103 tests. | Identity is still commonly derived from filenames, factory strings, exports, and plugin declarations. `packages/questpie/src/cli/commands/codegen.ts` imports executable config and `modules.ts`; `extract-plugins.ts` traverses runtime Module values. This is not `questpie.json`, controlled structural evaluation, explicit Resource Identity/Owner/Augmentation, Package inventory, or the accepted no-runtime-merge composition model. |
| Generated artifacts | Root generation emits `.generated/index.ts`, `names.gen.ts`, `entities.gen.ts`, `context.gen.ts`, `app-factory.ts`, and `factories.ts`; it validates syntax before output, rejects duplicate output paths, recreates the owned output directory, and uses temp-file rename per file. See `packages/questpie/src/cli/codegen/index.ts:726-955` and `template.ts:91-1635`. | No v4 `manifest.json`, `origin-map.json`, `build-input.json`, canonical Build Input Digest, Schema Projection, Data Contract Projection, or canonical diagnostic artifact is emitted. The generated `index.ts` starts the runtime singleton, so artifact generation and runtime binding are not separated as v4 requires. The embedded CRDT manifest is one feature artifact, not the v4 Compiled Manifest. |
| Schema and migrations | `packages/questpie/src/server/migration/generator.ts` derives Drizzle snapshots from `app.getSchema()`, diffs them through `drizzle-kit`, emits reviewed TypeScript/SQL and operation snapshots, and handles non-public schema DDL. `runner.ts` applies each migration transactionally, serializes runners with an advisory transaction lock, and records applied IDs. | The schema source is executable builder/Drizzle state, not canonical Schema Projection v1. Snapshots contain wall-clock timestamps; migrations include `down`; a development `pushSchema` path exists. There is no accepted Migration Plan/Plan Digest, base/target canonical snapshot protocol, migration checksum receipt, Schema Fingerprint, drift comparison, destructive approval by exact digest, or accepted Field/Constraint/Data lowering. |
| Generated App Contract | `template.ts` emits exact `AppCollections`, `AppGlobals`, `AppRoutes`, service keys, `CollectionDoc`, `CollectionWhere`, `AppContext`, session types, and a typed client input `AppConfig`. The checked-in fixture under `packages/questpie/test/types/__fullapp__/.generated/` demonstrates the concrete surface. | The generated declarations retain v3 builders, recursive conditional inference, ambient `Questpie.*` registries, broad `Record`/`any` fallbacks, and Drizzle-facing types such as `DrizzleClientFromQuestpieConfig` and `TablesFromConfig`. They are not generated from the accepted Schema/Data projections and do not satisfy v4 Gate 3's no-ORM/no-ambient-fallback boundary. |
| Typed Collection Query | v3 has typed direct and HTTP-client `find`, `findOne`, `where`, selection, Relation loading, ordering, count, and pagination. SQL is built in `server/collection/crud/query-builders/`; the client surface is in `src/client/index.ts:460-750`. Existing tests cover query execution and hostile ordering/binding cases. | It is an inline generic options object, not a compiled structural Query Template with declared parameters, canonical scope/cursor/dependency bytes, explicit total order, bounded list binding, or forward cursor validation. It supports offset/page and broader v3 Relation/JSON behavior that cannot define the accepted v4 surface. No lowering exists from Data Contract Projection v1 to SQL or generated query code. |
| Server execution seams | v3 exposes the same Collection CRUD through `app.collections`, generated `ctx.collections`, HTTP Collection routes, and `createClient<AppConfig>()`. `CRUDGenerator` owns substantial SQL, transaction, access, Field access, Relation, hook, and error behavior. | No v4 runtime package exists. There is no immutable v4 Execution carrying Principal/Tenant/Authority, no accepted Policy replacement for v3 `access`, no Mutation-owned transaction contract, no generated v4 transport/error contract, and no direct/client parity proof over accepted Query bytes. Copying `CRUDGenerator` would also copy the callback/hooks/Module architecture explicitly rejected for v4. |

## Verified facts worth carrying forward

1. File discovery can be deterministic for a fixed input directory, and
   collision diagnostics can fail before output. The v3 tests exercise these
   cases densely.
2. A generated layer split can expose exact application keys while keeping a
   downward import graph. The v3 `names`/`entities`/`context` split is useful
   implementation evidence even though its types and runtime ownership are not
   the v4 contract.
3. Generated output should be parsed before write, claim every output path once,
   and replace owned output without stale files. These are reusable mechanics;
   whole-build atomic publication and canonical byte equality still need a v4
   proof.
4. The v3 server demonstrates that direct Collection calls, HTTP calls, and a
   typed client can share query and write behavior. Its tests are candidates for
   behavior extraction after Policy and Mutation ownership are accepted.
5. The v3 migration runner contains useful PostgreSQL concurrency evidence:
   one transaction per migration plus an advisory transaction lock avoids a
   duplicate application race. It does not replace the accepted v4 artifact and
   receipt protocol.
6. The proof worktree verifies the accepted Data/Query byte and type model:
   `query-grammar-goldens.mjs` passes and the TypeScript witness reports 2,666
   Types and 5,770 Instantiations. It does not execute SQL or generate an
   application.

## Concrete beta gaps

The compiler path needed for a usable beta has accepted contracts or focused
proofs for several nodes, but no v4 production implementation yet joins these
links:

```text
questpie.json + controlled Definitions
  -> normalized owned Resources
  -> Compiled Manifest + Origin Map + Build Input
  -> Schema Projection + Data Contract Projection
  -> migration plan/apply/drift artifacts
  -> concrete v4 App Contract
  -> structural Query lowering and binding
  -> PostgreSQL execution
  -> direct API + generated network client
```

The accepted docs and Query proof specify several nodes, but no v4 code joins
them. Policy and minimal Mutation/transaction behavior are additionally open,
so safe server execution cannot be declared ready merely because the v3 CRUD
engine exists.

## Recommendations for the beta decision map

These recommendations do not accept an API or authorize implementation.

1. Treat v3 as three separate evidence sources: discovery/output mechanics,
   PostgreSQL/CRUD failure cases, and user-facing ergonomics. Do not treat its
   Module graph, codegen plugins, builders, generated ambient registries,
   `access`, hooks, or `CRUDGenerator` as a v4 base layer.
2. Define compiler readiness as one thin artifact-to-execution tracer, not as
   “codegen exists.” The tracer must compile one Collection into the exact
   accepted Manifest/Schema/Data bytes, emit its concrete App Contract, plan and
   apply one migration, and execute one accepted structural Query directly and
   through the generated client.
3. Close only the minimum Policy and Mutation/transaction contracts needed to
   make that tracer safe. Keep hooks replacement, Live Query, dispatch, Studio,
   Auth integrations, and broader Operations outside this compiler milestone.
4. Reuse v3 tests by translating guarantees one at a time. Good early
   candidates are discovery permutation/collision, generated-key exactness,
   stale-output removal, migration concurrent-runner behavior, SQL value
   encoding, unresolved-order rejection, and direct/client result parity.
5. Add a v4 compiler proof agenda before runtime work: canonical artifact
   goldens, relocation/permutation determinism, no-partial-output failure,
   generated declaration type budget, Schema/Data cross-projection validation,
   migration receipt retry, and one PostgreSQL Query conformance fixture.

## Evidence and commands

- v3 implementation inspected at commit
  `9873f08eacd0565fb6b462a5196e90bfcc0295fb` in
  `/home/drepkovsky/code/questpie`.
- v4 docs-only baseline inspected at commit
  `e2b8ed364fcdb1d1603cf6052fad7a26f8bd0a98` in
  `/home/drepkovsky/code/questpie-v4`.
- Accepted Query proof inspected and executed at commit
  `d03358b749c4c8efb769d1c0fed50e8fbf983fb0` in
  `/tmp/questpie-v4-query-grammar-proof-019ff19f`.
- `git show --stat 48816aa1` verifies that the docs-first foundation removed
  the previous framework packages.
- `bun test packages/questpie/test/codegen/smoke.test.ts packages/questpie/test/codegen/discover.test.ts`
  passed: 103 tests, 0 failures, 237 assertions.
- `bun docs/v4/prototypes/query-grammar-goldens.mjs` passed.
- `bun /home/drepkovsky/code/questpie-v4/node_modules/typescript/bin/tsc -p docs/v4/prototypes/query-grammar-types/tsconfig.json --extendedDiagnostics`
  passed: 2,666 Types, 5,770 Instantiations, 25,434K memory, 0.33 seconds.

The main worktree already contained unrelated modified marketing files and an
untracked `--full-page` file. The v4 worktree already contained the accepted
chapter projection and parallel beta research. This audit did not modify any
of them.
