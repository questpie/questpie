# Typesafety Composition Migration Plan

Status: approved for incremental implementation
Scope: `packages/questpie`, `packages/admin`, tests, then examples/docs

## Goals

1. Max contextual typesafety with minimal user friction.
2. Composition-first API surface (schema vs business logic vs admin UI behavior).
3. Remove deprecated field-level APIs in runtime and typing paths.

## Target architecture

- Data model: `.fields(...)`
- Business rules and side effects: `.hooks<TApp>(...)`
- Access policy: `.access<TApp>(...)` (including field-scoped rules)
- Admin reactive UX: `.form(...)` (reactive behaviors colocated with form config)

## Decisions

### Virtual fields

- Keep only:
  - `virtual: true` (no DB-query filtering/sorting)
  - `virtual: sql\`...\`` (DB-query capable)
- `virtual: sql` must flow to `state.virtuals` and be resolvable in query builders.
- `virtual: true` should not be queryable in `where`.

### Deprecated removals

- Remove field-level runtime hooks (`config.hooks`) execution path.
- Remove field-level access declaration from field config (`config.access`).
- Keep field-scoped access via collection/global `.access({ fields: ... })`.

### Typing improvements

- Add method-level generic hooks/access APIs:
  - `.hooks<TApp>(...)`
  - `.access<TApp>(...)`
- Narrow relation output in select/hook payloads from field definition config.
- Remove old optionalization logic tied to field config access.

## Implementation phases

### Phase 1 (core runtime + typesafety foundations)

1. Virtual SQL extraction from field definitions into builder state.
2. Virtual SQL support in collection `where` resolver.
3. Enforce non-queryable `virtual: true` behavior.
4. Add `hooks<TApp>` and `access<TApp>` signatures for collection/global.
5. Relation output narrowing in `CollectionSelect` composition.

### Phase 2 (deprecated runtime removal)

1. Stop using `fieldDefinitions[*].config.access` as runtime policy source.
2. Stop executing field-level hook pipeline (`beforeChange/afterRead` per-field).
3. Use access source-of-truth from collection/global access config (`fields`).
4. Update introspection to read field access from composed access config.

### Phase 3 (admin reactive composition)

1. Introduce form-level reactive config as primary source.
2. Keep temporary fallback for old `meta.admin` reactive declarations.
3. Move client/server reactive extraction/execution to form-level source.

### Phase 4 (migration and cleanup)

1. Rewrite tests to new composition APIs.
2. Rewrite examples to new APIs.
3. Rewrite docs last (with migration notes and before/after snippets).
4. Remove transitional compatibility paths.

## Compatibility strategy

- Code is migrated in core first.
- Examples/docs are intentionally updated incrementally.
- During transition, tests are updated to validate only the new behavior.

## Validation checklist

- `packages/questpie`: `bun run check-types`
- `packages/admin`: `bun run check-types`
- targeted suites around collection/global CRUD and type tests
