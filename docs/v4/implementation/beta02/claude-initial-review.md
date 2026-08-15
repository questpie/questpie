# BETA-02 initial implementation review

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `edaabc839914803dd18d2f6cdb6814f254073f5d`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

```text
VERDICT: BLOCKED

## Blockers

### 1. `bigint` bound invariants can never pass Schema Fingerprint verification

`packages/compiler/src/schema/postgres-ddl.ts` renders a bigint bound as the accepted form `CAST('10' AS pg_catalog.int8)` (proved by `tests/unit/beta02-migration-plan.test.ts` "renders canonical bigint bound SQL"), but the expected-catalog deparser in `packages/compiler/src/schema-postgres.ts` (`renderFingerprintExpression`) has no operand typing and emits every string literal as `'10'::text`. PostgreSQL deparses the applied constraint as `x >= '10'::bigint`, so `expectedConstraintDefinition` never matches.

Consequence: any Collection authored with `field.bigint({ minimum })` / `{ maximum }` — a surface this slice ships end to end (authoring in `packages/questpie/src/index.ts`, invariant projection in `model.ts`, classification in `migration-classification.ts`, DDL rendering, snapshot golden) — fails `assertSchemaMatches` inside the migration transaction with `QP-SCHEMA-028` and can never be applied. This directly contradicts `docs/v4/schema-lifecycle.md` §5: "the SQL renderer emits `CAST('<value>' AS pg_catalog.int8)`, and the catalog parser maps that cast back to the canonical string."

No evidence covers the path: `tests/integration/postgres/beta02-migration-restart.test.ts` "stores and fingerprints every foundational Field family" uses `{ minimum: null, maximum: null }`, so the only bigint bound coverage is a pure SQL-render unit test.

Repair: carry the referenced Field's codec into `renderFingerprintExpression` (as `renderPostgresCheck` already does) and emit `'…'::bigint` for int8 operands; add a PostgreSQL golden that applies, fingerprints and restarts a Collection with both bigint bounds.

### 2. The accepted fail-closed collation/encoding provider gate is not implemented

`providerObservations` in `packages/compiler/src/schema-postgres.ts` verifies only `server_version` major, `datcollate`, `datctype` and required-extension presence. `docs/v4/schema-lifecycle.md` §2 requires, "Before planning, applying, drift comparison, or Query execution, QUESTPIE resolves that collation, requires `collprovider = 'c'` and `collisdeterministic = true`, and requires UTF-8 database encoding. It fails closed." (`docs/v4/data-model-and-query-grammar.md` §9 repeats it.) Nothing resolves `pg_collation` for `C` with its provider/determinism, and database encoding is never read; the `externalDependencies` loop only proves a collation named `C` exists in `pg_catalog`, and only after DDL.

Since `questpie.binary` is the foundational text-equality/ordering/key/cursor semantics and managed-provider conformance is a named gate, this is a portability and authority gap in exactly the vertical that owns apply and drift.

Repair: extend `providerObservations` with the `pg_collation` provider/determinism check and a `pg_encoding_to_char(encoding) = 'UTF8'` check, reported as `QP-SCHEMA-007`, called before bootstrap in both `applyCommittedMigrations` and `inspectSchemaFingerprint`; add a negative control.

### 3. Required BETA-02 performance and release evidence is missing

Issue #289 "Performance ownership" names two deliverables: the migration baseline measurement manifest and a **stable-runner budget report**. The packet delivers `quality/performance/beta02-migration.json` and `quality/baselines/beta02-migration.json` whose observed values are local (`"postgres": "local Docker postgres:17"`, `planCreateMs 4.3`), and no stable-runner report exists.

`bun run quality:release` was also not run, although this change (a) adds the repository's first BETA-02 performance manifest, which per ADR-0020 and Gate 10 is validated only by the release lane, and (b) changes published `questpie` package exports (`shape`, `value`, `seed`, `defineSeed`, `relation.toMany`, the `relationRef` overload, `DataFieldDescriptor`, `TaggedJsonValue`, `InverseRelationDefinition`). `CONTRIBUTING.md` makes the release lane mandatory for export/declaration/packaging and performance-manifest changes. The reported verification set is `check:changed`, focused schema tests, `quality:full`, `test:postgres`, `git diff --check` only.

Repair: run and report `bun run quality:release`, and produce the stable-runner budget report the issue requires (or state explicitly why the manifest budget is provisional and record that in the manifest/baseline).

## Non-blocking observations

- **Genesis classification is internally inconsistent.** `createSteps` marks `addIndex` `safe` but `addConstraint` `guarded` on the same brand-new tables. Both readings of `schema-lifecycle.md` §5 are arguable (the examples table says "index on an empty new table" is safe; the closed matrix says "add check, unique, Relation/foreign key, or Index" is guarded), but the two members should be classified by one rule. The overall plan class (`guarded`) is unaffected.
- **Semantic-only renames commit a zero-step migration with an empty `up.sql`.** The behavior looks necessary (the applied head's target digest must track the new identities, or desired-vs-committed drift becomes unresolvable), but it conflicts literally with "it never creates a zero-change Committed Migration" and with "The file ends with one LF." Reconcile the artifact-byte rule in authority rather than leaving the deviation implicit.
- **`constraint.check` is absent from the public `questpie` surface** even though `schema-lifecycle.md` §2 lists it as one of three v1 Constraint constructors and the projection/renderer already support check expressions. The collaboration fixture cannot express `endsAt > startsAt`.
- **No diagnostic envelope.** `CompilerDiagnosticError` carries only `code`, `diagnosticClass`, `message`, `details`. §5/§8 require `comparison`, `class`, semantic identity, `physicalName`, `containerIdentity`, expected/actual canonical fragments, Origin, next commands, `severity`, `blocking`, plus exit codes and `--format json`. Provider failures also always report class `providerMismatch` instead of `unsupportedPostgres` / `missingExtension` / `incompatibleExtension`.
- **No CLI commands and no plan handoff file.** There is no `questpie migration plan|create|apply|dev`, no `.questpie/plans/$PLAN_DIGEST.json`, and `compileApplication` returns `committedSeeds` but nothing writes `questpie/seeds/**` — the committed fixture artifacts have no reproducing command. The explain goldens are produced by a library function, not a CLI.
- **Drift is not read as one snapshot.** `inspectSchemaFingerprint` issues many introspection statements over a fresh pool (and the post-commit verification runs in autocommit on the session). §11 specifies "read-only snapshot" for drift verification; use one reserved connection in a single transaction.
- **`acquireSessionLock` leaks a 1 ms `lock_timeout`.** In the signal path, after the polling deadline it sets `lock_timeout` to `'1ms'` and issues a blocking `pg_advisory_lock`. If that attempt wins the race, the session keeps `lock_timeout = 1ms` for all subsequent DDL, which can spuriously abort a migration with `55P03`.
- **Expected deparse is `search_path`-sensitive.** Foreign-key expectations hard-code `schema.table` qualification and check expectations rely on `pretty = true` paren elision. If a deploy role's `search_path` contains the application schema, `pg_get_constraintdef` drops the qualification and drift falsely trips. Pin `search_path` explicitly for introspection.
- **Architecture ratchet is out-of-slice and self-exempting.** `scripts/code-architecture.ts`, `quality/code-architecture.json`, the `full` lane step and `.agents/.../codebase.md` are repository-quality scope owned by ADR-0020/#22, while HANDOFF instructs implementing #289 "without widening its schema/migration/Seed tracer." The three modules created or grown in this same change (`schema-postgres.ts` 1570, `schema.ts` 1397, `model.ts` 961) are entered into the shrink-only `legacy` baseline, exempting them from the 800-line rule the ratchet introduces. `schema-postgres.ts` also mixes bootstrap SQL, catalog introspection, expected deparse, locking and the apply protocol, and `seed-postgres.ts` imports it directly rather than through a domain seam — both against the `codebase.md` guidance added here.
- **Fingerprint comparison is piecewise, not canonical-byte equality.** §8 specifies "exact canonical JSON equality between this expected comparable value and the live fingerprint's `comparable` value"; the implementation compares tables/columns/constraints/indexes separately and then reconstructs the observed comparable from the expected objects. Coverage of the represented objects looks complete, but `expectedComparable` also derives `applicationSchemaExists` from `collections.length > 0`, which is wrong for a non-empty schema with zero Collections and is only harmless because whole-value equality is never asserted.
- **Seed insert conflict is unregistered.** A conflicting `seed.insert` rethrows the raw driver error and stores `ERR_POSTGRES_SERVER_ERROR` in `seed_attempt_events.error_code`; `schema-lifecycle.md` registers `QP-SEED-011 seedInsertConflict` for this case.
- **`semanticComparable` rewrites any string matching a rename prefix**, including literal default values, not just identity references.
```
