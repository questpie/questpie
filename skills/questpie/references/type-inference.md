# Type Inference Reference

The schema is the single source of types. If you are hand-writing a type that restates a schema (a row shape, a session shape, a payload), stop, there is a sanctioned inference one-liner for it. Hand-rolled structural types drift silently (real schema `string | null` vs hand-rolled `string | undefined`) and structural mirrors of the CRUD generics produce deep error walls at every call site.

## The Map, "I Need Type X"

| #   | You need                                                        | Write exactly this                                                                                                                                                                                 | Notes                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Row of **another** collection                                   | `import type { CollectionDoc } from "#questpie"` → `CollectionDoc<"toys">`                                                                                                                         | Type-only import. See cycle rules below                                                                                                                                                                                                                             |
| 2   | Own row inside `.access()` / `.hooks()`                         | Nothing, `ctx.data` / `ctx.input` are already typed by the builder                                                                                                                                 | Never name your own doc type inside the defining collection                                                                                                                                                                                                         |
| 3   | Shared access-helper parameter                                  | Collection-imported helper: `AccessContext` from `"questpie"`. Anywhere else: `AccessRuleContext<"posts">` from `#questpie` (narrows `ctx.data`)                                                   | See cycle rules below                                                                                                                                                                                                                                               |
| 4   | Shared hook-helper parameter                                    | `HookContext` from `"questpie"` (collection-imported) or `HookRuleContext<"posts">` from `#questpie`                                                                                               | Same rules as #3                                                                                                                                                                                                                                                    |
| 5   | App/services in a function without a ctx param                  | `getContext<App>()` with `import type { App } from "#questpie"`                                                                                                                                    | Type-only `App` import, no runtime cycle                                                                                                                                                                                                                            |
| 6   | Global doc                                                      | `import type { GlobalDoc } from "#questpie"` → `GlobalDoc<"siteSettings">`                                                                                                                         | Same cycle rules as `CollectionDoc`                                                                                                                                                                                                                                 |
| 7   | Session / user shape                                            | In handlers: `ctx.session?.user` is typed. Standalone: `import type { AppSession, AppSessionUser } from "#questpie"`                                                                               | Generated from the app auth config                                                                                                                                                                                                                                  |
| 8   | Route input/output in the handler                               | Nothing, inferred from `.schema()` / return type                                                                                                                                                   |                                                                                                                                                                                                                                                                     |
| 9   | Route input/output standalone                                   | `InferRouteInput<typeof def>` / `InferRouteOutput<typeof def>` / `InferRouteParams<typeof def>` from `questpie/types`                                                                              | tRPC-style; `def` is the route file's default export                                                                                                                                                                                                                |
| 10  | Client-side types                                               | `createClient<AppConfig>()`, everything flows from the generic                                                                                                                                     | See `references/tanstack-query.md`                                                                                                                                                                                                                                  |
| 11  | Job payload in the handler                                      | Nothing, `payload` is typed from `schema`                                                                                                                                                          |                                                                                                                                                                                                                                                                     |
| 12  | Job payload standalone                                          | `InferJobPayload<typeof jobDef>` from `questpie/queue` (or `z.infer<typeof jobDef.schema>`)                                                                                                        |                                                                                                                                                                                                                                                                     |
| 13  | `db` / `session` inside job/workflow handlers                   | Honest gap: generated job context types them `unknown` today                                                                                                                                       | Use `collections` (typed) or narrow explicitly; do not restate schemas                                                                                                                                                                                              |
| 14  | Publishing jobs outside job files                               | `ctx.queue.<name>.publish(payload)`, payload typed                                                                                                                                                 |                                                                                                                                                                                                                                                                     |
| 15  | Relation target autocomplete                                    | Nothing, codegen populates `Questpie.CollectionKeys` from discovered files; `f.relation("…")` autocompletes after `questpie generate`                                                              | Plain strings always compile                                                                                                                                                                                                                                        |
| 16  | Realtime payloads                                               | `live()` / `liveIter()` snapshots are typed; raw `client.realtime.subscribe` data is untyped, annotate with `CollectionDoc<"posts">`                                                               | Typed realtime contract is planned                                                                                                                                                                                                                                  |
| 17  | Env vars                                                        | `env.ts` / `env.client.ts` with `env()`, see `references/env.md`                                                                                                                                   | Never `process.env.X!`                                                                                                                                                                                                                                              |
| 18  | Field-level rule ctx (`.access({ fields })`)                    | `doc` is typed as the row, `user` is typed from the generated session, destructure, don't annotate                                                                                                 |                                                                                                                                                                                                                                                                     |
| 19  | Derived request context (tenant, role)                          | `appConfig({ context })` result is inferred and arrives flat on rules, **annotate the resolver return with a self-contained DTO** (inferring it from `.find().docs` re-enters the generated index) | App-level `access` rules get the base ctx (`session`/`db`), not extensions, by design, cycle-free                                                                                                                                                                   |
| 20  | Select-option unions                                            | `CollectionDoc<"events">["type"]` (server-side)                                                                                                                                                    | No client-safe union export yet; clients infer from SDK responses                                                                                                                                                                                                   |
| 21  | `where` filter for a collection (esp. one built up dynamically) | `import type { CollectionWhere } from "#questpie"` → `CollectionWhere<"appointments">`                                                                                                             | Field keys are mutable, so `const where: CollectionWhere<"appointments"> = {}; if (x) where.status = "…"` type-checks. Same cycle rules as `CollectionDoc`. Inline `find({ where: { … } })` is already typed, reach for this only for a standalone/dynamic variable |

## The Two Cycle Rules

Type inference flows through the generated index (`#questpie`), and collections are part of that graph. Two rules keep every inference path compiling:

**Rule 1, inside the defining collection, trust builder inference.** `ctx.data` and `ctx.input` are already typed per operation (table below). Naming your own doc type (`CollectionDoc<"production_orders">` inside `collections/production-orders.ts`, or `ctx.data as OrderDoc`) forces TypeScript to resolve `typeof <own default export>` while that export's type is still being inferred, TS2456/TS7022, or worse, a silently degraded type.

**Rule 2, helpers imported by collections must not import generated aliases, and must cut the inference loop with an explicit return annotation.** The verified pattern (from `examples/toy-factory-backend/src/questpie/server/lib/access.ts`):

```ts
// lib/access.ts, imported by a collection, so:
//  - the helper param is the package-level AccessContext (cycle-safe)
//  - the return type is annotated explicitly with a CROSS-collection
//    CollectionDoc (type-only), this cut breaks the inference loop that
//    otherwise forms when the helper dereferences ctx.collections back
//    into the module graph (TS7022/TS2502 without it)
import type { AccessContext } from "questpie";
import type { CollectionDoc } from "#questpie";

export async function resolveOrderToy(
	ctx: AccessContext,
	toyId: string,
): Promise<{ toy: CollectionDoc<"toys"> | null; userId: string | null }> {
	const toy = await ctx.collections.toys.findOne(
		{ where: { id: toyId } },
		{ accessMode: "system" },
	);
	return { toy, userId: ctx.session?.user.id ?? null };
}

/** Narrow `data` structurally when the helper only reads a few fields. */
export function canCancelOrder(
	ctx: AccessContext<{ priority?: string | null }>,
) {
	if (ctx.data?.priority === "rush") return !!ctx.session?.user;
	return true;
}
```

`ctx.app`, `ctx.collections`, and `ctx.session` are fully typed on `AccessContext` through the (lazily merged) AppContext augmentation, the explicit return annotation stays mandatory in collection-imported helpers (it cuts the inference loop).

Helpers **not** imported by any collection (scripts, routes, services, jobs) may freely use `CollectionDoc<K>` in parameters and locals, Rule 2 only binds files that collections import.

## Per-Operation Access Rule Typing

`.access()` rules are typed per operation by the builder, no annotations, no casts:

| Rule                   | `ctx.data`                                  | `ctx.input`                         |
| ---------------------- | ------------------------------------------- | ----------------------------------- |
| `read`                 | not loaded (return `AccessWhere` to filter) | none                                |
| `create`               | none (no row exists yet)                    | typed insert shape (pre-validation) |
| `update`               | the existing row, **non-optional**          | typed update patch                  |
| `delete`               | the existing row, **non-optional**          | none                                |
| `transition` / `serve` | the existing row, non-optional              | none                                |

```ts
export default collection("production_orders")
	.fields(({ f }) => ({
		toy: f.relation("toys").required(),
		priority: f.select([{ value: "normal" }, { value: "rush" }]),
	}))
	.access({
		create: ({ session, input }) => !!session && input?.priority !== "rush",
		update: async (ctx) => {
			ctx.data; // typed row, non-optional, no `as` cast, no isRecord() dance
			ctx.input; // typed patch
			return (await resolveOrderToy(ctx, ctx.data.toy)).userId !== null;
		},
	});
```

The package-level helper types are exported from `questpie/types` (also re-exported from `questpie`): `AccessContext`, `RowAccessRule`, `AccessRule`, `AccessWhere`, `CollectionAccess`, `HookContext`, `FieldAccessRule`, `FieldAccessRuleContext`.

## Typed `getContext<App>()`

For functions that need the app without threading a ctx parameter (and for Better Auth callbacks, see `references/auth.md`):

```ts
import { getContext } from "questpie";
import type { App } from "#questpie"; // type-only, no runtime cycle

async function logActivity(action: string) {
	const { app, session, locale } = getContext<App>();
	await app.collections.activity_log.create({
		user: session?.user.id,
		action,
		locale,
	});
}
```

Untyped `getContext()` returns the bare context; the `<App>` generic types `app`, `session`, and the derived request-context extensions.

## Standalone Route And Job Types

```ts
import type { InferRouteInput, InferRouteOutput } from "questpie/types";
import type { InferJobPayload } from "questpie/queue";
import createBooking from "../routes/create-booking";
import sendReminder from "../jobs/send-reminder";

type BookingInput = InferRouteInput<typeof createBooking>;
type BookingResult = InferRouteOutput<typeof createBooking>;
type ReminderPayload = InferJobPayload<typeof sendReminder>;
```

## Key Registries (Advanced, Optional)

Names-only registries give `f.relation()` target autocomplete without entering the type graph (no imports, they cannot cycle). Codegen does **not** populate them yet; augment manually when you want the autocomplete:

```ts
// types/questpie-keys.d.ts (any ambient file)
declare global {
	namespace Questpie {
		interface CollectionKeys {
			toys: unknown;
			production_orders: unknown;
		}
		interface GlobalKeys {
			factorySettings: unknown;
		}
		interface JobKeys {
			sendReminder: unknown;
		}
	}
}
export {};
```

`f.relation("toys")` then autocompletes, while arbitrary strings keep compiling (`(string & {})` fallback), this is autocomplete, not strictness. `KnownCollectionKey` / `KnownGlobalKey` / `KnownJobKey` from `questpie/types` consume the registries in your own signatures.

## Escape Hatches (When Inference Needs Help)

For columns whose value type the field cannot infer, stay declarative, see `references/field-types.md`:

- `.zod(schema)`, type **and** runtime validation (preferred for `f.json()`)
- `.$type<T>()`, type-only narrowing
- `.drizzle(fn)`, raw column builder; `$type` on it narrows the value type

## Never Do

| Anti-pattern                                                               | Why                                                                      | Instead                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| Hand-rolled `EventDoc = { id: string; ownerUser?: string }`                | Silent nullability drift vs the real schema                              | `CollectionDoc<"events">` (row 1)   |
| `ctx.data as MemberDoc` inside own `.access()`                             | Builder already types it; self-key casts can cycle (TS2456)              | Trust `ctx.data` (row 2)            |
| Hand-rolled `CollectionsLike` / `AccessRuleCtx` ctx mirrors                | Structural matching of CRUD generics → deep error walls, tsc 5.9 crashes | `AccessContext` param (row 3)       |
| Module-level `app` singleton for callbacks                                 | Import cycles; stale instance in tests                                   | `getContext<App>()` (row 5)         |
| Collection-imported helper returning unannotated `ctx.collections` results | TS7022/TS2502 self-reference                                             | Explicit return annotation (Rule 2) |
| `const where: Record<string, unknown>` built by hand                       | No field/operator checking; silent drift from the schema                 | `CollectionWhere<"posts">` (row 21) |
