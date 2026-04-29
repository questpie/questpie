---
name: questpie
description: QUESTPIE framework — server-first TypeScript CMS. File-convention codegen, collections, globals, routes, jobs, services, emails, blocks, typed client SDK, TanStack Query integration, adapters (queue, search, realtime, storage, email, KV). Use when building, reviewing, or refactoring any QUESTPIE project.
license: MIT
metadata:
  author: questpie
  version: "3.0.0"
---

# QUESTPIE Framework

Server-first TypeScript application framework. Define your data schema once using standalone factories, codegen generates the typed runtime, and any frontend consumes it through introspection.

## When to Apply

Reference these guidelines when:
- Creating or modifying collections, globals, routes, jobs, services, emails, blocks
- Working with file conventions or codegen pipeline
- Configuring adapters (queue, search, storage, realtime, email, KV)
- Setting up access control, hooks, or validation
- Building typed client SDK queries or TanStack Query integrations
- Writing modules or plugins for QUESTPIE
- Scaffolding a new project or onboarding

## Import Paths — Critical

| Factory | Import From | Needs Codegen? |
|---|---|---|
| `collection(name)` | `#questpie/factories` | Yes |
| `global(name)` | `#questpie/factories` | Yes |
| `block(name)` | `#questpie/factories` | Yes |
| `adminConfig({...})` | `#questpie/factories` | Yes |
| `route()` | `"questpie"` | No |
| `job({...})` | `"questpie"` | No |
| `service()` | `"questpie"` | No |
| `email({...})` | `"questpie"` | No |
| `migration({...})` | `"questpie"` | No |
| `seed({...})` | `"questpie"` | No |
| `runtimeConfig({...})` | `"questpie"` | No |
| `appConfig({...})` | `"questpie"` | No |
| `authConfig({...})` | `"questpie"` | No |
| `createClient<AppConfig>()` | `"questpie/client"` | No |
| `createQuestpieQueryOptions()` | `"@questpie/tanstack-query"` | No |

## Reference Topics

### Core

| Topic | File | Covers |
|---|---|---|
| Quickstart | `references/quickstart.md` | Scaffold, configure, codegen, migrate, serve — zero to running app |
| Data Modeling | `references/data-modeling.md` | Collections, globals, fields, relations, options, localization |
| Field Types | `references/field-types.md` | All built-in field types with options and operators |
| Rules | `references/rules.md` | Access control (row/field level), hooks lifecycle, validation |
| Business Logic | `references/business-logic.md` | Routes, jobs, services, email templates, context injection |
| CRUD API | `references/crud-api.md` | Server-side `find`, `create`, `update`, `delete`, globals API |
| Query Operators | `references/query-operators.md` | `where` clause operators by field type |

### Infrastructure

| Topic | File | Covers |
|---|---|---|
| Production | `references/production.md` | Queue, search, realtime, storage, email, KV adapter setup |
| Auth | `references/auth.md` | Better Auth integration, session, providers, access patterns |
| Adapters | `references/infrastructure-adapters.md` | All adapter configs: pg-boss, S3, SMTP, pgNotify, Redis |

### Extend

| Topic | File | Covers |
|---|---|---|
| Extend | `references/extend.md` | Custom modules, fields, operators, adapters, codegen plugins |
| Codegen Plugin API | `references/codegen-plugin-api.md` | Plugin architecture, category declarations, templates |
| Multi-Tenancy | `references/multi-tenancy.md` | Scope isolation, workspace filtering, ScopeProvider |

### Client

| Topic | File | Covers |
|---|---|---|
| TanStack Query | `references/tanstack-query.md` | `q.collections.*`, `q.globals.*`, `q.routes.*`, realtime queries |

## Key Patterns — Quick Reference

### Collection

```ts
import { collection } from "#questpie/factories";

export default collection("posts")
  .fields(({ f }) => ({
    title: f.text().required(),
    status: f.select([{ value: "draft", label: "Draft" }]),
    author: f.relation("users").required(),
  }))
  .access({
    read: true,
    create: ({ session }) => !!session,
    update: ({ session, doc }) => doc.authorId === session?.user?.id,
  })
  .hooks({
    beforeChange: async ({ data, operation }) => {
      if (operation === "create") data.slug = slugify(data.title);
      return data;
    },
  })
  .options({ versioning: true, timestamps: true });
```

### Route

```ts
import { route } from "questpie";
import z from "zod";

export default route()
  .post()
  .schema(z.object({ period: z.enum(["day", "week", "month"]) }))
  .handler(async ({ input, collections }) => {
    return collections.posts.find({ where: { status: "published" } });
  });
```

### Job

```ts
import { job } from "questpie";
import z from "zod";

export default job({
  name: "sendReminder",
  schema: z.object({ userId: z.string() }),
  retryDelay: 5,  // seconds (not ms!)
  handler: async ({ payload, email, collections }) => {
    const user = await collections.users.findOne({ where: { id: payload.userId } });
    await email.send("reminder", { to: user.email, data: { name: user.name } });
  },
});
```

### Client SDK

```ts
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

const client = createClient<AppConfig>({
  baseURL: typeof window !== "undefined" ? window.location.origin : process.env.APP_URL,
  basePath: "/api",
});

const { docs } = await client.collections.posts.find({
  where: { status: "published" },
  orderBy: { createdAt: "desc" },
  with: { author: true },
});
```

### Queue Dispatch

```ts
// In any handler with AppContext:
await queue.sendReminder.publish({ userId: "abc" });
// NOT queue.send("sendReminder", payload)
```

## Common Mistakes

| Severity | Mistake | Fix |
|---|---|---|
| CRITICAL | Files in wrong directory | Collections in `collections/`, routes in `routes/`, etc. |
| CRITICAL | Missing `export default` on convention files | Codegen silently ignores files without default export |
| CRITICAL | Importing route/job/service from `#questpie/factories` | Use `"questpie"` — only collection/global/block/adminConfig use `#questpie/factories` |
| HIGH | Forgetting `questpie generate` after adding files | Re-run codegen on any file add/remove in convention dirs |
| HIGH | Job handler uses `input` instead of `payload` | Jobs destructure `{ payload }`, routes destructure `{ input }` |
| HIGH | `queue.send("name", data)` | Use `queue.jobName.publish(data)` |
| HIGH | `beforeCreate` / `afterCreate` hook names | Use `beforeChange` / `afterChange` with `operation === "create"` guard |
| MEDIUM | Using npm/yarn instead of Bun | QUESTPIE requires Bun as package manager |
| MEDIUM | Editing `.generated/` files | Never edit — re-run `questpie generate` |

## Full Compiled Document

For the complete framework reference with all topics expanded: `AGENTS.md`
