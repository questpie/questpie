# Audit Prompt: Real Drizzle Column Types via `toColumn` Inference

> Copy-paste this entire prompt into a new Claude Code session.

---

## Context

We refactored the field type system so that `BuildFieldState.column` carries **real Drizzle column builder types** (e.g., `PgVarcharBuilder`) instead of the old computed `InferFieldColumn` which always produced `AnyPgColumn<{ data: unknown }>`.

### What changed (RFC summary)

1. **`packages/questpie/src/server/fields/field.ts`**:
   - Added `ExtractColumnFromFieldDef<TFieldDef>` — extracts the return type of `toColumn` via `infer`, strips `null`/`array` variants, falls back to `AnyPgColumn` for unannotated (any) returns
   - Added helpers: `StripArrayAndNull`, `IsAny`
   - `BuildFieldState` went from 4 to **5 type params** (added `TColumn`)
   - `FieldDef.toColumn` return type loosened from `AnyPgColumn | AnyPgColumn[] | null` to `any` (the `<const TImpl>` pattern captures the real type)
   - `InferColumnType` constraint loosened from `TColumn extends AnyPgColumn | null` to just `TColumn`
   - `createFieldDefinition` typed overload now passes `ExtractColumnFromFieldDef<TFieldDef>` as 5th param
   - Added `InferFieldLocation` "relation" variant via `IsNoColumnRelation` (hasMany without multiple = no column)
   - Runtime `createFieldDefinition` also handles `location: "relation"`

2. **`packages/questpie/src/server/fields/builder.ts`**:
   - `FieldBuilderProxy` passes `ExtractColumnFromFieldDef<TMap[K]>` instead of `AnyPgColumn`

3. **`packages/questpie/src/server/fields/types.ts`**:
   - `FieldDefinitionState.column` widened from `AnyPgColumn | null` to `unknown` (accepts builders AND columns)
   - `EmptyFieldState.column` → `unknown`
   - `AnyFieldDefinition.column` → `unknown`
   - Removed `InferFieldColumn` type (deprecated comment left)
   - `FieldTypeRegistry` changed from `type = {}` to `interface {}` (for declaration merging)

4. **15 builtin field files** (`packages/questpie/src/server/fields/builtin/*.ts`):
   - Each got a **return type annotation** on `toColumn` (e.g., `): ReturnType<typeof varchar> {`)
   - Runtime code inside `toColumn` is **unchanged** (still uses `let column: any`)

### Critical design decision: NO `ApplyColumnConstraints`

We initially added `ApplyColumnConstraints` that used `& { _: { notNull: true } }` to apply notNull/hasDefault to builder types. **This corrupted Drizzle's internal `_` metadata** because builders have `_: { notNull: false, ... }` — the intersection created `notNull: false & true = never`, which made `BuildColumns` produce `data: unknown` for all user fields. We removed it entirely.

The system works because:

- **Select types**: `InferCollectionSelect = InferSelectModel<table> & ExtractOutputTypes<fields>` — intersection narrows Drizzle's nullable inference with field-level output types
- **Insert types**: `InferCollectionInsert = Omit<InferInsertModel<table>, fieldKeys> & ExtractInputObject<fields>` — completely replaces Drizzle's insert inference for field-builder fields
- So the column type's `notNull`/`hasDefault` don't matter — `InferOutputType` and `InferInputType` handle those from config

---

## Your task

Run a **comprehensive audit** of this refactoring. You must verify correctness, detect dead code, find complexity issues, and identify duplication. Use **maximum parallelism** — spawn as many agents as you can concurrently.

---

## Phase 1: Parallel Deep-Dive Agents (spawn ALL at once)

Spawn these **8 agents in parallel** using the Agent tool. Each agent should do research only (no edits).

### Agent 1: Type Flow Correctness — Select Path

```
Read and trace the FULL type chain from field definition to CollectionSelect/HookContext.data for SELECT operations.

Files to read:
- packages/questpie/src/server/fields/field.ts (BuildFieldState, ExtractColumnFromFieldDef, InferColumnType)
- packages/questpie/src/server/fields/builder.ts (FieldBuilderProxy)
- packages/questpie/src/server/collection/builder/types.ts (ExtractFieldsByLocation, InferMainColumnsFromFields, InferMainTableWithColumns, ExtractColumnsFromFields)
- packages/questpie/src/server/collection/builder/collection.ts (InferCollectionSelect, ExtractOutputTypes, CollectionSelect)

For EACH of these concrete field configs, trace the full type:
1. f.text({ required: true }) — expect: column=PgVarcharBuilder, output=string
2. f.text({}) — expect: column=PgVarcharBuilder, output=string|null
3. f.number({ required: true }) — expect: column=PgIntegerBuilder, output=number
4. f.boolean({ default: true }) — expect: column=PgBooleanBuilder, output=boolean|null
5. f.json({}) — expect: column=PgJsonbBuilder, output=unknown|null
6. f.relation({ to: "users" }) — expect: column=PgVarcharBuilder (stripped from union), output=string|null
7. f.relation({ hasMany: true, to: "tags" }) — expect: location="relation", column filtered out
8. f.text({ virtual: true }) — expect: column=null (InferColumnType), output=string|null

Verify that:
- ExtractColumnFromFieldDef correctly extracts builder type for each field
- StripArrayAndNull correctly handles relation's union return type
- IsAny correctly falls back for unannotated fields
- InferColumnType returns null for virtual fields
- BuildColumns receives the correct column map
- InferSelectModel produces types that get correctly narrowed by ExtractOutputTypes intersection
- The final CollectionSelect has correct non-nullable/nullable types

Report any type flow that produces incorrect results.
```

### Agent 2: Type Flow Correctness — Insert/Update Path

```
Read and trace the FULL type chain for INSERT and UPDATE operations.

Files to read:
- packages/questpie/src/server/fields/field.ts (InferInputType, BuildFieldState)
- packages/questpie/src/server/collection/builder/collection.ts (InferCollectionInsert, InferCollectionUpdate, ExtractInputObject)
- packages/questpie/src/server/collection/builder/types.ts (InferMainTableWithColumns)

For EACH config, trace the insert type:
1. f.text({ required: true }) — expect: input=string (required, not optional)
2. f.text({}) — expect: input=string|null|undefined (optional)
3. f.text({ default: "hello" }) — expect: input=string|undefined (has default)
4. f.text({ input: false }) — expect: input=never (excluded from insert)
5. f.text({ virtual: true }) — expect: input=never (virtual, no input by default)
6. f.text({ virtual: true, input: true }) — expect: input=string|undefined
7. f.relation({ hasMany: true }) — expect: excluded from main table insert
8. f.select({ multiple: true }) — expect: input=string[]|null|undefined

Verify that:
- Omit<InferInsertModel<table>, fieldKeys> correctly removes all field-builder fields
- ExtractInputObject replaces them with correct types from InferInputType
- The "required" fields are NOT optional in the final insert type
- The "has default" fields ARE optional
- Virtual fields are excluded
- Relation (hasMany) fields don't appear in insert type
- Update type is Partial<Insert> correctly

Report any type flow that produces incorrect results.
```

### Agent 3: Builtin Field Return Type Annotations Audit

```
Audit ALL 15 builtin field files for correct return type annotations on toColumn.

For each file in packages/questpie/src/server/fields/builtin/:
1. Read the file
2. Check the toColumn return type annotation matches the DEFAULT column builder used
3. Check if there are mode variants (mode: "text" vs "varchar") and whether the annotation covers the default mode
4. Check if the annotation is importable (the type reference exists in the file's imports)
5. Verify runtime code inside toColumn is UNCHANGED (still uses let column: any, applies .notNull()/.default() conditionally)

Expected annotations:
- text.ts → ReturnType<typeof varchar>
- textarea.ts → ReturnType<typeof text> (Drizzle's text, not the field)
- email.ts → ReturnType<typeof varchar>
- url.ts → ReturnType<typeof varchar>
- number.ts → ReturnType<typeof integer>
- boolean.ts → ReturnType<typeof boolean> (Drizzle's boolean)
- date.ts → ReturnType<typeof date>
- datetime.ts → ReturnType<typeof timestamp>
- time.ts → ReturnType<typeof time>
- json.ts → ReturnType<typeof jsonb>
- array.ts → ReturnType<typeof jsonb>
- object.ts → ReturnType<typeof jsonb>
- select.ts → ReturnType<typeof varchar>
- upload.ts → ReturnType<typeof varchar> | null
- relation.ts → ReturnType<typeof varchar> | ReturnType<typeof jsonb> | ReturnType<typeof varchar>[] | null

For each field, also note:
- Which mode variants exist and which Drizzle builder each mode actually creates at runtime
- Whether there's a type mismatch between annotation and non-default mode (e.g., number mode:"decimal" creates numeric() but annotation says integer())
- Whether such mismatches affect the `data` type (string vs number) in practice

Report all findings as a table.
```

### Agent 4: Dead Code Detection

```
Search the ENTIRE codebase for references to types/functions that were removed or changed in this refactoring.

Search for:
1. "InferFieldColumn" — was removed from types.ts. Search ALL files for any remaining imports or references
2. "ApplyColumnConstraints" / "ApplyNotNull" / "ApplyHasDefault" — were added then removed. Verify NO traces remain
3. Old FieldDef.toColumn return type "AnyPgColumn | AnyPgColumn[] | null" — search for any code that depends on this specific return type
4. Old FieldDefinitionState.column being "AnyPgColumn | null" — search for any code that casts or narrows to AnyPgColumn specifically (might break with unknown)
5. Old BuildFieldState with 4 type params — search for any external code that manually constructs BuildFieldState<4 params>
6. Any import of PgColumn from drizzle-orm/pg-core in the fields/ directory (should only need AnyPgColumn now)

Also check:
- Are there any `.d.ts` or `.js` artifacts in src/ directories that might have stale types? (tsdown bug: prefers .js over .ts)
- Are there test files that reference removed types?
- Are there doc comments referencing removed types?

For each finding, report: file path, line number, the dead reference, and whether it's a real issue or harmless.
```

### Agent 5: Constraint/Widening Safety Audit

```
Audit the safety of widening FieldDefinitionState.column from "AnyPgColumn | null" to "unknown".

Read ALL files that reference FieldDefinitionState, FieldDefinition, or access .column on a field definition.

Key files to check:
- packages/questpie/src/server/fields/types.ts — FieldDefinitionState, EmptyFieldState, AnyFieldDefinition
- packages/questpie/src/server/collection/builder/types.ts — ExtractFieldsByLocation, ExtractColumnsFromFields, InferMainColumnsFromFields
- packages/questpie/src/server/collection/runtime/ — any runtime code accessing fieldDef.toColumn() or state.column
- packages/admin/src/server/ — admin server code that accesses field column types
- packages/questpie/src/server/modules/ — module code

For each usage of .column or TState["column"]:
1. Does the code assume it's AnyPgColumn? (would break with unknown)
2. Does the code pass it to BuildColumns or other Drizzle utilities? (needs to be compatible)
3. Is there runtime code that calls methods on .column? (unknown has no methods)
4. Are there type guards or narrowing that handle the unknown case?

Also check: does FieldDefinition.toColumn() method (the runtime one in createFieldDefinition) still work correctly? It returns fieldDef.toColumn(name, config) or null — this is runtime, not types.

Report any location where the widening to "unknown" could cause a type error or runtime issue.
```

### Agent 6: Duplication & Consistency Audit

```
Check for code/type duplication and naming inconsistencies across the field type system.

1. DUPLICATION: Are there duplicate column type extraction patterns?
   - ExtractColumnFromFieldDef in field.ts
   - ExtractColumnsFromFields in collection/builder/types.ts
   - Any other column extraction in the codebase
   Do these overlap? Could any be removed?

2. DUPLICATION: InferColumnType exists in BOTH:
   - field.ts (line ~140): type InferColumnType<TConfig, TColumn> = virtual ? null : TColumn
   - types.ts (line ~725): type InferColumnType<TConfig, TColumn> = virtual ? null : TColumn
   Are these identical? Is one dead? Which is actually used?

3. CONSISTENCY: "location" inference exists in BOTH:
   - field.ts: InferFieldLocation type (compile-time)
   - field.ts: createFieldDefinition runtime (runtime)
   Do they produce the same results for all configs? Check the "relation" case specifically.

4. CONSISTENCY: "IsNoColumnRelation" logic vs ExtractFieldsByLocation filtering
   - field.ts: IsNoColumnRelation<TConfig> detects hasMany without multiple
   - collection/builder/types.ts: ExtractFieldsByLocation filters by location
   Do these agree? Could a field get location="main" but still have no column?

5. NAMING: Check for inconsistent naming:
   - "column" vs "columns" in type names
   - "field" vs "fields" in type names
   - "extract" vs "infer" prefix conventions
   - Are Extract* types consistent (extract from instances) vs Infer* (compute from config)?

Report all duplications and inconsistencies with file paths and line numbers.
```

### Agent 7: Edge Case & Regression Analysis

```
Test edge cases that could break the type system. For each, trace the type manually through the chain.

Edge cases to verify:

1. POLYMORPHIC RELATION (morphTo):
   - relation.ts toColumn returns: ReturnType<typeof varchar> | ReturnType<typeof jsonb> | ReturnType<typeof varchar>[] | null
   - ExtractColumnFromFieldDef applies StripArrayAndNull
   - What remains after stripping? PgVarcharBuilder | PgJsonbBuilder — is this valid for BuildColumns?

2. UPLOAD with through (M2M):
   - upload.ts toColumn returns: ReturnType<typeof varchar> | null
   - Config: { through: "media_items" }
   - StripArrayAndNull strips null → PgVarcharBuilder
   - But runtime toColumn returns null for through! Is the type vs runtime mismatch safe?

3. SELECT with multiple:
   - select.ts toColumn annotation: ReturnType<typeof varchar>
   - But runtime with { multiple: true } creates jsonb()
   - The column type says varchar but runtime is jsonb — does this cause issues?

4. CUSTOM FIELD (user-defined):
   - User creates field with field<MyConfig, MyValue>()({ toColumn: ... })
   - If toColumn has NO return type annotation → returns any → IsAny → fallback to AnyPgColumn
   - Is this correct? Does the user need to add annotations for their custom fields?

5. OBJECT field with mode: "columns":
   - object.ts creates individual columns, not a single jsonb
   - toColumn returns: ReturnType<typeof jsonb> but runtime creates varchar/integer/etc
   - Does this type mismatch matter?

6. ARRAY field — nested FieldDefinitions:
   - array.ts stores nested fields in jsonb
   - NarrowFieldValue extracts TItemState["value"][]
   - Does the column type (PgJsonbBuilder) correctly flow through when array is nested in object?

7. FIELD with both required AND nullable:
   - f.text({ required: true, nullable: true })
   - InferOutputType: required: true + nullable: true → TValue | null
   - But column builder has no notNull (raw builder)
   - Is the intersection still correct in InferCollectionSelect?

Read the relevant files to verify each edge case. Report which ones are safe and which have real issues.
```

### Agent 8: Test Coverage & Build Verification

```
Verify test coverage and build integrity for the field type changes.

1. Run: npx tsc --noEmit --project packages/questpie/tsconfig.json
   Capture ALL errors. Classify each as pre-existing or new.

2. Run: npx tsc --noEmit --project packages/admin/tsconfig.json
   Capture ALL errors. Classify each as pre-existing or new.

3. Run: cd packages/questpie && bun test
   Report pass/fail count.

4. Run: cd packages/admin && bun test
   Report pass/fail count.

5. Check test files for field type system coverage:
   - packages/questpie/test/ — any tests for BuildFieldState, ExtractColumnFromFieldDef, field type inference?
   - packages/questpie/test/types/ — type-level tests (.test-d.ts files)?
   - packages/admin/test/builder/ — tests that exercise field builder proxy?

6. Search for any test that specifically tests column types on ctx.tables or HookContext.data types.
   If none exist, note this as a gap.

7. Run: npx turbo build --filter=questpie --filter=@questpie/admin
   Report if build succeeds.

Report: test counts, error counts (new vs pre-existing), test coverage gaps.
```

---

## Phase 2: Synthesis (after all agents complete)

After all 8 agents return results, synthesize a final report:

### Report Template

```markdown
# Column Types Refactoring — Audit Report

## 1. Type Flow Correctness

- [ ] Select path: all 8 field configs produce correct types
- [ ] Insert path: all 8 field configs produce correct types
- [ ] No type flow produces `unknown` or incorrect nullability

## 2. Return Type Annotations

- [ ] All 15 builtin fields have correct annotations
- [ ] Mode variant mismatches documented and acceptable
- [ ] No missing imports

## 3. Dead Code

- [ ] No references to removed types (InferFieldColumn, ApplyColumnConstraints)
- [ ] No stale .d.ts/.js artifacts
- [ ] No broken imports

## 4. Widening Safety

- [ ] FieldDefinitionState.column: unknown is safe everywhere
- [ ] No runtime code assumes AnyPgColumn methods on column
- [ ] No type narrowing breaks

## 5. Duplication & Consistency

- [ ] No unnecessary duplication
- [ ] InferColumnType duplication resolved or documented
- [ ] Location inference (type vs runtime) is consistent
- [ ] Naming conventions are consistent

## 6. Edge Cases

- [ ] Polymorphic relation: safe / issue found
- [ ] Upload M2M: safe / issue found
- [ ] Select multiple: safe / issue found
- [ ] Custom fields: safe / issue found
- [ ] Object mode:columns: safe / issue found
- [ ] Nested array: safe / issue found
- [ ] Required + nullable: safe / issue found

## 7. Test Coverage

- [ ] All tests pass
- [ ] No new type errors
- [ ] Coverage gaps identified

## 8. Issues Found

| #   | Severity | File | Description | Suggested Fix |
| --- | -------- | ---- | ----------- | ------------- |
| 1   | ...      | ...  | ...         | ...           |

## 9. Dead Code to Remove

| File | Line | Code | Reason |
| ---- | ---- | ---- | ------ |
| ...  | ...  | ...  | ...    |

## 10. Recommendations

- ...
```

Write the final report to `AUDIT-COLUMN-TYPES-REPORT.md`.
