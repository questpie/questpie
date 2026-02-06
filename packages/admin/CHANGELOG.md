# @questpie/admin

## 1.1.1

### Patch Changes

- Updated dependencies [[`7172275`](https://github.com/questpie/questpie-cms/commit/71722757a95e1f30521ac1eeca1080a8691bb9fc)]:
  - questpie@1.1.1
  - @questpie/tanstack-query@1.1.1

## 1.1.0

### Minor Changes

- [`a7efd1e`](https://github.com/questpie/questpie-cms/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add defaultAccess for global access control defaults

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

  ***

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

  ***

  fix: properly handle access control returning false

  Fixed critical bug where access rules returning `false` were not properly enforced:
  - Added explicit `accessWhere === false` checks before query execution
  - Now throws `ApiError.forbidden()` with clear error messages
  - Applied to all CRUD operations (find, count, create, update, delete)
  - Realtime subscriptions now emit error events for access denied

  Previously, `false` was treated as "no restriction", potentially exposing data.

  ***

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

  ***

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

  ***

  fix: resolve PGLite test deadlocks in nested CRUD operations

  Fixed deadlock issues when CRUD operations with search indexing were called inside transactions (e.g., many-to-many nested mutations). Search indexing now uses `onAfterCommit` to run after transaction completion.

  ***

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
  await app.listenToJobs();
  ```

  Control plane with admin UI visibility may be re-added in the future with a cleaner design.

  ***

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

### Patch Changes

- Updated dependencies [[`a7efd1e`](https://github.com/questpie/questpie-cms/commit/a7efd1e7d8d5a9cc61de0f420d7d651df34c7002)]:
  - questpie@1.1.0
  - @questpie/tanstack-query@1.1.0

## 1.0.5

### Patch Changes

- Updated dependencies [[`a043841`](https://github.com/questpie/questpie-cms/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9)]:
  - questpie@1.0.5
  - @questpie/tanstack-query@1.0.5

## 1.0.4

### Patch Changes

- [`01562df`](https://github.com/questpie/questpie-cms/commit/01562dfb6771a47eddcb797f36f951ae434f29c8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add Prettify to admin builder types and improve DX
  - Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
  - Add default `ConsoleAdapter` for email in development mode (no config needed)
  - Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps

- Updated dependencies [[`01562df`](https://github.com/questpie/questpie-cms/commit/01562dfb6771a47eddcb797f36f951ae434f29c8)]:
  - questpie@1.0.4
  - @questpie/tanstack-query@1.0.4

## 1.0.3

### Patch Changes

- [`9005d72`](https://github.com/questpie/questpie-cms/commit/9005d725497bb0c70884c6dced980c9496163705) Thanks [@drepkovsky](https://github.com/drepkovsky)! - refactor: use optimized type utilities in admin builder types

  Replace `Omit<T, "key"> & { key: NewType }` pattern with `SetProperty`, `TypeMerge`, and `UnsetProperty` utilities for faster TypeScript completion.

- Updated dependencies []:
  - questpie@1.0.3
  - @questpie/tanstack-query@1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie-cms/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions
  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

- Updated dependencies [[`eb98bb9`](https://github.com/questpie/questpie-cms/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77)]:
  - questpie@1.0.2
  - @questpie/tanstack-query@1.0.2

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie-cms/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

- Updated dependencies [[`87c7afb`](https://github.com/questpie/questpie-cms/commit/87c7afbfad14e3f20ab078a803f11abf173aae99)]:
  - questpie@1.0.1
  - @questpie/tanstack-query@1.0.1

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie-cms/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

### Patch Changes

- Updated dependencies [[`934c362`](https://github.com/questpie/questpie-cms/commit/934c362c22a5f29df20fa12432659b3b10400389)]:
  - questpie@1.0.0
  - @questpie/tanstack-query@1.0.0

## 0.0.2

### Patch Changes

- chore: include files in package.json
- Updated dependencies
  - questpie@0.0.2
  - @questpie/tanstack-query@0.0.2

## 0.0.1

### Patch Changes

- feat: initial release
- Updated dependencies
  - @questpie/tanstack-query@0.0.1
  - questpie@0.0.1
