# Field System Rewrite: Immutable Builder Pattern

## Context

The current field system uses a config-bag pattern (`f.text({ required: true, maxLength: 255 })`) where each field implements 4+ methods (`toColumn`, `toZodSchema`, `getOperators`, `getMetadata`) that all branch on the same config flags. This causes:

1. **Lost Drizzle generics** — `toColumn` uses `let column: any`, destroying notNull/hasDefault type tracking
2. **Parallel conditional logic** — `multiple: true` checked in 4 places (column, zod, operators, metadata)
3. **Fragile centralized type narrowing** — `NarrowFieldValue` is a 50-line conditional type that must be updated for every new field variant
4. **No composition** — can't do `f.text().array()`, must use separate `f.array({ of: f.text() })`
5. **No escape hatches** — users can't modify the underlying Drizzle column or Zod schema
6. **Custom fields require implementing 4+ methods** — huge boilerplate for something like a PostGIS point field

The rewrite adopts a Drizzle/Zod-like immutable builder where each method returns a new builder with updated type state via intersections.

## Phases

| Phase | Description                             | Status  |
| ----- | --------------------------------------- | ------- |
| 1     | Operator System Refactor (non-breaking) | Pending |
| 2     | Core Field Builder Class                | Pending |
| 3     | Builtin Field Factories                 | Pending |
| 4     | Relation + Upload Fields                | Pending |
| 5     | Collection Builder Integration          | Pending |
| 6     | Admin Integration via Codegen Plugin    | Pending |
| 7     | Example + Consumer Migration            | Pending |
| 8     | Codegen Updates                         | Pending |
| 9     | Cleanup + Test Migration                | Pending |

See the full detailed plan in the conversation transcript.
