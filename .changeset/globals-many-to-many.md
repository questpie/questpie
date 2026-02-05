---
"questpie": minor
"@questpie/admin": minor
---

feat: add defaultAccess for global access control defaults

New `defaultAccess` option in CMS config sets default access rules for all collections and globals:

```typescript
const cms = q({ name: "app" }).build({
  defaultAccess: {
    read: ({ session }) => !!session,
    create: ({ session }) => !!session,
    update: ({ session }) => !!session,
    delete: ({ session }) => !!session,
  },
});
```

- Collections/globals without explicit `.access()` inherit from `defaultAccess`
- Explicit access rules override defaults
- System access mode bypasses all checks

---

feat: add getContext<TApp>() helper with AsyncLocalStorage support

New typed context helper for accessing `app`, `session`, `db`, `locale`, and `accessMode`:

**Explicit pattern** (recommended for hooks/access control):

```typescript
.access({
  read: (ctx) => {
    const { session, app, db } = getContext<AppCMS>(ctx);
    return session?.user.role === "admin";
  }
})
```

**Implicit pattern** (via AsyncLocalStorage):

```typescript
async function logActivity() {
  const { db, session } = getContext<AppCMS>(); // From storage
}

await runWithContext({ app: cms, session, db }, async () => {
  await logActivity(); // Works without passing context
});
```

CRUD operations automatically run within `runWithContext` scope, enabling implicit access in hooks.

---

fix: properly handle access control returning false

Fixed critical bug where access rules returning `false` were not properly enforced:

- Added explicit `accessWhere === false` checks before query execution
- Now throws `ApiError.forbidden()` with clear error messages
- Applied to all CRUD operations (find, count, create, update, delete)
- Realtime subscriptions now emit error events for access denied

Previously, `false` was treated as "no restriction", potentially exposing data.

---

feat: add many-to-many mutation support for globals

Globals now support full many-to-many relation operations:

- `connect` - Link existing records
- `create` - Create and link new records
- `connectOrCreate` - Connect if exists, create if not
- `set` - Replace entire relation set
- Plain array support `[id1, id2]` for admin forms

Example usage:

```typescript
// Connect existing services
await cms.api.globals.homepage.update(
  {
    featuredServices: { connect: [{ id: service1.id }, { id: service2.id }] },
  },
  ctx,
);

// Create new services and link them
await cms.api.globals.homepage.update(
  {
    featuredServices: {
      create: [
        { name: "Consulting", description: "Expert advice", price: 100 },
      ],
    },
  },
  ctx,
);
```

Also includes new test coverage for:

- Junction table extra fields preservation
- Empty relation handling
- Cascade delete cleanup

---

feat: add transaction utilities with `onAfterCommit` hook

New AsyncLocalStorage-based transaction wrapper that solves deadlock issues and enables safe side-effect handling:

```typescript
import { withTransaction, onAfterCommit } from "questpie";

// In hooks - queue side effects for after commit
.hooks({
  afterChange: async ({ data, context }) => {
    onAfterCommit(async () => {
      await context.app.queue.sendEmail.publish({ to: data.email });
      await context.app.mailer.send({ ... });
    });
  },
})

// In custom functions
await withTransaction(db, async (tx) => {
  const order = await createOrder(tx);

  onAfterCommit(async () => {
    await sendConfirmationEmail(order);
  });

  return order;
});
```

Key features:

- Callbacks only run after outermost transaction commits
- Nested transactions automatically reuse parent tx
- Safe for PGLite (single-connection) and production PostgreSQL
- Ideal for job dispatching, emails, webhooks, search indexing

---

fix: resolve PGLite test deadlocks in nested CRUD operations

Fixed deadlock issues when CRUD operations with search indexing were called inside transactions (e.g., many-to-many nested mutations). Search indexing now uses `onAfterCommit` to run after transaction completion.

---

refactor: remove jobs control plane (job_runs tracking)

Removed the experimental `jobsModule` and `job_runs` collection tracking:

- Simplified queue service and worker code (~400 lines removed)
- Jobs now rely purely on queue adapter (PgBoss or other) for monitoring
- Removed `jobsModule` export from package

The jobs system remains fully functional:

```typescript
const sendEmail = q.job("send-email", {
  schema: z.object({ to: z.string() }),
  handler: async ({ payload }) => { ... }
});

await app.queue.sendEmail.publish({ to: "user@example.com" });
await app.queue.listen();
```

Control plane with admin UI visibility may be re-added in the future with a cleaner design.

---

feat: add 6 new language translations

Added i18n support for additional languages:

**New locales:**

- `cs` - Czech (Čeština)
- `de` - German (Deutsch)
- `es` - Spanish (Español)
- `fr` - French (Français)
- `pl` - Polish (Polski)
- `pt` - Portuguese (Português)

**Usage:**

```typescript
const cms = q({ name: "app" }).build({
  locale: {
    default: "en",
    available: ["en", "sk", "cs", "de", "es", "fr", "pl", "pt"],
  },
});
```

All error messages, validation messages, and UI strings are now available in these languages.
