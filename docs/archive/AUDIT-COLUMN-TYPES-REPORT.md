# Column Types Refactoring — Audit Report

## 1. Type Flow Correctness

### Select Path (Agent 1)

- [x] All 8 field configs produce correct `CollectionSelect` types
- [x] `ExtractColumnFromFieldDef` correctly extracts builder types
- [x] `StripArrayAndNull` correctly handles relation union return types
- [x] `IsAny` correctly falls back to `AnyPgColumn` for unannotated fields
- [x] `InferColumnType` returns `null` for virtual fields
- [x] `BuildColumns` receives correct column map
- [x] `InferSelectModel` intersected with `ExtractOutputTypes` produces correct final types

| Config                        | Column                               | Location     | Output              | CollectionSelect    |
| ----------------------------- | ------------------------------------ | ------------ | ------------------- | ------------------- |
| `text({ required: true })`    | `PgVarcharBuilder`                   | `"main"`     | `string`            | `string`            |
| `text({})`                    | `PgVarcharBuilder`                   | `"main"`     | `string \| null`    | `string \| null`    |
| `number({ required: true })`  | `PgIntegerBuilder`                   | `"main"`     | `number`            | `number`            |
| `boolean({ default: true })`  | `PgBooleanBuilder`                   | `"main"`     | `boolean \| null`   | `boolean \| null`   |
| `json({})`                    | `PgJsonbBuilder`                     | `"main"`     | `JsonValue \| null` | `JsonValue \| null` |
| `relation({ to: "users" })`   | `PgVarcharBuilder \| PgJsonbBuilder` | `"main"`     | `string \| null`    | `string \| null`    |
| `relation({ hasMany: true })` | N/A                                  | `"relation"` | absent              | absent              |
| `text({ virtual: true })`     | `null`                               | `"virtual"`  | `string \| null`    | `string \| null`    |

### Insert/Update Path (Agent 2)

- [x] All 8 field configs produce correct `CollectionInsert` types
- [x] `Omit<InferInsertModel, fieldKeys>` correctly removes field-builder fields
- [x] `ExtractInputObject` replaces with correct field-level input types
- [x] Required fields are NOT optional
- [x] Has-default fields ARE optional
- [x] Virtual fields excluded from insert
- [x] hasMany relations don't appear in insert
- [x] Update = `Partial<Insert>`

### Client SDK vs Local CRUD (Agent 9)

- [x] Both paths produce **identical types** despite different architectures
- [x] Column types do NOT affect field-level result types on either path
- [x] No divergence risk from the refactoring

**Architecture**: Two parallel chains exist:

- **Client SDK**: `$infer.select` → `InferCollectionSelect` → `InferSelectModel & ExtractOutputTypes`
- **Server CRUD**: `CollectionSelectFromFieldDefinitions` → `FieldSelect` per field → `TState["select"]`

The `InferSelectModel` intersection in `$infer.select` is now a useful safety net — before the refactoring it always produced `{ field: unknown }` (from `AnyPgColumn`), now it carries real types and can catch divergences at compile time.

---

## 2. Return Type Annotations (Agent 3)

- [x] All 15 builtin fields have annotations on `toColumn`
- [x] All annotations match the DEFAULT mode's Drizzle builder
- [x] All annotations are importable (referenced imports exist)
- [x] Runtime code unchanged (still uses `let column: any` + conditional `.notNull()`/`.default()`)

### Mode Variant Mismatches

| Severity   | Field                  | Issue                                                                                                                                                                                     |
| ---------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HIGH**   | `number.ts`            | `mode:"decimal"` creates `numeric()` (returns `string` in Drizzle) but annotation says `ReturnType<typeof integer>` (returns `number`). Real data-type conflict.                          |
| **MEDIUM** | `select.ts`            | `multiple:true` creates `jsonb()` but annotation says `ReturnType<typeof varchar>`. Column builder type completely differs. **Causes intersection collapse to `never` — see Edge Cases.** |
| **MEDIUM** | `select.ts`            | `enumType:true` creates `pgEnum()(name)` but annotation says `ReturnType<typeof varchar>`. Same data type (`string`), wrong builder type.                                                 |
| LOW        | `text.ts`              | `mode:"text"` creates `text()` but annotation says `varchar`. Same data type.                                                                                                             |
| LOW        | `url.ts`               | `textMode:true` creates `text()` but annotation says `varchar`. Same data type.                                                                                                           |
| LOW        | `json.ts`, `object.ts` | `mode:"json"` creates `json()` but annotation says `jsonb`. Same data type.                                                                                                               |
| LOW        | `number.ts`            | 5 non-default modes (`smallint`, `bigint`, `real`, `double`, `decimal`) all mismatch annotation. Only `decimal` has a real data-type conflict.                                            |

---

## 3. Dead Code (Agent 4)

- [x] No references to `InferFieldColumn` in source code (cleanly removed)
- [x] No traces of `ApplyColumnConstraints`/`ApplyNotNull`/`ApplyHasDefault` in source
- [x] No broken imports
- [ ] One stale `@deprecated` comment in `types.ts:730`

### Stale Artifacts

| File                                                                  | Issue                                                                                         |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/questpie/src/server/fields/types.ts:730`                    | `@deprecated` comment references `ApplyColumnConstraints` as if it still exists in `field.ts` |
| `packages/questpie/src/server/modules/starter/.generated/module.d.ts` | Stale `.d.ts` in `src/` — could shadow `.ts` file (tsdown resolution bug)                     |
| `packages/questpie/test/types/*.d.ts` + `*.js` (18 files)             | tsc incremental artifacts in test/types/                                                      |

---

## 4. Widening Safety (Agent 5)

- [x] `FieldDefinitionState.column: unknown` is safe everywhere
- [x] No runtime code reads `state.column` or `$types.column` — all column access via `toColumn()`
- [x] All type-level checks use `extends null` — `unknown extends null` = `false`, correct
- [x] `BuildColumns` always receives concrete types from `BuildFieldState`, never bare `unknown`
- [x] No code in admin package accesses `.column` on field definitions

**Zero locations would break from this widening.**

---

## 5. Duplication & Consistency (Agent 6)

### Duplicated Types

| Type                                 | Location 1                     | Location 2                | Identical?                                 | Status                        |
| ------------------------------------ | ------------------------------ | ------------------------- | ------------------------------------------ | ----------------------------- |
| `InferColumnType`                    | `field.ts:141` (private, USED) | `types.ts:723` (exported) | Yes                                        | **types.ts version is dead**  |
| `InferInputType`                     | `field.ts:74` (private, USED)  | `types.ts:691` (exported) | **NO** — types.ts missing `default` branch | **types.ts version is stale** |
| `InferOutputType`                    | `field.ts:101` (private, USED) | `types.ts:710` (exported) | **NO** — types.ts simplified nullability   | **types.ts version is stale** |
| `ExtractColumnsFromFieldDefinitions` | `collection-builder.ts:48`     | `global-builder.ts:29`    | Yes                                        | Could deduplicate             |
| `ExtractColumnsFromFields`           | `types.ts:857`                 | —                         | N/A                                        | **Dead code** (zero imports)  |

### Naming Inconsistencies

| Issue                                                                                                                                    | Severity                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `ExtractFieldsByLocation` — same name in `fields/types.ts` (returns FieldDefinition) and `collection/builder/types.ts` (returns TColumn) | **HIGH** — confusing, different return types |
| `Infer*` prefix used for both "compute from config" and "build composed type"                                                            | LOW — stylistic                              |

### Consistency Checks

- [x] Location inference: compile-time (`InferFieldLocation`) and runtime (`createFieldDefinition`) agree for ALL configs
- [x] `IsNoColumnRelation` and `ExtractFieldsByLocation` agree: `location="main"` guarantees non-null column

---

## 6. Edge Cases (Agent 7)

| #   | Edge Case                           | Verdict        | Details                                                                                                                                                                  |
| --- | ----------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Polymorphic relation (morphTo)      | **Safe**       | Column union `PgVarcharBuilder \| PgJsonbBuilder` is imprecise in `BuildColumns` but `FieldSelect` overrides with correct `{ type: string; id: string } \| null`         |
| 2   | Upload with `through` (M2M)         | **REAL ISSUE** | Location is `"main"` but `toColumn` returns `null` at runtime. `IsNoColumnRelation` doesn't handle upload-through. Creates phantom column in Drizzle table type.         |
| 3   | Select with `multiple: true`        | **REAL ISSUE** | Annotation says `varchar` but runtime creates `jsonb`. `InferSelectModel` infers `string`, `ExtractOutputTypes` produces `string[] \| null`. Intersection → **`never`**. |
| 4   | Custom field (unannotated)          | **Safe**       | `any` return → `IsAny` fallback → `AnyPgColumn`. Correct degradation.                                                                                                    |
| 5   | Object with mode variants           | **Safe**       | No `mode:"columns"` feature exists. Both json/jsonb modes produce compatible types.                                                                                      |
| 6   | Array nested in object              | **Safe**       | Recursive `NarrowFieldValue` + `FieldSelect` works. Both stored as JSONB.                                                                                                |
| 7   | `required: true` + `nullable: true` | **Safe**       | Input: `string` (must provide). Output: `string \| null`. DB column nullable. Intersection: `string \| null`. Semantically reasonable.                                   |

---

## 7. Test Coverage (Agent 8)

- [x] **0 new TSC errors** (1 pre-existing in questpie, 31 pre-existing in admin)
- [x] **949 tests pass** (packages/questpie), 0 fail
- [x] **156 tests pass** (packages/admin), 0 fail
- [x] 8 type-level test files (`.test-d.ts`) cover field inference, CRUD types, relations, operators
- [x] `BuildFieldState` indirectly covered via `$infer` assertions
- [x] `ExtractColumnFromFieldDef` indirectly covered via table shape assertions
- [ ] **GAP**: No tests for `ctx.tables` / `HookContext.data` column types

---

## 8. Issues Found

| #   | Severity     | File                    | Description                                                                                                                                                                                                            | Suggested Fix                                                                             |
| --- | ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | **CRITICAL** | `builtin/select.ts:333` | `multiple:true` creates `jsonb()` at runtime but annotation says `ReturnType<typeof varchar>`. `InferSelectModel` sees `string`, `ExtractOutputTypes` sees `string[] \| null` → intersection collapses to **`never`**. | Change annotation to `ReturnType<typeof varchar> \| ReturnType<typeof jsonb>`             |
| 2   | **HIGH**     | `field.ts:47-68`        | Upload with `through` gets `location="main"` but `toColumn` returns `null` at runtime. `IsNoColumnRelation` only checks `hasMany`, not upload-through. Creates phantom column in Drizzle table type.                   | Extend `InferFieldLocation` or `IsNoColumnRelation` to detect `through` on upload configs |
| 3   | **HIGH**     | `builtin/number.ts:238` | `mode:"decimal"` creates `numeric()` (Drizzle returns `string`) but field is typed as `number`. Data type conflict at DB boundary.                                                                                     | Document as known limitation, or add `decimal` mode return type annotation                |
| 4   | **HIGH**     | `types.ts:691`          | Exported `InferInputType` missing `default` branch — diverged from authoritative version in `field.ts:74`. External consumers would get wrong types for fields with defaults.                                          | Remove stale export, or sync with field.ts version                                        |
| 5   | **HIGH**     | `types.ts:710`          | Exported `InferOutputType` has simplified nullability — diverged from authoritative version in `field.ts:101`.                                                                                                         | Remove stale export, or sync with field.ts version                                        |
| 6   | **MEDIUM**   | `builtin/select.ts:333` | `enumType:true` creates `pgEnum()(name)` but annotation says `ReturnType<typeof varchar>`. Builder type mismatch (data type same).                                                                                     | Include in union annotation                                                               |
| 7   | **LOW**      | `types.ts:730`          | `@deprecated` comment references non-existent `ApplyColumnConstraints`                                                                                                                                                 | Update comment text                                                                       |

---

## 9. Dead Code to Remove

| File                                                                  | Line    | Code                                        | Reason                                                |
| --------------------------------------------------------------------- | ------- | ------------------------------------------- | ----------------------------------------------------- |
| `packages/questpie/src/server/fields/types.ts`                        | 723-726 | `export type InferColumnType<...>`          | Duplicate of `field.ts:141`; zero imports             |
| `packages/questpie/src/server/fields/types.ts`                        | 691-704 | `export type InferInputType<...>`           | Stale diverged copy of `field.ts:74`; zero imports    |
| `packages/questpie/src/server/fields/types.ts`                        | 710-721 | `export type InferOutputType<...>`          | Stale diverged copy of `field.ts:101`; zero imports   |
| `packages/questpie/src/server/fields/types.ts`                        | 857-867 | `export type ExtractColumnsFromFields<...>` | Zero imports; superseded by `ExtractFieldsByLocation` |
| `packages/questpie/src/server/fields/types.ts`                        | 728-734 | `@deprecated` comment block                 | References non-existent `ApplyColumnConstraints`      |
| `packages/questpie/src/server/modules/starter/.generated/module.d.ts` | entire  | Stale `.d.ts` artifact                      | Could shadow `.ts` via tsdown resolution              |
| `packages/questpie/test/types/*.d.ts`, `*.js`                         | all     | 18 tsc incremental artifacts                | Stale build outputs in source tree                    |

---

## 10. Recommendations

### Must Fix (before merge)

1. **`select.ts` annotation**: Change `toColumn` return type to `ReturnType<typeof varchar> | ReturnType<typeof jsonb>` to cover `multiple:true`. Without this, `$infer.select` for multi-select fields produces `never`.

2. **Upload-through location**: Extend `IsNoColumnRelation` (or add a separate condition in `InferFieldLocation`) to handle upload fields with `through` config, returning `"relation"` instead of `"main"`.

### Should Fix (cleanup)

3. **Remove dead types from `types.ts`**: Delete the stale exported `InferColumnType`, `InferInputType`, `InferOutputType`, `ExtractColumnsFromFields`, and the `@deprecated` comment block. Re-export the authoritative versions from `field.ts` if needed.

4. **Disambiguate `ExtractFieldsByLocation`**: Rename one of the two identically-named types. Suggestion: keep `ExtractFieldsByLocation` in `fields/types.ts` (returns FieldDefinition), rename the one in `collection/builder/types.ts` to `ExtractColumnsByLocation` (returns TColumn).

5. **Clean stale artifacts**: Delete `module.d.ts` in `src/modules/starter/.generated/` and the 18 `.d.ts`/`.js` files in `test/types/`.

### Nice to Have

6. **Add `ctx.tables`/`HookContext.data` type tests**: This is the only gap in type-level test coverage. A `.test-d.ts` that asserts column types on `ctx.tables.posts.title` would catch regressions.

7. **Document `number.ts` decimal mode limitation**: `numeric()` returns `string` in Drizzle but the field declares `number`. This is a pre-existing issue unrelated to this refactoring, but worth documenting.

8. **Deduplicate `ExtractColumnsFromFieldDefinitions`**: The identical local type in `collection-builder.ts` and `global-builder.ts` could be extracted to a shared location.
