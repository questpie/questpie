# Plan: Type-Safe Where Clause Operators

## Goal

Make where clauses reject invalid operators per field type:

```ts
// REJECTED by TypeScript:
{ title: { gt: 100 } }         // gt doesn't exist on text operators
{ views: { contains: "abc" } }  // contains doesn't exist on number operators

// ACCEPTED by TypeScript:
{ title: { eq: "hello", contains: "hi" } }  // both valid for text
{ views: { gt: 5, lte: 100 } }              // both valid for number
```

## Root Cause

`field<"text", TextFieldConfig, string>("text", impl)` — when explicit type params are provided, TypeScript uses defaults for omitted params. The implementation's concrete `getOperators` return type is erased to `ContextualOperators`.

## Solution: Curried "as const satisfies" Pattern

Each field is a **plain object** with generic methods. `field` uses the curried pattern:

```ts
export const field =
  <TConfig extends BaseFieldConfig, TValue>() =>
  <const TImpl extends FieldDef<TConfig, TValue>>(impl: TImpl): TImpl =>
    impl;
```

- First call: provide `TConfig` and `TValue` explicitly
- Second call: provide implementation — `TImpl` is **inferred**, concrete types preserved
- `getOperators` has `<TApp>` generic for relation fields to resolve target collections

### How types flow

```
textField = field<TextFieldConfig, string>()({
  type: "text" as const,
  getOperators<TApp>(config: TextFieldConfig) {
    return { column: stringColumnOperators, jsonb: stringJsonbOperators };
  },
})

→ typeof textField preserves:
    type: "text"
    getOperators return: { column: typeof stringColumnOperators; jsonb: typeof stringJsonbOperators }

→ defaultFields = { text: typeof textField, ... }

→ FieldBuilderProxy maps each field to a callable factory:
    f.text(config) → FieldDefinition<BuildFieldState<"text", TUserConfig, string, AnyPgColumn, ExtractOpsFromFieldDef<typeof textField>>>

→ ExtractOpsFromFieldDef extracts concrete operators from getOperators return type

→ FieldWhere reads TState["operators"]["column"] → { eq?: string; contains?: string; like?: string; ... }

→ REJECTS: { title: { gt: 100 } } — gt not in keyof typeof stringColumnOperators
```

---

## Progress Tracker

### ✅ Step 1: `field.ts` — DONE

- New `FieldDef<TConfig, TValue>` interface — constraint type for field objects
- `getOperators` has `<TApp>` generic on the interface
- New curried `field` — validates shape, returns `TImpl` unchanged
- New `createFieldDefinition(fieldDef, config)` — runtime function creates `FieldDefinition`
- Export type helpers: `ExtractConfigFromFieldDef`, `ExtractValueFromFieldDef`, `ExtractTypeFromFieldDef`, `ExtractOpsFromFieldDef`, `BuildFieldState`
- Kept all `Infer*` types (`InferInputType`, `InferOutputType`, etc.)
- Removed old `FieldImplementation` interface, `createFieldFactory`, old `field`

### ✅ Step 2: All 15 builtin fields — DONE

All 15 fields converted from old to new pattern:

| File          | Value Type                                                   | Status  |
| ------------- | ------------------------------------------------------------ | ------- |
| `text.ts`     | `string`                                                     | ✅ Done |
| `textarea.ts` | `string`                                                     | ✅ Done |
| `email.ts`    | `string`                                                     | ✅ Done |
| `url.ts`      | `string`                                                     | ✅ Done |
| `number.ts`   | `number`                                                     | ✅ Done |
| `boolean.ts`  | `boolean`                                                    | ✅ Done |
| `date.ts`     | `string`                                                     | ✅ Done |
| `datetime.ts` | `Date`                                                       | ✅ Done |
| `time.ts`     | `string`                                                     | ✅ Done |
| `select.ts`   | `string \| string[]`                                         | ✅ Done |
| `json.ts`     | `JsonValue`                                                  | ✅ Done |
| `object.ts`   | `Record<string, unknown>`                                    | ✅ Done |
| `array.ts`    | `unknown[]`                                                  | ✅ Done |
| `relation.ts` | `string \| string[] \| { type: string; id: string } \| null` | ✅ Done |
| `upload.ts`   | `string \| string[]`                                         | ✅ Done |

Each field now follows the pattern:

```ts
export const xField = field<XFieldConfig, ValueType>()({
  type: "x" as const,
  _value: undefined as unknown as ValueType,
  toColumn(_name: string, config: XFieldConfig) { ... },
  toZodSchema(config: XFieldConfig) { ... },
  getOperators<TApp>(config: XFieldConfig) { ... },
  getMetadata(config: XFieldConfig): FieldMetadataBase { ... },
});

getDefaultRegistry().register("x", xField as any);
```

### ❌ Step 3: `builder.ts` — TODO (next step)

**File:** `packages/questpie/src/server/fields/builder.ts`

**Current state:** `FieldBuilderProxy` is just `{ [K in keyof TMap]: TMap[K] }` — passes through raw field objects. But consumers expect `f.text({ required: true })` to be callable and return `FieldDefinition`. Since field objects are now plain objects (not functions), this is broken.

**Required changes:**

1. Update `FieldBuilderProxy` type to map plain field objects to callable factories:

```ts
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  type BuildFieldState,
  type ExtractConfigFromFieldDef,
  type ExtractOpsFromFieldDef,
  type ExtractTypeFromFieldDef,
  type ExtractValueFromFieldDef,
  createFieldDefinition,
} from "./field.js";

export type FieldBuilderProxy<TFields = DefaultFieldTypeMap> = {
  [K in keyof TFields]: <
    const TUserConfig extends ExtractConfigFromFieldDef<TFields[K]>,
  >(
    config?: TUserConfig,
  ) => FieldDefinition<
    BuildFieldState<
      ExtractTypeFromFieldDef<TFields[K]>,
      TUserConfig extends undefined
        ? ExtractConfigFromFieldDef<TFields[K]>
        : TUserConfig,
      ExtractValueFromFieldDef<TFields[K]>,
      AnyPgColumn,
      ExtractOpsFromFieldDef<TFields[K]>
    >
  >;
};
```

2. Update `createFieldBuilder` runtime to wrap field objects using `createFieldDefinition`:

```ts
export function createFieldBuilder<TMap = DefaultFieldTypeMap>(
  registry: FieldRegistry,
): FieldBuilderProxy<TMap> {
  return new Proxy({} as FieldBuilderProxy<TMap>, {
    get(_target, prop: string) {
      const fieldDef = registry.get(prop);
      if (!fieldDef) {
        throw new Error(
          `Unknown field type: "${prop}". Available types: ${registry.types().join(", ")}`,
        );
      }
      // Return a factory function that wraps the plain field def
      return (config?: any) => createFieldDefinition(fieldDef, config);
    },
    // ... rest stays the same
  });
}
```

### ❌ Step 4: `registry.ts` — TODO

**File:** `packages/questpie/src/server/fields/registry.ts`

**Current state:** Stores `AnyFieldFactory` (functions). But fields now register plain objects with `as any` casts.

**Required changes:**

- Change internal storage from `Map<string, AnyFieldFactory>` to `Map<string, FieldDef<any, any>>`
- Update `register()` to accept `FieldDef<any, any>` instead of `FieldFactory`
- Update `get()` to return `FieldDef<any, any> | undefined`
- Update or remove `FieldFactory` and `AnyFieldFactory` types (they may still be needed elsewhere — check usages)

### ❌ Step 5: `field-types.ts` — TODO

**File:** `packages/questpie/src/server/fields/field-types.ts`

**Current state:** System field instances call `textField({...})`, `datetimeField({...})`, `numberField({...})` as functions. But after conversion, these are plain objects, not functions.

**Required changes:**

- Change from `textField({ required: true })` to `createFieldDefinition(textField, { required: true } as const)`
- Import `createFieldDefinition` from `./field.js`
- All system field instances:
  - `_systemIdField = createFieldDefinition(textField, { required: true, default: () => "" } as const)`
  - `_systemTitleField = createFieldDefinition(textField, { required: true, virtual: true } as const)`
  - `_systemTimestampField = createFieldDefinition(datetimeField, { required: true, default: () => new Date() } as const)`
  - `_systemNullableTimestampField = createFieldDefinition(datetimeField, {} as const)`
  - `_systemUploadTextField = createFieldDefinition(textField, { required: true } as const)`
  - `_systemUploadNumberField = createFieldDefinition(numberField, { required: true } as const)`
  - `_systemUploadVisibilityField = createFieldDefinition(textField, { required: true, default: "public" } as const)`

### ❌ Step 6: `collection-builder.ts` — TODO

**File:** `packages/questpie/src/server/collection/builder/collection-builder.ts`

**Current state:** `createFieldBuilderFromFactories` (around line 1039) creates the field builder proxy. It currently expects factory functions from the registry.

**Required changes:**

- Update to use the new `createFieldBuilder` that wraps plain field objects
- The function at line 154-157 passes `questpieFields` from `~questpieApp` to this function
- May need to update `ExtractFieldTypes` type helper

### ❌ Step 7: Type check and fix remaining errors — TODO

```bash
cd packages/questpie && bunx tsc --noEmit
bun run check-types  # all 6 packages
```

### ❌ Step 8 (OPTIONAL): Test file — TODO

**File:** `packages/questpie/test/types/unified-api-types.test-d.ts`

- Section Q (standalone field operator inference) should now PASS
- Section R (negative tests with `@ts-expect-error`) should now CATCH errors

---

## Key Files Reference

| File                                                                    | Purpose                                                                                           | Status        |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `packages/questpie/src/server/fields/field.ts`                   | `FieldDef`, curried `field`, `createFieldDefinition`, `BuildFieldState`, extraction helpers | ✅ DONE       |
| `packages/questpie/src/server/fields/builtin/*.ts`                      | All 15 builtin field definitions                                                                  | ✅ DONE       |
| `packages/questpie/src/server/fields/builtin/defaults.ts`               | `defaultFields` map — no changes needed, types flow automatically                                 | ✅ NO CHANGES |
| `packages/questpie/src/server/fields/builder.ts`                        | `FieldBuilderProxy` type, `createFieldBuilder` runtime                                            | ❌ NEXT       |
| `packages/questpie/src/server/fields/registry.ts`                       | `FieldRegistry`, storage types                                                                    | ❌ TODO       |
| `packages/questpie/src/server/fields/field-types.ts`                    | `FieldWhere`, `FieldSelect`, system field instances                                               | ❌ TODO       |
| `packages/questpie/src/server/fields/types.ts`                          | `FieldDefinition<TState>`, `ContextualOperators`, `OperatorFn`                                    | ✅ NO CHANGES |
| `packages/questpie/src/server/fields/common-operators.ts`               | `stringColumnOperators`, `numberColumnOperators`, etc.                                            | ✅ NO CHANGES |
| `packages/questpie/src/server/collection/builder/collection-builder.ts` | `createFieldBuilderFromFactories`, `ExtractFieldTypes`                                            | ❌ TODO       |
| `packages/questpie/src/server/collection/crud/types.ts`                 | `Where`, `WhereFromCollection`, etc.                                                              | ✅ NO CHANGES |
| `packages/questpie/src/server/config/builder-types.ts`                  | `QuestpieBuilderState`                                                                            | ✅ NO CHANGES |
| `packages/questpie/test/types/unified-api-types.test-d.ts`              | Type tests                                                                                        | ❌ OPTIONAL   |

---

## Architecture: How Types Flow (Goal State)

```
1. Field definition (plain object):
   textField.getOperators<TApp>(config) → { column: typeof stringColumnOperators; jsonb: typeof stringJsonbOperators }
   typeof textField preserves CONCRETE return type

2. defaultFields = { text: typeof textField, number: typeof numberField, ... }
   q.fields(defaultFields) → TState.fields = DefaultFields

3. FieldBuilderProxy<TFields> maps each field to callable factory:
   f.text(config) → FieldDefinition<BuildFieldState<"text", TUserConfig, string, AnyPgColumn, ExtractOpsFromFieldDef<typeof textField>>>

4. ExtractOpsFromFieldDef<typeof textField> → { column: typeof stringColumnOperators; jsonb: typeof stringJsonbOperators }
   This is CONCRETE — { eq: OperatorFn<string>; ne: OperatorFn<string>; contains: OperatorFn<string>; ... }

5. FieldWhere reads TState["operators"]["column"]:
   { [K in keyof TColumnOps]?: ExtractOperatorParamType<TColumnOps[K]> }
   → { eq?: string; ne?: string; contains?: string; like?: string; ... }
   Does NOT have: gt, gte, lt, lte, between (those are number ops)

6. Where clause:
   { title: { gt: 100 } }  → TS ERROR: 'gt' does not exist
   { title: { eq: "hi" } } → OK
```

## How to Run Checks

```bash
cd /Users/drepkovsky/questpie/repos/questpie-cms
bun run check-types          # type check all 6 packages
cd packages/questpie && bunx tsc --noEmit  # just core package
```

## Risk Assessment

### ReturnType of generic getOperators

When `getOperators` is `<TApp>(config: TextFieldConfig) => { column: ...; jsonb: ... }`,
`ReturnType<typeof textField.getOperators>` substitutes `unknown` for `TApp`.
For simple fields (text, number, etc.) the return doesn't depend on TApp — resolves to concrete type. ✅

For relation fields where return depends on TApp, ReturnType gives widened type.
This is fine — relation operators use a separate `RelationWhereInputFromConfig` path. ✅

### Config-conditional operators (select, relation, upload)

These return different operators based on config (e.g. single vs multi select).
TypeScript infers the union of both branches — slightly more permissive but not wrong.
Follow-up can add conditional return type annotations for narrowing.

### Breaking change for custom field users

`field` API changes from `field<"type", Config, Value>("type", {...})` to
`field<Config, Value>()({type: "type" as const, ...})`. Custom fields need updating.

---

## Recommended Execution Order (from here)

1. **`builder.ts`** — Update FieldBuilderProxy type + createFieldBuilder runtime
2. **`registry.ts`** — Change storage to FieldDef objects
3. **`field-types.ts`** — Convert system fields to use createFieldDefinition
4. **`collection-builder.ts`** — Adapt createFieldBuilderFromFactories
5. **Type check** — `bunx tsc --noEmit` and fix errors iteratively
6. **Test file** — Fix/update type test assertions
7. **Full check** — `bun run check-types` across all packages
