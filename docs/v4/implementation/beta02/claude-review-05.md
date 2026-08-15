# BETA-02 replacement implementation review 5

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `e151b74847f1206a48e8efc29f5274092513c6a3`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

````text
VERDICT: BLOCKED

## Blockers

### 1. Canonical artifact bytes are not RFC 8785, and the deviation is now locked in by a test

`packages/compiler/src/canonical.ts` (`arrayIndex`, `compareCanonicalObjectKeys`) and `tests/unit/beta02-canonical-bytes.test.ts`.

`docs/v4/schema-lifecycle.md` §4 and ADR-0006 state that **all** artifact JSON uses "RFC 8785 JSON Canonicalization Scheme bytes plus one final LF". RFC 8785 §3.2.3 sorts *every* property name by UTF-16 code units. The new writer instead hoists array-index-like keys and orders them numerically:

```
canonicalArtifactBytes({ "2": "two", "10": "ten", a: "letter" })
// emitted : {"2":"two","10":"ten","a":"letter"}
// RFC 8785: {"10":"ten","2":"two","a":"letter"}
```

This is reachable today through `field.json` in a Seed (`{ kind: "json", value: { "0": …, "10": … } }`), so Seed `stepsDigest` and Seed checksum bytes diverge from any conformant JCS implementation. That defeats the stated purpose of naming RFC 8785 (independently verifiable, reviewable artifact bytes) and redefines an Accepted artifact contract without a recorded supersession.

The "preserve legacy bytes" justification does not apply here: no committed golden in the repo contains an integer-like object key, so making the writer conformant changes zero committed artifacts. The new test asserting the non-conformant order makes the deviation permanent.

Required repair (either, explicitly):
- sort all object keys by code unit (`compareAscii` for every key), drop `arrayIndex`/`compareCanonicalObjectKeys`, and invert `beta02-canonical-bytes.test.ts` into a conformance test that pins RFC 8785 ordering; or
- record an accepted supersession replacing "RFC 8785" with the exact QUESTPIE ordering rule in ADR-0006, `docs/v4/schema-lifecycle.md` §4, `docs/v4/data-model-and-query-grammar.md` §11/§12, and the public MDX, and state the compatibility effect on digests.

Same file, same contract clause: the encoder must "reject … lone Unicode surrogates". `canonicalBytes` never checks for them, and `normalizeOpenJson`'s NFC check passes a lone surrogate unchanged, so an unpaired `\uD800` is silently escaped into artifact bytes. Add the surrogate-pair validation (or amend the contract in the same supersession).

## Non-blocking observations

- **`applicationSchemaExists` is inferred from `collections.length`.** `schema/postgres/expected-fingerprint.ts` treats any projection with zero Collections as Genesis. A legitimate "drop every Collection" migration produces a non-Genesis projection with zero Collections, and its target-fingerprint check would then expect `applicationSchemaExists: false` against a live schema that exists → false `QP-SCHEMA-027 targetDrift`. The planner already handles that shape (`beta02-migration-classification.test.ts` "does not recreate the application schema after an empty applied head"), so the two halves disagree. `docs/v4/schema-lifecycle.md` §8 has the same hole; worth closing both.
- **Drift diagnostics are stubbed.** `schema/postgres/apply.ts::schemaDiagnostic` always emits `physicalName: null`, `origins: []`, `expected: null`, `actual: null`. `docs/v4/schema-lifecycle.md` §8 and the public MDX example require the expected/actual canonical fragments and physical name. For `changedObject` the operator currently learns only that "the application schema differs". The full comparable is already computed and attached to the error `details`; surfacing it costs little.
- **Authored `constraint.check` supports only Field-to-Field `greaterThan`.** `check-expression.ts` and `schema/check-expression.ts` reject every other `CheckExpressionV1` variant with `QP-SCHEMA-001`. The public type surface is honestly narrow (only `greaterThan` exists on ordered Fields), so no user can hit an unimplemented path, but the accepted grammar is only partially producible from authored source. Worth naming as an exact absence.
- **`seed.update` with empty `values` has no compile-time diagnostic.** `seed/committed-seed.ts` validates the empty case for `upsert` (`upsert update is empty`) but not for `update`; `seed/postgres/apply.ts` then emits `UPDATE t SET  WHERE …` and fails with a raw PostgreSQL syntax error instead of `QP-SEED-003`.
- **Dead exports in the new schema domain.** `schema/postgres-catalog.ts::physicalType`/`expectedDefault` and `schema/postgres/expected-fingerprint.ts::postgresIdentifierQuoter`/`expectedConstraintDefinition`/`expectedIndexDefinition` have no callers in production or tests. Knip's unused-export class is report-only, so this passes CI while shipping unreachable deparse logic that will drift from the reader.
- **Size-ratchet warnings on five new production files** (`schema/manifest.ts` 550, `schema/postgres/bootstrap.ts` 511, `seed/committed-seed.ts` 505, `schema/postgres/apply.ts` 502, `schema/postgres/catalog-reader-constraints.ts` 419+). `manifest.ts` in particular mixes physical-name derivation, member validation, Schema Projection and Data Contract Projection; per `codebase.md` these are distinct reasons to change.
- **`.oxfmtrc.json` now ignores `**/seeds/**` globally.** The intent is the committed Seed artifacts under `fixtures/*/questpie/seeds/`; the pattern would also silently exclude any future `src/seeds/` source directory. Scoping it to `**/questpie/seeds/**` keeps the ratchet honest.
- **A pure semantic rename commits an empty `up.sql`.** `docs/v4/schema-lifecycle.md` §6 says the SQL file ends with one LF; the zero-step rename migration writes zero bytes. Behaviorally fine (apply skips empty SQL), but it is an unstated artifact shape.
- **`withPinnedTransaction` masks the original error** if the compensating `ROLLBACK` throws (`postgres-session.ts`). A lost connection during rollback would report the rollback failure rather than the SQL failure that caused it.
- **No CLI surface lands with this slice.** `explainCommittedMigration`/`explainMigrationApply`/`explainCommittedSeed` plus goldens satisfy the issue's "CLI explain goldens" artifact, but `bunx questpie migration plan|create|apply`, `schema drift`, and `seed status|run` documented in `apps/docs/content/docs/v4/schema-lifecycle.mdx` are still library-only. Fine against `beta1-build-spec.md`'s release-level docs gate; flagging so it is not assumed closed.
````
