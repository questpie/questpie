# Backend API Architecture Audit

Date: 2026-04-26

Scope: backend-facing API surface in `packages/questpie`, plus server extensions from
`packages/admin` and `packages/openapi`. This is an API/seam audit, not a full
implementation review.

## Executive Summary

QUESTPIE has a strong core direction: file-convention entities, fluent builders,
codegen-provided typed factories, a single `AppContext`, and plugin-discovered
extensions. The model is coherent enough to scale, but several API seams currently
make the framework feel less seamless than the architecture intends.

The highest-priority problems are:

1. Runtime API, scaffolds, examples, and comments are out of sync. Several generated
   templates still show old options-object field APIs or old email/route context shapes.
2. Field access is split-brain: `field.access()` is surfaced in introspection, while
   collection/global `.access({ fields })` is enforced in CRUD.
3. Route defaults differ from CRUD defaults. Custom routes are public by default and
   execute nested CRUD in ALS `system` mode unless the developer manually passes user
   context.
4. `service().lifecycle("request")` is not wired as a real request scope in the HTTP
   execution path; no framework-owned `RequestScope` is created or disposed.
5. Identity is inconsistent for jobs and emails: codegen keys drive runtime access,
   while `job.name` and `email.name` are separate and mostly unvalidated.

## Product Requirement: Primitive-Complete Use-Case Coverage

The framework should treat every public primitive as a capability contract, not just
as a low-level building block. If QUESTPIE exposes a primitive, the main use cases
enabled by that primitive should work end-to-end across:

- runtime behavior
- TypeScript inference
- file-convention codegen
- HTTP/client APIs where applicable
- admin/introspection where applicable
- documentation and scaffolds
- regression tests

This does not mean every edge case needs a dedicated high-level API. It does mean
that common use cases should not require users to discover internal seams or compose
unsafe escape hatches.

Coverage target by primitive:

| Primitive        | Main use cases that should be first-class                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collections      | CRUD, relations, nested relation mutations, access, field access, hooks, validation, localization, uploads, soft delete, versioning, workflow, search, realtime, audit/admin metadata |
| Globals          | Singleton config, scoped/tenant config, localized config, access, field access, hooks, versioning/workflow, admin forms                                                               |
| Fields           | Schema generation, DB columns, validation, introspection, admin rendering, typed where operators, hooks, access, transforms, custom fields                                            |
| Routes           | JSON actions, GET query routes, raw webhooks, auth-guarded endpoints, public endpoints, typed params, typed output, status/header control                                             |
| Services         | Singleton infrastructure, request-scoped context, dependency access, namespaces, async initialization, disposal, circular dependency errors                                           |
| Jobs             | Typed payloads, retries, delayed jobs, cron, queue publishing, worker execution, context propagation, idempotent side effects                                                         |
| Auth             | Better Auth config, session typing, CRUD access integration, route access integration, admin setup/user management, bearer/API key flows                                              |
| Email            | Typed templates, rendering with AppContext, sending, preview/admin usage, locale-aware templates                                                                                      |
| Storage/uploads  | Upload collections, upload fields, private/public visibility, signed URLs, serving files, MIME/size restrictions                                                                      |
| Admin extensions | Collection/global screens, views, components, actions, reactive fields, blocks, preview, dashboard/sidebar config                                                                     |
| Modules/plugins  | Discovery, key derivation, builder extensions, field types, registries, config buckets, module merging                                                                                |

When an API seam is evaluated, the question should be: "does this primitive support
the main workflows a user would naturally expect from it without falling out of the
typed framework model?"

## API Surface Map

### Bootstrap, Runtime, Modules

Public primitives:

- `runtimeConfig(input)` for runtime infrastructure and plugins.
- `appConfig(config)` for app-level locale, default access, global hooks, and context
  extension.
- `authConfig(config)` for Better Auth options with inferred session type.
- `createApp(definition, runtime)` for generated code.
- `module(definition)` for static module definitions and package modules.
- `createFetchHandler(app, config)` for HTTP dispatch through compiled file-convention
  routes.

Core merge model:

- Known module keys use explicit merge functions: `collections`, `globals`, `jobs`,
  `routes`, `fields`, `services`, `messages`, `migrations`, `seeds`, `config`.
- Unknown plugin keys flow to `app.state`.
- `config` is bucketed by key: `config.app`, `config.auth`, `config.admin`,
  `config.openapi`, etc.

### Collections

Definition API:

```ts
collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).label("Title").required(),
		author: f.relation("users").label("Author"),
	}))
	.title(({ f }) => f.title)
	.indexes(({ table }) => [])
	.options({ timestamps: true, softDelete: true, versioning: true })
	.hooks({ beforeChange: async ({ data }) => {} })
	.access({ read: true, update: ({ session }) => !!session })
	.searchable({ content: (record) => record.title })
	.validation()
	.upload({ visibility: "public" });
```

Admin/plugin extensions add `.admin()`, `.list()`, `.form()`, `.preview()`,
`.actions()` through generated factory proxies.

Server CRUD API:

- `find(options?, context?)`
- `findOne(options?, context?)`
- `count(options?, context?)`
- `create(input, context?)`
- `updateById({ id, data }, context?)`
- `update({ where, data }, context?)`
- `updateBatch({ updates }, context?)`
- `deleteById({ id }, context?)`
- `delete({ where }, context?)`
- `restoreById({ id }, context?)`
- `findVersions({ id, limit?, offset? }, context?)`
- `revertToVersion({ id, version?, versionId? }, context?)`
- `transitionStage({ id, stage, scheduledAt? }, context?)`
- `upload?(file, context?, additionalData?)`
- `uploadMany?(files, context?, additionalData?)`

Query options cover `where`, `columns`, `with`, `orderBy`, `limit`, `offset`,
`search`, `locale`, `localeFallback`, `includeDeleted`, `stage`, and `groupBy`.

Built-in HTTP routes:

- `GET /:collection`
- `POST /:collection`
- `PATCH /:collection`
- `GET /:collection/count`
- `GET /:collection/meta`
- `GET /:collection/schema`
- `POST /:collection/update-batch`
- `POST /:collection/delete-many`
- `GET /:collection/:id`
- `PATCH /:collection/:id`
- `DELETE /:collection/:id`
- `GET /:collection/:id/audit`
- `POST /:collection/:id/restore`
- `POST /:collection/:id/revert`
- `POST /:collection/:id/transition`
- `GET /:collection/:id/versions`
- `POST /:collection/upload`
- `GET /:collection/files/:key*`

### Globals

Definition API:

```ts
global("settings")
	.fields(({ f }) => ({
		siteName: f.text(255).required(),
	}))
	.options({
		timestamps: true,
		versioning: true,
		scoped: (ctx) => ctx.tenantId,
	})
	.hooks({ beforeUpdate: async ({ data }) => {} })
	.access({ read: true, update: ({ session }) => !!session });
```

Admin/plugin extensions add `.admin()` and `.form()`.

Server CRUD API:

- `get(options?, context?)`
- `update(data, context?, options?)`
- `findVersions(options?, context?)`
- `revertToVersion(options, context?)`
- `transitionStage({ stage, scheduledAt? }, context?)`

Built-in HTTP routes:

- `GET /globals/:name`
- `PATCH /globals/:name`
- `GET /globals/:name/audit`
- `GET /globals/:name/meta`
- `GET /globals/:name/schema`
- `POST /globals/:name/revert`
- `POST /globals/:name/transition`
- `GET /globals/:name/versions`

### Fields

Built-in core fields:

- `f.text(maxLength?)`
- `f.textarea()`
- `f.email(maxLength?)`
- `f.url(maxLength?)`
- `f.number()`, `f.number("real")`, `f.number({ mode: "decimal" })`
- `f.boolean()`
- `f.date()`
- `f.datetime(config?)`
- `f.time(config?)`
- `f.select(optionsOrDynamicOptions)`
- `f.relation(target)`
- `f.upload(config?)`
- `f.object({ ...nestedFields })`
- `f.json(config?)`
- `f.from(...)`

Admin fields:

- `f.richText()`
- `f.blocks()`

Common field chain:

- `.required()`
- `.default(value)`
- `.label(text)`
- `.description(text)`
- `.localized()`
- `.inputFalse()`, `.inputOptional()`, `.inputTrue()`
- `.outputFalse()`
- `.virtual(expr?)`
- `.hooks(...)`
- `.access(...)`
- `.array()`
- `.operators(operatorSet)`
- `.drizzle(fn)`
- `.zod(fn)`
- `.fromDb(fn)`
- `.toDb(fn)`
- `.minItems(n)`, `.maxItems(n)`

Field type extension primitives:

- `fieldType(name, { create, methods })`
- `operator(valueHandler)`
- `operatorSet({ jsonbCast, column, jsonbOverrides? })`
- `extendOperatorSet(base, extensions)`

Relation field modes:

- belongs-to by default: `f.relation("users")`
- has-many: `.hasMany({ foreignKey })`
- many-to-many: `.manyToMany({ through, sourceField?, targetField? })`
- multiple IDs in JSONB: `.multiple()`
- polymorphic target map: `f.relation({ users: "users", posts: "posts" })`

### Routes

Definition API:

```ts
route()
	.post()
	.schema(z.object({ name: z.string() }))
	.outputSchema(z.object({ ok: z.boolean() }))
	.access(({ session }) => !!session)
	.handler(async ({ input, collections }) => ({ ok: true }));

route()
	.get()
	.raw()
	.handler(async ({ request }) => new Response("ok"));
```

Route builder methods:

- `.get()`, `.post()`, `.put()`, `.patch()`, `.delete()`
- `.raw()`
- `.schema(zodSchema)`
- `.outputSchema(zodSchema)`
- `.params<RouteParamsFromKey<"...">>()`
- `.access(rule)`
- `.handler(fn)`

Important current behavior:

- `.schema()` means JSON route.
- `.raw()` means raw `Request` to `Response`.
- No schema and no `.raw()` currently means raw route.
- HTTP route keys come from file paths; method suffixes like `[id].patch.ts` map
  to method-specific route keys.

Other built-in routes:

- `GET|POST /auth/:path*`
- `GET /health`
- `POST /realtime`
- `POST /search`
- `POST /search/reindex/:collection`
- `GET /storage/files/:key*`

### Services

Definition API:

```ts
service()
	.lifecycle("singleton")
	.namespace("services")
	.create(({ db, services }) => ({
		/* instance */
	}))
	.dispose(async (instance) => {});
```

Options:

- lifecycle: `"singleton"` or `"request"`.
- namespace: `"services"` by default, `null` for top-level context, custom namespaces
  for singleton services only.
- service factories receive `Questpie.ServiceCreateContext`, which is the generated
  `AppContext`.

Runtime access:

- In handlers: `{ services }`, `{ analytics }`, or top-level service names depending
  on namespace.
- Internally: `app.resolveService(name, requestDeps?, scope?)`.

### Jobs And Queue

Definition API:

```ts
job({
	name: "send-reminder",
	schema: z.object({ userId: z.string() }),
	options: { retryLimit: 3, retryDelay: 60, cron: "0 * * * *" },
	handler: async ({ payload, collections, email }) => {},
});
```

Queue API:

- `queue.<jobKey>.publish(payload, options?)`
- `queue.<jobKey>.schedule(payload, cron, options?)`
- `queue.<jobKey>.unschedule()`
- `queue.listen(options?)`
- `queue.runOnce(options?)`
- `queue.registerSchedules(options?)`
- `queue.createPushConsumer()`
- `queue.stop()`

Adapter capabilities are exposed as `queue.capabilities`.

### Auth

Definition/config API:

- `config/auth.ts` exports `authConfig({...BetterAuthOptions})`.
- `auth(options)` is a type-safe helper for Better Auth options.
- Core `auth` service creates `betterAuth({ ...config.auth, database:
drizzleAdapter(app.db) })`.
- The auth service is top-level in context as `auth`.
- `/auth/*` delegates to `app.auth.handler(request)`.

Access behavior:

- Collection/global CRUD default fallback requires a session when no rule/default is
  set.
- `starterModule` sets authenticated defaults for CRUD operations.
- Custom routes default to allowed unless `.access()` is set.

### Email

Definition API:

```ts
email({
	name: "welcome",
	schema: z.object({ name: z.string() }),
	handler: ({ input }) => ({
		subject: `Welcome ${input.name}`,
		html: `<p>Hello</p>`,
	}),
});
```

Mailer API:

- `email.send({ to, subject, html?, text?, ... })`
- `email.renderTemplate({ template, input, locale? })`
- `email.sendTemplate({ template, input, to, locale?, ... })`

Current runtime keys templates by codegen record key, not by `definition.name`.

### Admin Server Extensions

Server config:

- `adminConfig({...})` from generated `#questpie/factories`.
- `adminModule` contributes admin routes, services, collections, fields, views,
  components, and actions.

Collection extensions:

- `.admin(...)`
- `.list(({ v, f, a }) => ...)`
- `.form(({ v, f }) => ...)`
- `.preview(...)`
- `.actions(({ a, c, f }) => ...)`

Global extensions:

- `.admin(...)`
- `.form(({ v, f }) => ...)`

Field extensions:

- `.admin(...)`
- `.form(({ f }) => ({ fields: [...] }))`

Block API:

- `block(name)`
- `.admin(...)`
- `.fields(({ f }) => ...)`
- `.form(({ f }) => ...)`
- `.allowChildren(max?)`
- `.prefetch(fn)`
- `.prefetch({ with, loader? })`

OpenAPI extension:

- `openApiModule`
- `openApiConfig(config)`
- `generateOpenApiSpec(app, config?)`
- built-in routes: `GET /openapi.json`, `GET /docs`

## Recipes To Standardize

These are the recipes that should be first-class in docs and tests.

### Public Read, Authenticated Write

```ts
export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).required(),
		published: f.boolean().default(false),
	}))
	.access({
		read: true,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: ({ session }) => !!session,
	});
```

### User-Scoped Reads

```ts
.access({
  read: ({ session }) =>
    session ? { author: { eq: session.user.id } } : false,
});
```

### JSON Route With Access

```ts
export default route()
	.post()
	.schema(z.object({ period: z.enum(["day", "week", "month"]) }))
	.access(({ session }) => !!session)
	.handler(async ({ input, collections }) => {
		return collections.posts.count({ where: { status: { eq: "published" } } });
	});
```

### Raw Webhook Route

```ts
export default route()
	.post()
	.raw()
	.access(true)
	.handler(async ({ request }) => {
		const body = await request.text();
		return new Response(body);
	});
```

### Singleton Service

```ts
export const billing = service()
	.lifecycle("singleton")
	.namespace("services")
	.create(({ db }) => createBillingClient({ db }));
```

### Request Service

This should be a promoted recipe only after the framework creates and disposes
request scopes in the HTTP path.

```ts
export const currentTenant = service()
	.lifecycle("request")
	.namespace(null)
	.create(({ session }) => resolveTenant(session));
```

### After-Commit Side Effect

```ts
.hooks({
  afterChange: async ({ data, operation, queue, onAfterCommit }) => {
    if (operation === "create") {
      onAfterCommit(async () => {
        await queue.indexRecords.publish({ collection: "posts", id: data.id });
      });
    }
  },
});
```

### Email Template

```ts
export default email({
	name: "appointment-confirmation",
	schema: z.object({ bookingId: z.string() }),
	handler: async ({ input, collections }) => {
		const booking = await collections.bookings.findOne({
			where: { id: { eq: input.bookingId } },
		});
		return {
			subject: "Appointment confirmed",
			html: `<p>${booking?.id}</p>`,
		};
	},
});
```

### Block Prefetch

```ts
export const teamBlock = block("team")
	.fields(({ f }) => ({
		limit: f.number().default(4),
	}))
	.prefetch(async ({ values, ctx }) => {
		const res = await ctx.collections.teamMembers.find({
			limit: values.limit ?? 4,
		});
		return { members: res.docs };
	});
```

## Architectural Findings

### P0: Field Access Has Two Sources Of Truth

Current state:

- `field.access()` stores access on `fieldDef._state.access`.
- Collection/global CRUD runtime reads field access from `.access({ fields: ... })`.
- Introspection reads field access from `fieldDef._state.access`.

Impact:

- Admin can show a field as restricted while CRUD still returns or accepts it.
- CRUD can restrict a field while introspection says nothing about it.
- Users have no obvious way to know which API is authoritative.

Recommendation:

- Pick one public source of truth.
- Prefer field-local API for ergonomics:
  `secret: f.text().access({ read: false })`.
- During build, merge field-local rules into entity-level runtime rules, with clear
  override order.
- Keep `.access({ fields })` as advanced/bulk override or deprecate it.
- Add tests proving CRUD and introspection agree.

### P0: HTTP Custom Routes Execute Nested CRUD As System By Default

Current state:

- `executeJsonRoute` and `executeRawRoute` run ALS with `accessMode: "system"`.
- Handler args receive request context, but nested calls like
  `collections.posts.find({})` inherit ALS system mode.
- Custom route access defaults to allowed.

Impact:

- A custom HTTP route can accidentally bypass collection/global access rules.
- This conflicts with the mental model that HTTP requests are user-mode unless
  explicitly elevated.

Recommendation:

- For HTTP-executed routes, ALS should inherit `resolvedContext.accessMode`.
- Add explicit elevation API for backend-only routes, for example
  `.system()` or `collections.posts.find(opts, { accessMode: "system" })`.
- If keeping the current policy, the route builder should make it explicit in the
  API name/docs because it is a security-sensitive default.

### P0: Request-Scoped Services Are Not Framework-Scoped In HTTP

Current state:

- `RequestScope` exists and `resolveService(name, deps, scope)` supports it.
- The HTTP route execution path does not create a `RequestScope`.
- `extractAppServices()` accepts a scope but callers do not pass one.
- Request-scoped services are resolved per context extraction, not per request, and
  are not disposed automatically.

Impact:

- `lifecycle("request")` is semantically weaker than the name suggests.
- Multiple context extractions in one request can create multiple instances.
- Disposal hooks for request services are not reliably called.

Recommendation:

- Create a `RequestScope` in `createAdapterContext`.
- Thread it through `AdapterContext`, `executeJsonRoute`, `executeRawRoute`,
  hook/access context creation, block prefetch, mailer template rendering, and queue
  job execution where applicable.
- Dispose at the end of request/job/seed execution.
- Decide and document async request service behavior.

### P1: Scaffolds And Examples Are Out Of Sync With The Current API

Examples found in code comments and scaffolds include:

- `f.text("Title")`, but `text()` accepts a max length or `{ mode: "text" }`.
- `f.text({ required: true })`, but required is `.required()`.
- Route scaffold handler destructures `{ input, ctx }`, but route handlers expose
  flat `AppContext`, not `ctx`.
- Job scaffold destructures `{ payload, ctx }`, but job handlers expose flat
  `AppContext`, not `ctx`.
- Email scaffold uses `subject` and `render`, but current `email()` requires
  `name`, `schema`, and `handler`.
- Some route docs imply `route().get().handler(() => ({ ok: true }))`, but no-schema
  routes are raw `Response` routes.

Impact:

- New users hit compile errors immediately.
- The public API appears unstable even when the runtime implementation is coherent.

Recommendation:

- Treat scaffolds as API tests.
- Add a typecheck test that writes every scaffold template to a temp project and
  verifies it compiles.
- Update code comments in core/admin fields to the fluent builder style.

### P1: JSON Route Mode Is Too Coupled To `.schema()`

Current state:

- `.schema()` implies JSON route.
- `.raw()` implies raw route.
- No `.schema()` means raw route.
- `GET + .schema(z.object({}))` still parses request body, not query params.

Impact:

- Simple JSON routes require an empty schema even when no input is needed.
- GET JSON routes are awkward and likely to fail without a body.
- The route builder has no obvious way to say "JSON response, no input".

Recommendation:

- Add explicit route modes:
  - `.json()` for JSON result with no input.
  - `.body(schema)` for body input.
  - `.query(schema)` for query input.
  - `.params(schema)` or typed filename params for path params.
- Keep `.schema()` as alias for `.body()` on non-GET routes if needed.

### P1: Route Access Defaults Differ From CRUD Access Defaults

Current state:

- CRUD default fallback requires session when no access rule/default is set.
- Route access default is allow.

Impact:

- Developers can assume a global auth policy protects everything, but custom routes
  are open unless explicitly guarded.

Recommendation:

- Decide whether custom routes are backend-internal or HTTP-public by default.
- If public by default, require docs/scaffold to show `.access(...)` explicitly.
- If secure by default, use app default access or require session for routes too.

### P1: Job And Email Identity Can Drift From Codegen Keys

Current state:

- Job access is `queue.<codegenKey>.publish(...)`, but adapter queue name is
  `jobDef.name`.
- Email access is `email.sendTemplate({ template: <codegenKey> })`, but template
  definitions also have `name`.
- Codegen keys for jobs/emails are file/export based, not `definition.name`.

Impact:

- `jobs/send-reminder.ts` can define `name: "reminder"` and expose
  `queue.sendReminder.publish()` while the actual queue topic is `"reminder"`.
- Email `name` may not match the template key; the `name` field becomes misleading.

Recommendation:

- Either derive keys from `job.name` / `email.name`, or validate at codegen/build
  time that the definition name matches the discovered key convention.
- For emails, consider removing `name` if the codegen key is the actual public
  identity.

### P1: AppContext Runtime And Type Shape Differ

Current state:

- `extractAppServices()` includes `app` at runtime.
- Generated `AppContext` does not type `app`.
- Route args include `app: any`.
- Block prefetch context explicitly includes `app: unknown`.

Impact:

- Users see `app` in some handlers but not others.
- Escape hatch usage is not consistently typed or documented.

Recommendation:

- Decide whether `app` is a supported public escape hatch.
- If yes, type it in generated `AppContext` as the generated `App`.
- If no, remove it from public examples and route types; keep it internal only.

### P2: Collection And Global Builders Are Not Symmetric

Current differences:

- Collection has `.validation()`, global state has validation types but no builder
  method.
- Collection hooks merge when `.hooks()` is called repeatedly; global hooks replace.
- Collection has `.searchable()`, but the state supports `false` while the public
  method does not accept `false`.
- Collection has `.title()`, `.indexes()`, `.upload()`, `.softDelete`; globals do not.

Impact:

- Some differences are domain-correct, but others look accidental.
- Repeated builder extension calls compose differently between collections and globals.

Recommendation:

- Document intentional asymmetry.
- Make repeated `.hooks()` merge behavior consistent.
- Add `.searchable(false)` or remove `false` from the state contract.
- Add global validation API or remove unused global validation state.

### P2: Upload Has Two Meanings Under One Name

Current state:

- Collection `.upload()` turns a collection into a file collection with storage routes.
- Field `f.upload()` is a relation-like file picker/reference field.

Impact:

- Both are useful, but the naming is easy to confuse.

Recommendation:

- Standardize docs around "upload collection" vs "upload field".
- Consider aliasing field API as `f.file()` while keeping `f.upload()` for
  compatibility.

### P2: JSON Route Responses Have No Typed Status/Header API

Current state:

- JSON routes return data and `smartResponse()` wraps it as status 200.
- Non-200 status or custom headers require `.raw()`.

Impact:

- Users lose typed input/output ergonomics when they need common API response control.

Recommendation:

- Add a typed response helper, for example:
  `return json(data, { status: 201, headers })`.

## HTTP Adapter And Routes Repair Pass

What is already correct:

- `createFetchHandler()` is not a hardcoded endpoint switch. It compiles
  `app.config.routes` into a trie matcher, so core module routes and user routes
  flow through the same dispatcher.
- Built-in endpoints are registered as route files in the core module
  (`modules/core/routes/**`) rather than special-cased in the HTTP adapter.

Repairs applied:

- HTTP route execution now receives the full adapter context internally instead of
  only the lean `RequestContext`.
- The adapter context is carried through the route execution ALS scope behind a
  non-enumerable internal symbol and reused by `resolveContext()`, so the public
  route handler API and public context types stay flat.
- Public `executeJsonRoute()` / `executeRawRoute()` keep the lean `RequestContext`
  signature; the HTTP adapter uses internal executor variants for adapter context
  forwarding.
- Route ALS now preserves the resolved request `accessMode`; HTTP routes no longer
  silently escalate nested CRUD calls to `system`.
- Core module route wrappers can keep calling collection/global/search/storage/
  realtime handlers through the compatibility layer without custom session
  resolution, locale, stage, and context extensions being re-resolved or dropped.
- Route builder method helpers now match the declared `HttpMethod` surface, including
  `HEAD` and `OPTIONS`.
- Codegen scaffolds now emit current fluent field APIs and current job/route/email
  handler shapes.

Remaining adapter-level debt:

- `createAdapterRoutes()` and `create*Routes()` are still public compatibility APIs.
  The core route files still delegate to them internally, but now with forwarded
  context. A later pass should replace those wrappers with direct standalone handler
  calls or mark the legacy factories internal for the next major release.
- `RequestScope` exists but is not yet threaded through route execution, so
  `service().lifecycle("request")` is still request-like by convention rather than a
  deterministic HTTP lifecycle with disposal.
- `/questpie` legacy prefix stripping is still hardcoded in `createFetchHandler()`.
  It should become an explicit compatibility option before removal.

## Audit And Workflow E2E Pass

Scope checked:

- audit module registration, hooks, and audit log collection identity
- collection/global audit HTTP routes
- collection/global version routes and revert routes
- collection/global transition routes and scheduled transitions
- admin history sidebar fetch hooks and transition mutation hook
- workflow metadata emitted through introspection/admin config

Repairs applied:

- `auditModule` now registers its collection under the runtime slug
  `admin_audit_log`, matching `collection("admin_audit_log")`, route defaults,
  hooks, and admin sidebar config. The stale generated module key
  `auditLogCollection` made the module fail e2e even though mocked audit route
  tests passed.
- Audit hooks for globals no longer run multiple times. Global hooks were both
  injected into entity hooks and executed by the global hook executor.
- Collection and global audit routes now verify caller access to the target
  record/global before reading audit rows in `system` mode. The route still uses
  system mode for the audit log query, but only after target-resource access has
  succeeded.
- Global scheduled transitions now validate target stage, current record, access,
  and transition graph before publishing a future queue job.
- Scheduled transition dispatch now uses the core module queue client key
  `scheduledTransition` and keeps the old `"scheduled-transition"` key as a
  compatibility fallback.
- Admin transition mutations now invalidate broad collection/global query roots
  so stage badges, version queries, and form data refresh after transitions.
- Audit hook failures use the framework logger instead of writing directly to
  `console.error`.
- Audit actor labels are explicit: authenticated sessions use the user identity,
  `accessMode: "system"` without a session records `userId: "system"` /
  `userName: "System"`, and sessionless user-mode writes record `Anonymous`.
  Transition hook contexts now propagate `accessMode` so scheduled/system
  transitions do not appear as unknown actors.
- Create/delete audit entries now carry field snapshots in `changes`
  (`null -> value` on create, `value -> null` on delete), and all audit entries
  include basic actor/access context in `metadata`. New audit rows should no
  longer show empty JSON panels just because the event is a create.

Coverage added/strengthened:

- Real `auditModule` e2e: collection create/update/transition/delete audit,
  create/delete field snapshots, metadata actor/access context, global
  update/transition audit, system/anonymous actor labeling, and `admin.audit ===
  false` opt-out.
- Audit route security: collection/global audit endpoints do not expose audit
  rows when the caller cannot read the target resource.
- Scheduled transitions: default core queue job path, future scheduling,
  immediate past-date execution, queue processing, and global invalid-stage
  rejection before scheduling.

Audit view assessment:

- The current admin audit UX is functional but generic: audit log is exposed as a
  normal collection table/form plus a history sidebar embedded in collection/global
  forms.
- A production-grade audit module should add dedicated audit views instead of
  relying only on the generic collection table:
  - `auditTimeline` view grouped by time/resource/user/action
  - `auditDiff` detail view with structured before/after field diffs
  - resource-scoped audit drawer reused by collection/global forms
  - filters for user, action, resource type, resource, locale, date range
  - transition-focused rendering for workflow events
- This should be implemented as an admin module extension with registered views,
  not as hardcoded special cases in core/admin form screens.

Remaining audit/workflow debt:

- Audit retention exists as a cleanup job but has no typed config surface for
  retention policy, action filtering, or PII redaction.
- Audit entries record field diffs for collection updates but global update diffs
  are still coarse.
- Audit routes are core routes while the audit collection lives in the admin
  package. This is acceptable as an optional module seam, but it needs explicit
  docs: without `auditModule`, audit routes intentionally return empty arrays.
- Workflow stage metadata is duplicated in core introspection and admin config
  extraction. A shared serializer should own this shape.
- Scheduled transition jobs run in system mode and do not preserve actor identity
  unless actor metadata is added to the payload.

## API Surface Minimization Policy

Target shape:

- Stable public API should be small and primitive-oriented: factories, config,
  generated app/context, client SDK, and documented module/plugin extension points.
- Framework plumbing should stay internal: adapter context, route dispatch internals,
  compatibility route factories, CRUD generator internals, and concrete storage/search/
  realtime handler implementations.
- Public handler context should remain flat `AppContext` plus the route primitive's own
  data (`input`, `request`, `params`, `locale`). Do not add new handler args for
  framework plumbing.

Current surface leaks:

- `package.json` exports `./*`, which makes almost every source file importable as a
  package subpath.
- `questpie` main export re-exports many server internals for convenience.
- `createAdapterRoutes()` and `create*Routes()` remain public compatibility exports.
- Route handler `app: any` is an escape hatch without a clear stable contract.

Recommended minimization passes:

1. Define an explicit export manifest with three tiers: stable public, extension API,
   and internal.
2. Stop documenting internal subpaths and compatibility factories immediately.
3. Add deprecation warnings/JSDoc to public compatibility exports that should disappear
   in the next major.
4. In the next major, remove publish-time `./*` exports or replace them with explicit
   subpaths only.
5. Keep future repairs behind existing context/registry mechanisms instead of adding
   new user-facing arguments or duplicate helper APIs.

## Test Coverage Policy

Production-grade rule:

- Every public option must have at least one behavior test proving the option is
  accepted, wired to runtime behavior, and does not bypass access/context semantics.
- Every compatibility path must have a regression test before it is changed or removed.
- Every internal bridge that protects public API shape must have a public-surface test
  proving the plumbing does not leak into handler args or generated declarations.

Coverage added in this pass:

- `AdapterConfig.basePath`: normalized `api/` prefix and non-matching path returns
  `null`.
- `AdapterConfig.accessMode`: adapter value is propagated into route ALS.
- `AdapterConfig.getLocale`: resolver value is used; query `locale` takes precedence.
- `AdapterConfig.getSession`: resolver result reaches handler context.
- `AdapterConfig.extendContext`: receives the base context and merges custom values.
- Explicit `AdapterContext`: bypasses adapter resolvers and still reaches handlers.
- `AdapterConfig.search.reindexAccess`: custom override and default collection-update
  fallback are both covered.
- `AdapterConfig.storage.collection`: explicit storage alias selection is covered,
  plus single-upload and multi-upload fallback paths.
- Internal adapter context bridge: symbol storage is non-enumerable, idempotent for the
  same context, rejects replacement, and is not visible as route handler args.

Next coverage targets:

1. Route builder modes: `raw`, `schema`, `outputSchema`, multi-method chaining,
   method mismatch 405, body parse failures, query-vs-body semantics for GET.
2. Collection/global option parity: access, hooks, validation, localization,
   versioning/workflow, search, uploads, timestamps, soft delete.
3. Service lifecycle options: singleton/request, namespace/default/null/custom,
   dispose timing, async factory behavior, request scope disposal.
4. Codegen plugin declarations: every category option, discover pattern option,
   registry option, callback proxy, key derivation rule, and scaffold template.
5. Export-surface tests: generated declarations for `questpie`, `questpie/client`,
   `questpie/shared`, and future explicit subpaths must not expose internal modules.

## Recommended Architecture Direction

1. Make "context-first" literal: every handler should receive one consistent flat
   `AppContext` shape, with clear rules for whether `app` is public.
2. Make identity single-source: collection/global/block/view/component already mostly
   use factory string identity; jobs and emails should join that model.
3. Make access single-source: field access needs one authoritative API shared by CRUD
   and introspection.
4. Make route mode explicit: raw vs JSON, body vs query, user vs system.
5. Make services truly scoped: request lifecycle should create, memoize, and dispose
   a request scope.
6. Make scaffolds executable API contracts.
7. Make primitive coverage measurable: each primitive should have a documented set of
   first-class use cases, plus tests that prove runtime, types, and generated APIs
   stay aligned.

## Suggested Implementation Order

1. Fix scaffolds and stale examples/comments. This is low-risk and immediately improves
   developer trust.
2. Add tests for field access parity between CRUD and introspection, then unify field
   access source of truth.
3. Decide whether route access should default like CRUD access. Route execution now
   preserves request access mode, but route access still defaults to allow.
4. Thread `RequestScope` through HTTP execution and dispose it deterministically.
5. Add identity validation for jobs and emails.
6. Build a use-case coverage matrix as a living test plan for every primitive.
7. Clean up collection/global asymmetries and document intentional differences.
