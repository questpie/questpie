# Inputs/Output Overlay + Hooks Motor (Spec)

## Goal
Make hooks the sole “motor” for data transformation, while `.inputs` and `.output` only enrich schema/typing and enforce runtime validation. Provide type-safe public/local views, input-only fields, and computed output fields, without changing the DB schema.

## Core Principles
- **Hooks are the engine**: all transforms (slug, password hash, computed display fields) happen in hooks.
- **`.inputs` + `.output` are overlays**: define types/validation and public/local shaping only.
- **Public vs local**: client uses public view, server/local uses local view. Local defaults to full output.
- **Runtime validation**: inputs and included output fields are validated.

## Public/Local Views
- **Public**: used by HTTP adapter/client, applies input schema and output shaping.
- **Local**: used by system API (`cms.api`), defaults to full output, but can be overridden.

## Inputs Overlay
### Base
- Base input schema is derived from collection fields (required if `notNull` without default, optional otherwise).
- Base is used when `.inputs` is not defined.

### API
```ts
.inputs(z.object({ ... }))
.inputs((base) => base.extend({ ... }))
.inputs({
  public: (base) => base.extend({ ... }),
  local: (base) => base.extend({ ... }),
  publicUpdate?: (base) => base.extend({ ... }),
  localUpdate?: (base) => base.extend({ ... })
})
```

### Rules
- If `.inputs` defines a key that exists in DB fields, it **overrides optionality**.
- If `.inputs` defines a key not in DB fields, it becomes **input-only** (e.g. `password`).
- Update schema defaults to `create.partial()` if not explicitly provided.

## Output Overlay
### API
```ts
.output({
  public: {
    omit: { passwordHash: true },
    include: { displayName: z.string() },
  },
  local: {
    omit: { ... },
    include: { ... },
  }
})
```

### Rules
- `omit` removes fields from the public response and public types.
- `include` adds computed fields to public types and **runtime validation**.
- If `include` defines a required field, hooks must always populate it.

## Hooks (Motor)
### New Hook
- **beforeValidate**: runs before input validation for create/update.

### Execution Order (create/update)
1. `beforeValidate`
2. validate input (via `.inputs` for view)
3. `beforeCreate` / `beforeUpdate`
4. `beforeChange`
5. DB write (input-only fields dropped)
6. `afterCreate` / `afterUpdate`
7. `afterChange`
8. `afterRead` (for read operations)

### Typing
- Hook `ctx.data` is typed from `.inputs` for create/update.
- Hook `ctx.data` for reads uses query options type.
- Hook output uses `.output.include` types (public/local merged for hooks).

## Client vs Local Typing
- **Client (`createQCMSClient`)** uses public input/output types.
- **Local (`cms.api`)** uses local input/output types (full by default).

## Runtime Validation
- **Input validation**: always run Zod parse for public/local `.inputs`.
- **Output validation**: validate only the `.output.include` fields.
- **Omit enforcement**: always drop `omit` fields in public view, regardless of requested `columns`.

## Example
```ts
defineCollection("users")
  .fields({
    email: text("email").notNull(),
    slug: text("slug").notNull(),
    passwordHash: text("password_hash").notNull(),
  })
  .inputs({
    public: (base) =>
      base.extend({
        password: z.string().min(8),
        slug: z.string().optional(),
      }),
    local: (base) =>
      base.extend({
        password: z.string().min(8),
        slug: z.string().optional(),
      }),
  })
  .output({
    public: {
      omit: { passwordHash: true },
      include: { displayName: z.string() },
    },
  })
  .hooks({
    beforeValidate: ({ data }) => {
      if (!data.slug && data.email) data.slug = data.email.split("@")[0];
    },
    beforeCreate: ({ data }) => {
      if (data.password) data.passwordHash = `hash:${data.password}`;
    },
    afterRead: ({ data }) => {
      data.displayName = data.email.split("@")[0];
    },
  });
```

## Non-Goals
- No DB schema changes.
- No transformInput step; all transforms live in hooks.
- No role-based dynamic types (public/local only).
