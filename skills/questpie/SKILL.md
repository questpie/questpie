---
name: questpie
description: QUESTPIE framework, server-first TypeScript CMS. File-convention codegen, collections, globals, routes, jobs, services, emails, blocks, typed client SDK, TanStack Query integration, adapters (queue, search, realtime, storage, email, KV). Use when building, reviewing, or refactoring any QUESTPIE project.
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
- Exposing QUESTPIE through MCP tools or resources
- Scaffolding a new project or onboarding

## Import Paths, Critical

| Factory                        | Import From                  | Needs Codegen? |
| ------------------------------ | ---------------------------- | -------------- |
| `collection(name)`             | `#questpie/factories`        | Yes            |
| `global(name)`                 | `#questpie/factories`        | Yes            |
| `block(name)`                  | `#questpie/factories`        | Yes            |
| `adminConfig({...})`           | `#questpie/factories`        | Yes            |
| `route()`                      | `"questpie"`                 | No             |
| `job({...})`                   | `"questpie"`                 | No             |
| `service()`                    | `"questpie"`                 | No             |
| `email({...})`                 | `"questpie"`                 | No             |
| `migration({...})`             | `"questpie"`                 | No             |
| `seed({...})` / `seed.steps({...})` | `"questpie"`            | No             |
| `runtimeConfig({...})`         | `"questpie/app"`             | No             |
| `appConfig({...})`             | `"questpie/app"`             | No             |
| `authConfig({...})`            | `"questpie/app"`             | No             |
| `env({...})`                   | `"questpie/env"`             | No             |
| `clientEnv({...})`             | `"questpie/env"`             | No             |
| `createClient<AppConfig>()`    | `"questpie/client"`          | No             |
| `createQuestpieQueryOptions()` | `"@questpie/tanstack-query"` | No             |

## Module And Plugin Configuration - Critical

Codegen imports `modules.ts` before runtime app creation to extract module-contributed plugins. **Rule:** any module that contributes a `plugin`, discover patterns, generated factories, categories, views, components, fields, or config factories must be a static entry in `modules.ts`, not a factory call, not behind an env/runtime check. Put runtime options in a plugin-discovered `config/*.ts` singleton factory instead.

```ts title="modules.ts"
import { observabilityModule } from "@questpie/observability/server";

export default [observabilityModule] as const;
```

```ts title="config/observability.ts"
import { observabilityConfig } from "@questpie/observability/server";

export default observabilityConfig({
	serviceName: "barbershop",
	enabled: process.env.NODE_ENV === "production",
});
```

The module reads the resolved config at runtime from `app.state.config.observability`. Factory modules (`someModule({...})` in `modules.ts`) are acceptable only for simple runtime-only modules whose plugin identity and codegen contributions never change. Full DO/DON'T treatment: `references/extend.md`.

A module's own `module.ts` is **generated** by `questpie generate --module` from convention files (`routes/`, `collections/`, `jobs/`, …) into `.generated/module.ts`; a barrel `index.ts` exports it. **Never hand-write `module.ts` or an inline `route()`/`module({...})` for a module that has any discoverable contribution** - create the convention file and regenerate. Full authoring flow: `references/module-authoring.md`.

## Admin Auth Contract - Critical

`adminModule` includes the starter auth model and owns the canonical Better Auth `user` collection shape used by admin setup and login guards. That contract includes `user.role` with at least `admin` and `user` values. Do not replace `collection("user")` from scratch in apps that use `adminModule`; merge `starterModule.collections.user` and extend it when custom user fields or layout are needed.

Auth config is merged through the entire module tree, including nested modules. `adminModule` depends on `starterModule`, and starter contributes Better Auth `admin()` / `bearer()` plugins through `config.auth`; app `config/auth.ts` is merged on top. After changing `modules.ts` or `config/auth.ts`, run `questpie generate`. `session.user.role` must be typed in routes, hooks, services, and access rules. Never fix a missing role with `(session.user as any)`, fix modules/auth/codegen.

For admin-enabled apps, keep the auth plugins explicit in app config too:

```ts title="config/auth.ts"
import { admin, bearer } from "better-auth/plugins";
import { authConfig } from "questpie/app";

export default authConfig({
	plugins: [admin(), bearer()],
	emailAndPassword: { enabled: true, requireEmailVerification: false },
});
```

## Generated App Surface - Critical

After `questpie generate`, the generated server files are the source of truth for what exists in the app. Inspect them before inventing imports, names, fields, or casts:

| Need to know                         | Ground truth                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Collections, globals, routes, services | `src/questpie/server/.generated/entities.gen.ts` and `AppCollections`, `AppGlobals`, `AppRoutes`, `AppServices` from `#questpie` |
| Relation target keys                 | `src/questpie/server/.generated/names.gen.ts`                                |
| Handler, hook, route, block context  | `src/questpie/server/.generated/context.gen.ts` and `Questpie.AppContext`    |
| Session and auth user shape          | `AppSession`, `AppSessionUser`, and `AppConfig.auth` from `#questpie`        |
| Enabled field and builder methods    | `src/questpie/server/.generated/factories.ts`                                |

Files starting with `_`, `index.ts`, declaration files, tests, and specs are intentionally invisible to codegen. If something is missing from the generated surface, fix discovery, modules, or config and rerun `questpie generate`; do not add `any`, re-export barrels, or duplicate registries at the call site.

## Reference Topics

### Core

| Topic             | File                            | Covers                                                             |
| ----------------- | ------------------------------- | ------------------------------------------------------------------ |
| Architecture      | `references/architecture.md`    | Framework overview, tech stack, project structure, file conventions, app bootstrap, data flow |
| Quickstart        | `references/quickstart.md`      | Scaffold, configure, codegen, migrate, serve, zero to running app |
| Data Modeling     | `references/data-modeling.md`   | Collections, globals, fields, relations, options, localization     |
| Field Types       | `references/field-types.md`     | All built-in field types with options and operators                |
| Type Inference    | `references/type-inference.md`  | The infer-first map: `CollectionDoc` / `CollectionWhere`, `AccessContext` helpers, per-op rule typing, cycle rules |
| Rules             | `references/rules.md`           | Access control (row/field level), hooks lifecycle, validation, derived request context |
| Business Logic    | `references/business-logic.md`  | Routes, jobs, services, email templates, context injection         |
| AppContext        | `references/app-context.md`     | The `AppContext` runtime interface, where it's available, `getContext`, partial context overrides |
| Durable Workflows | `references/workflows.md`       | Long-running workflows, steps, events, cron, admin UI              |
| Sandboxed Code    | `references/sandbox.md`         | `ctx.executor.run()`, isolation modes, capability model, Deno engine deployment |
| CRUD API          | `references/crud-api.md`        | `find`, `create`, `updateById`/`updateMany`, `deleteById`/`deleteMany`, atomic conditional updates, globals API |
| Seeds             | `references/seeds.md`           | `seed()` vs `seed.steps()`, idempotency, checkpointed steps, categories, `dependsOn`, `undo`, `autoSeed`, seed CLI |
| Query Operators   | `references/query-operators.md` | `where` clause operators by field type                             |
| Realtime          | `references/realtime.md`        | Live queries over SSE, automatic broadcasts, `live()`/`liveIter()`, wire protocol, keepalive |

### Infrastructure

| Topic      | File                                    | Covers                                                       |
| ---------- | --------------------------------------- | ------------------------------------------------------------ |
| Production | `references/production.md`              | Queue, search, realtime, storage, email, KV adapter setup    |
| Environment | `references/env.md`                    | `env.ts` + `env.client.ts`: boot-validated, typed env, generated client modules |
| Auth       | `references/auth.md`                    | Better Auth integration, session, providers, access patterns |
| Adapters   | `references/infrastructure-adapters.md` | All adapter configs: pg-boss, S3, SMTP, pgNotify, Redis      |
| MCP        | `references/mcp.md`                     | MCP setup, CRUD tools, route tools, custom tools, OAuth 2.1 + scope∩RBAC |
| OpenAPI    | `references/openapi.md`                 | OpenAPI 3.1 spec + Scalar UI: introspection, config, caching, honest limitations |
| AI Runs    | `references/ai.md`                      | Claude Code agent runs: `aiModule`, embedded worker, resumable streams, exactly-once finalize |

### Extend

| Topic              | File                               | Covers                                                       |
| ------------------ | ---------------------------------- | ------------------------------------------------------------ |
| Extend             | `references/extend.md`             | Custom modules, fields, operators, adapters, codegen plugins |
| Module Authoring   | `references/module-authoring.md`   | How modules are created: convention dirs → codegen `.generated/module.ts`; NEVER hand-write `module.ts`/inline `route()` |
| Codegen Plugin API | `references/codegen-plugin-api.md` | Plugin architecture, category declarations, templates        |
| Multi-Tenancy      | `references/multi-tenancy.md`      | `appConfig({ context })` resolver, scope isolation, ScopeProvider |

### Client

| Topic          | File                           | Covers                                                           |
| -------------- | ------------------------------ | ---------------------------------------------------------------- |
| TanStack Query | `references/tanstack-query.md` | `q.collections.*`, `q.globals.*`, `q.routes.*`, realtime queries |

## Key Patterns, Quick Reference

### Collection

```ts
import { collection } from "#questpie/factories";

export default collection("posts")
	.fields(({ f }) => ({
		title: f.text().required(),
		status: f.select([{ value: "draft", label: "Draft" }]),
		author: f.relation("user").required(),
	}))
	.access({
		read: true,
		create: ({ session }) => !!session,
		// update rules get the existing row as `data` (typed, non-optional)
		update: ({ session, data }) => data.author === session?.user?.id,
	})
	.hooks({
		beforeChange: async ({ data, operation }) => {
			if (operation === "create") data.slug = slugify(data.title);
			return data;
		},
	})
	.options({ versioning: true, timestamps: true });
```

### Extend a Module Collection (don't redefine!)

```ts
import { starterModule } from "questpie/app";
import { collection } from "#questpie/factories";

// Registering the same key from scratch REPLACES the module's collection
// (drops its fields/hooks/auth wiring). Merge instead, fully typed:
export default collection("user")
	.merge(starterModule.collections.user)
	.fields(({ f }) => ({
		isAnonymous: f.boolean().default(false),
	}));
```

### Route

```ts
import { route } from "questpie/services";
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
import { job } from "questpie/services";
import z from "zod";

export default job({
	name: "sendReminder",
	schema: z.object({ userId: z.string() }),
	retryDelay: 5, // seconds (not ms!)
	handler: async ({ payload, email, collections }) => {
		const user = await collections.users.findOne({
			where: { id: payload.userId },
		});
		await email.sendTemplate({
			template: "reminder",
			to: user.email,
			input: { name: user.name },
		});
	},
});
```

### Client SDK

```ts
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";

const client = createClient<AppConfig>({
	baseURL:
		typeof window !== "undefined"
			? window.location.origin
			: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api",
});

const { docs } = await client.collections.posts.find({
	where: { status: "published" },
	orderBy: { createdAt: "desc" },
	with: { author: true },
});
```

> For build-time-inlined, typed client env, declare `env.client.ts` and import the generated module (`#questpie/env.client.vite` for Vite). The default template skips this and reads `process.env.APP_URL` directly, see `references/env.md`.

### Queue Dispatch

```ts
// In any handler with AppContext:
await queue.sendReminder.publish({ userId: "abc" });
// NOT queue.send("sendReminder", payload)
```

## Common Mistakes

| Severity | Mistake                                                | Fix                                                                                   |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| CRITICAL | Files in wrong directory                               | Collections in `collections/`, routes in `routes/`, etc.                              |
| CRITICAL | Convention file has no export                          | Codegen needs one export, `export default` or a named `export const`/`function` both discovered; a file with no export is skipped. Factory categories key from the factory string (`collection("blog-posts")` -> `blogPosts`); non-factory categories key from the filename |
| CRITICAL | Importing route/job/service from `#questpie/factories` | Use `"questpie"`, only collection/global/block/adminConfig use `#questpie/factories` |
| CRITICAL | Redefining a module collection (e.g. starter `user`) from scratch | `.merge(starterModule.collections.user)` then add fields, see Extend pattern        |
| CRITICAL | Casting `session.user` to `any` for admin role checks | Use `session?.user.role`; if it is not typed, fix `modules.ts`, `config/auth.ts`, and regenerated output |
| HIGH     | Forgetting `questpie generate` after adding files      | Re-run codegen on any file add/remove in convention dirs                              |
| HIGH     | Job handler uses `input` instead of `payload`          | Jobs destructure `{ payload }`, routes destructure `{ input }`                        |
| HIGH     | `queue.send("name", data)`                             | Use `queue.jobName.publish(data)`                                                     |
| HIGH     | `beforeCreate` / `afterCreate` hook names              | Use `beforeChange` / `afterChange` with `operation === "create"` guard                |
| MEDIUM   | Using npm/yarn instead of Bun                          | QUESTPIE requires Bun as package manager                                              |
| MEDIUM   | Editing `.generated/` files                            | Never edit, re-run `questpie generate`                                               |

## Preview And Workflow Rules

- Live Preview uses the existing admin `FormView`, Preview button, `LivePreviewMode`, and iframe. Do not introduce a separate visual-edit form API, a second default form view, or parallel preview API names.
- Preserve save, autosave, Cmd+S, history, workflow transitions, locks, and actions in the normal form lifecycle.
- Frontend visual editing needs `useCollectionPreview`, `PreviewProvider`, `PreviewField`, and usually `BlockRenderer`; load the `questpie-admin` skill for the full frontend preparation checklist.
- For publishable pages with workflow enabled, workflow stage is the publication source. Public frontend reads use `stage: "published"`.
- If public client/HTTP access is enabled, anonymous read access should require `input?.stage === "published"`; editor/preview reads can omit `stage` only when a session is present.
- Preview/draft-mode reads may load the working stage for authorized editors.
- Do not add duplicate `isPublished` guidance when workflow already controls publishing.

## Full Compiled Document

`AGENTS.md` expands this file plus every `references/` topic inline, in one document. It is generated (`bun run scripts/build-skill-docs.ts`), so read it when you want everything at once, but edit the sources (this file and `references/`), never `AGENTS.md` directly.
