# BETA-02 replacement implementation review 4

- Model: `opus`
- Effort: `medium`
- Diff base: `11cb63e3a31ae9ec716aac38a6c5ea481fd9bad9`
- Reviewed head: `a65ddbf1a33230819df82284c6dff45b8fbef0c6`
- Invocation: fresh, stateless, no tools
- Verdict: `BLOCKED`

## Raw findings

````text
VERDICT: BLOCKED

## Blockers

### 1. Public Seed documentation contradicts the implemented Seed value contract

`apps/docs/content/docs/v4/schema-lifecycle.mdx` — the "Run an immutable Seed" example still authors timestamps as `Date` objects:

```ts
startsAt: new Date("2026-08-11T09:00:00.000Z"),
endsAt: new Date("2026-08-11T09:30:00.000Z"),
```

followed by "The Controlled Structural Evaluator permits `new Date(<ISO 8601 literal>)`."

The reviewed head rejects that exact form at both boundaries:

- `tests/type/fixtures/beta02-seed-types.ts` pins `// @ts-expect-error timestamp values are canonical strings at every public boundary` for `seed.insert(messages, { body: "hello", createdAt: new Date(0) })`;
- `packages/compiler/src/seed/committed-seed.ts` `normalizeValue` requires canonical `YYYY-MM-DDTHH:mm:ss.SSSZ` text and reports `QP-SEED-003 seedTargetMismatch` for a `Date`;
- `tests/unit/beta02-seed.test.ts` asserts that rejection.

The internal workbench (`docs/v4/schema-lifecycle.md` §9) already uses canonical strings, so the MDX is the outlier and the PR touched this exact file for the `constraint.check` change without repairing the Seed example. Public documentation is authority under `docs/v4/implementation-gates.md`; a documented example that fails to typecheck and fails compilation is a blocking authority conflict.

Required repair: change the MDX Seed example to canonical timestamp strings and adjust or remove the `new Date(<ISO 8601 literal>)` sentence so it no longer implies a supported Seed value form. If `Date` is intended to remain author-facing sugar, implement and type it instead — but pick one.

### 2. Undocumented depth restriction on open `field.json`

`packages/compiler/src/seed/json-codec.ts`, `normalizeOpenJson`:

```ts
if (depth >= 8) return invalid("exceeds the JSON container depth limit");
```

The accepted contract bounds container depth for `value.*` only. `docs/v4/data-model-and-query-grammar.md` §4.1 enumerates the exact open-JSON rejections (`undefined`, sparse arrays, non-NFC strings/keys, non-plain objects, duplicate decoded keys, size bound) and does not include depth; `JsonValue` is declared as an unbounded recursive union, and `schema-lifecycle.md` scopes the depth-eight rule to "Shape and embedded container depth". A 9-deep, few-hundred-byte JSON value is contract-valid and is rejected here with `QP-SEED-003`.

Required repair: either remove the depth guard for open JSON (the 1,048,576-byte canonical bound already limits the value), or add the exact limit to `docs/v4/schema-lifecycle.md`, `docs/v4/data-model-and-query-grammar.md`, and the public MDX Field-limits section alongside the existing byte and array bounds.

## Non-blocking observations

- `packages/compiler/src/schema/postgres/apply.ts`: the pre-flight guard `migration.plan.steps.some((item) => item.kind.includes("Concurrent"))` can never match — no member of `MigrationStepKindV1` contains that substring. Blocked plans already cannot be committed, so this is dead code that reads as a live safety check.
- `packages/compiler/src/schema/postgres/expected-fingerprint.ts`: `applicationSchemaExists` is derived from `schema.collections.length > 0`. A future migration that drops every Collection would leave the applied head lowering to `applicationSchemaExists: false` with empty objects while the live catalog still holds the schema, producing a false `QP-SCHEMA-027 targetDrift` and an undeployable application. The planner already handles that state correctly (`tests/unit/beta02-migration-plan.test.ts`, "does not recreate the application schema after an empty applied head"), so the two sides disagree. Unreachable in the beta.1 fixtures; worth an explicit Genesis signal before a drop-all delta becomes reachable.
- `packages/questpie/src/check-expression.ts` implements only `greaterThan` for authored checks while `CheckExpressionV1`, the SQL renderer, and the catalog parser support the full closed grammar. The narrowing is typed and fails closed, but it is an unstated absence in a public factory; ADR-0021's "exact absences" discipline suggests recording it.
- `packages/compiler/src/seed/postgres/apply.ts` throws on a blocked or failed Seed and discards the `applied` array, so a caller cannot report which Seeds in a graph already committed. Migration apply returns that information explicitly; the two surfaces differ.
- `questpie.cli-explanation` (`packages/compiler/src/schema/explain.ts`) is a new versioned format tag with no entry in any accepted workbench or ADR naming audit. It is currently compiler-internal, but the goldens freeze its bytes.
- `HANDOFF.md` still lists #289 as the active frontier with no `## Latest verification` entry for this work; the acceptance record will need it before the queue advances.
- `tests/integration/postgres/beta02-migration-restart.test.ts` is ~2,360 lines covering lock timeouts, partial apply, bindings, snapshots, Field families, Seeds, keywords, and checks in one file. It is outside the `packages|apps/*/src` ratchet, but splitting by hostile family would improve failure locality.
- `quality/performance/beta02-migration.json` sets `migrationGoldenBytes` as an exact-equality budget (25,528) enforced by `toBe`. That is the intended golden behavior, but any deliberate artifact change requires updating the manifest, the baseline, and the test together.
````
