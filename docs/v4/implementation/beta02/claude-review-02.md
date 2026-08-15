# BETA-02 replacement implementation review 2

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `62de1be45bf05845a2bea373b6ca2eac201f8556`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

```text
VERDICT: BLOCKED

The migration/Seed spine itself is strong: canonical Plan/Committed-Migration bytes, digest-bound destructive acknowledgement, one transaction per migration with an in-transaction receipt, session-pinned advisory locking with real cancellation, catalog-compared drift, immutable dependency-ordered Seeds with attempt events, and genuine PostgreSQL 17 evidence for the seven named hostile cases. The blockers below are narrower, but each is a concrete deviation from accepted authority or from a gate this slice itself authors.

## Blockers

### 1. The architecture ratchet grandfathers a violation this slice created
`quality/code-architecture.json` ships with `"packages/compiler/src/model.ts": 961` in the shrink-only `legacy` map, and `scripts/code-architecture.ts` therefore passes.

`.agents/skills/questpie-v4/references/codebase.md` — added in this same change — defines the rule as: "New production files above 800 lines fail quality checks. Existing files above 800 lines live in the shrink-only baseline." `model.ts` was well under 800 at the diff base; the `projectManifest` rewrite, `physicalName`, `boundConstraints`, and the global physical-name validation loop push it to 961. The slice authors a gate and simultaneously exempts its own new violation, which also weakens the `quality:full` PASS as evidence. The repair note claims "newly introduced schema and PostgreSQL monoliths are split into <=800-line domain modules" — `model.ts` was not.

Required repair: split `packages/compiler/src/model.ts` along the seams already established under `schema/` (physical-name derivation and member validation, schema projection, data projection are separate reasons to change) and delete the legacy entry — or, if the entry is kept, state explicitly which pre-existing head measured 961 lines.

### 2. `migration apply` does not honour the accepted partial-failure result contract
`packages/compiler/src/schema/postgres/apply.ts` iterates `pending` and lets any failure propagate, so the identities that already committed in this invocation are lost.

`docs/v4/schema-lifecycle.md` §7 is explicit: "If migration N fails after earlier pending migrations committed, QUESTPIE releases the session lock in `finally` and returns the applied identities, failed identity and diagnostic, and remaining identities with exit `4` for a protocol/drift block or `5` for SQL failure. A retry begins from the new receipt head and never reruns the committed prefix."

Retry-from-head works, and the lock is released, but an operator or deploy tool cannot learn what committed. `explainMigrationApply` has no failure projection either, so the required operational visibility is absent from both the API and the goldens.

Required repair: return the structured partial result (applied / failed + diagnostic / remaining) on mid-chain failure, add a failure branch to `explainMigrationApply` with a golden, and cover a two-migration chain whose second migration fails after the first commits.

### 3. Unregistered diagnostic codes reach durable state; registered ones are unreachable
- `packages/compiler/src/seed/postgres/apply.ts` writes `error_code: String(error.code)` for non-drift failures. For a driver error that persists `ERR_POSTGRES_SERVER_ERROR` into the append-only `questpie_internal.seed_attempt_events`. ADR-0006 and the §5 registry make `QP-SEED-*` a closed set; a raw Bun/PostgreSQL code is not a QUESTPIE diagnostic and cannot be joined to the recovery renderer.
- `QP-SEED-011 seedInsertConflict` is registered but never emitted: a Seed insert conflict surfaces only as the raw driver error.
- `QP-SCHEMA-026 baseDrift` / `QP-SCHEMA-027 targetDrift` are never emitted. Genesis base drift is reported as `fail("QP-SCHEMA-028", "baseDrift", ...)` in `apply.ts`, pairing a class with the catalog-drift code, and the Seed runner's `["QP-SCHEMA-026","QP-SCHEMA-027","QP-SCHEMA-028"]` blocked-classification branch is partly dead as a result.

Required repair: map insert-conflict (SQLSTATE `23505` on an insert step) to `QP-SEED-011`, normalise every persisted `error_code` to a registered `QP-*` value (or `null`) before writing the event, and emit `QP-SCHEMA-026`/`027` for base and target drift respectively. Add a Seed insert-conflict hostile case that asserts both the returned code and the stored event.

## Non-blocking observations

- **No command surface for the accepted lifecycle.** `docs/v4/schema-lifecycle.md` §10 defines `questpie migration plan|create|apply|dev`, `schema drift`, `seed status|run`, the `.questpie/plans/$PLAN_DIGEST.json` handoff, `--accept-destructive`, `--format json`, and exit codes `0/2/3/4/5`. This slice delivers library functions plus `renderCliExplanation` only; `package.json` gains no command wiring. The digest is still recomputed and enforced in `createCommittedMigration`, so the safety property holds, but the reviewed plan-file handoff and exit-code contract remain undelivered. Worth confirming whether a later BETA issue owns them.
- **`constraint.check` is far narrower than the documented grammar.** `packages/questpie/src/check-expression.ts` accepts only `greaterThan` between two same-typed ordered Fields; `CheckExpressionV1` and the naming audit describe comparisons, `and/or/not`, `isNull/isNotNull`, and `textLength`. It fails closed in TypeScript and the collaboration fixture needs no authored check, so this is under-delivery rather than an unsound surface. The proxy also makes an inline leaf literally named `greaterThan` unaddressable (`fields.address.greaterThan(...)` binds `address`), which then fails as `QP-SCHEMA-003` — fail-closed, but worth a diagnostic that names the ambiguity.
- **`SchemaFingerprintV1.observations` gained undocumented members.** `databaseEncoding`, `binaryCollationProvider`, and `binaryCollationDeterministic` are required by the §2 provider-gate prose but are not in the §8 interface listing in `docs/v4/schema-lifecycle.md`. They stay outside the digest, so no artifact bytes move; the doc should still be projected.
- **Provider-delta class fidelity.** A missing required extension or unsupported major reports class `providerMismatch` (`QP-SCHEMA-007`) rather than `missingExtension` / `unsupportedPostgres` / `incompatibleExtension`. Untested because the fixture declares zero extensions.
- **`unplannedDesiredChange` (current vs committed) is not implemented.** `inspectSchemaFingerprint` covers only applied-head vs database.
- **`withPinnedTransaction` rollback can mask the original error.** `await sql.unsafe("ROLLBACK")` in the catch is unguarded; on a dead connection the rollback failure replaces the real diagnostic.
- **The fingerprint is expected-shaped rather than independently parsed.** `assertSchemaMatches` builds the returned `comparable` by spreading the expected object and overriding a few observed fields. It is gated by exact catalog equality first, so the digest is sound today, but any future comparison gap silently becomes a digest gap. A catalog-first parser with equality as a separate step would be more robust.
- **Scope.** The slice implements the full ADR-0008 Field family (inline shapes, closed JSONB object/array, tagged open JSON, bigint/numeric/date), inverse `toMany`, and the generated `AppData` contract. The collaboration tracer itself was not widened (uuid/text/timestamp, one PK per Collection, unique, FKs, one B-tree Index), and ADR-0008 is named issue authority, so this reads as projecting accepted authority rather than widening the tracer — but it is materially more than the issue's stated schema and is worth calling out against the "do not widen" instruction.
```
