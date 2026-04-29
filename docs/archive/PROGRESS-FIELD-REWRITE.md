# Field System Rewrite — Progress Log

## Phase 1: Operator System Refactor (non-breaking)

**Status**: COMPLETED
**Started**: 2026-03-03
**Commit**: `2d539088` — `refactor: operator system with auto-derived JSONB ops (Phase 1)`

### What was done

- [x] `operators/types.ts` — `OperatorSetDefinition`, `JsonbCast`, `ResolvedOperatorSet` types
- [x] `operators/operator-set.ts` — `operatorSet()`, `extendOperatorSet()` frozen factories
- [x] `operators/resolve.ts` — `resolveContextualOperators()`, `deriveJsonbOperator()`, `buildJsonbRef()`
- [x] `operators/builtin.ts` — 13 builtin operator sets: stringOps, numberOps, booleanOps, dateOps, emailOps, urlOps, selectSingleOps, selectMultiOps, objectOps, belongsToOps, toManyOps, multipleOps, basicOps
- [x] `operators/index.ts` — Barrel
- [x] Updated text, textarea, email, url, upload fields to use new operator sets
- [x] **Fixed where-builder** — `resolveFieldOperatorCondition()` uses field-driven dispatch before falling back to hardcoded switch. Custom operators (email `domain`, url `host`) now actually execute at runtime.
- [x] Extended operator detection: where-builder checks field's operator map keys (not just hardcoded list)

### Verification

- 78 field tests pass
- 156 admin tests pass
- `npx tsc --noEmit` passes (only pre-existing module augmentation error)

---

## Phase 2: Core Field Builder Class

**Status**: COMPLETED
**Started**: 2026-03-03
**Commit**: `8beef4da` — `feat: immutable Field<TState> builder class (Phase 2)`

### What was done

- [x] `v2/types.ts` — `FieldState`, `DefaultFieldState`, `ArrayFieldState`, `FieldRuntimeState`, type extractors
- [x] `v2/field.ts` — `Field<TState>` class with immutable builder, backward compat getters (state, $types), toColumn(), toZodSchema(), getOperators(), getMetadata()
- [x] `v2/derive-schema.ts` — `buildZodFromState()` auto-derivation from type + refinements
- [x] `v2/index.ts` — Barrel
- [x] `test/fields/v2/field.test.ts` — 30 tests covering builder, column, schema, operators, metadata, compat

### Verification

- 108 field tests pass (78 existing + 30 new)
- 156 admin tests pass

---

## Phase 3: Builtin Field Factories

**Status**: COMPLETED
**Started**: 2026-03-03

### What was done

- [x] `v2/builtin/text.ts` — text() factory with text/varchar modes, prototype augmentation for .pattern(), .trim(), .lowercase(), .uppercase()
- [x] `v2/builtin/textarea.ts` — textarea() factory (pgText column)
- [x] `v2/builtin/email.ts` — email() factory with .email() validation
- [x] `v2/builtin/url.ts` — url() factory with .url() validation
- [x] `v2/builtin/number.ts` — number() factory with mode overloads (integer/smallint/bigint/real/double/decimal), prototype augmentation for .min(), .max(), .positive(), .int(), .step() — unified min/max handles both text and number fields
- [x] `v2/builtin/boolean.ts` — boolean() factory
- [x] `v2/builtin/date.ts` — date() factory, prototype augmentation for .autoNow(), .autoNowUpdate()
- [x] `v2/builtin/datetime.ts` — datetime() factory with precision/timezone config
- [x] `v2/builtin/time.ts` — time() factory with precision/withSeconds config
- [x] `v2/builtin/select.ts` — select() factory with static/dynamic options, prototype augmentation for .enum()
- [x] `v2/builtin/json.ts` — json() factory with jsonb/json mode
- [x] `v2/builtin/object.ts` — object() factory with nested fields, composite schema/metadata
- [x] `v2/builtin/from.ts` — from() custom field factory, prototype augmentation for .type()
- [x] `v2/builtin/index.ts` — Barrel with side-effect imports
- [x] `test/fields/v2/builtin.test.ts` — 66 tests covering all 13 factories + cross-cutting behavior

### Verification

- 174 field tests pass (78 existing + 96 v2)
- 156 admin tests pass

---

## Phase 4: Relation + Upload Fields

**Status**: COMPLETED
**Started**: 2026-03-03

### What was done

- [x] `v2/builtin/relation.ts` — relation() factory supporting all 6 relation types via chain methods:
  - Default: belongsTo (varchar FK column)
  - `.hasMany({ foreignKey })` — virtual, toMany operators
  - `.manyToMany({ through, sourceField, targetField })` — virtual, toMany operators
  - `.multiple()` — jsonb array of FKs, multiple operators
  - Polymorphic (object target) — morphTo with type+id columns
  - `.onDelete()`, `.onUpdate()`, `.relationName()` chain methods
- [x] `v2/builtin/upload.ts` — upload() factory for file upload relations:
  - Single upload: belongsTo with varchar(36) column
  - M2M upload: virtual with through config
  - isUpload flag in metadata for admin UI detection
- [x] Updated `v2/builtin/index.ts` — Added relation and upload exports + side-effect import
- [x] `test/fields/v2/relation.test.ts` — 36 tests covering all 6 relation variants + upload + cross-cutting

### Verification

- 210 field tests pass (78 existing + 132 v2)
- 156 admin tests pass

---

## Phase 5: Collection Builder Integration

**Status**: Pending

---

## Phase 6: Admin Integration via Codegen Plugin

**Status**: Pending

---

## Phase 7: Example + Consumer Migration

**Status**: Pending

---

## Phase 8: Codegen Updates

**Status**: Pending

---

## Phase 9: Cleanup + Test Migration

**Status**: Pending
