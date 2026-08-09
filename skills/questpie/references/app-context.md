---
name: questpie-core/app-context
description:
  QUESTPIE AppContext runtime interface ctx hooks routes jobs services db session collections globals queue email storage kv logger search realtime t translator getContext tryGetContext createContext accessMode partial context override system user scope
  - questpie-core
---

This skill builds on questpie-core.

# AppContext, What's Available Everywhere

Human docs: [Context](https://questpie.com/docs/code/context) and
[service lifecycles](https://questpie.com/docs/code/services/lifecycles).

Every hook, route handler, job handler, and service receives `AppContext`, the core runtime interface.

```ts
interface AppContext {
	app: Questpie; // the app instance
	db: DrizzleClient; // Drizzle ORM (may be a transaction in hooks)
	session: { user; session } | null; // current auth session
	collections: { [name]: CollectionAPI }; // typed CRUD for all collections
	globals: { [name]: GlobalAPI }; // typed CRUD for all globals
	queue: QueueClient; // dispatch background jobs
	email: MailerService; // send emails
	storage: Files; // direct typed Files SDK storage operations
	kv: KVService; // key-value store
	logger: LoggerService; // structured logging
	search: SearchService; // full-text search
	realtime: RealtimeService; // server-side change-event subscription (broadcasts are automatic)
	t: (key, params?, locale?) => string; // i18n translator
	services: Record<string, unknown>; // user-defined services
}
```

## Where AppContext Is Available

| Context                                                                                 | How to Access                                                                                                                                 |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Collection hooks                                                                        | First argument: `async (ctx) => { ... }`                                                                                                      |
| Route handlers                                                                          | Destructure: `async ({ db, session, collections }) => { ... }`                                                                                |
| Job handlers                                                                            | Destructure: `async ({ payload, queue, email }) => { ... }`                                                                                   |
| Email templates                                                                         | Destructure: `async ({ input, collections }) => { ... }`                                                                                      |
| Access rules                                                                            | Destructure: `({ session, data }) => boolean`                                                                                                 |
| Seeds                                                                                   | `async ({ collections, log }) => { ... }`                                                                                                     |
| Services                                                                                | `create: (ctx) => ...`; request services see the caller, singletons start without one                                                         |
| Better Auth callbacks (`onLinkAccount`, `databaseHooks`, `sendMagicLink`, plugin hooks) | `getContext<App>()`, `/auth/*` is a raw route executed inside `runWithContext`, so the request scope is live there (see `references/auth.md`) |

## Getting Context Programmatically

```ts
import { app, createContext } from "#questpie";
import type { App } from "#questpie";
import { getContext, tryGetContext } from "questpie/types";

const ambient = getContext<App>(); // typed app/session/extensions; throws outside a request scope
const maybe = tryGetContext(); // returns undefined outside a request scope

// Create a lean RequestContext for CRUD overrides:
const requestContext = await app.createContext({
	session: null,
	locale: "en",
	accessMode: "system",
});

// Create a rich standalone AppContext with services:
await using standalone = await createContext({ accessMode: "system" });
await standalone.collections.posts.find({});
```

The standalone `services`, service namespaces, `collections` and `globals` stay
bound to that context's session, access mode and request-service scope until it
is disposed.

**Partial context overrides:** the second argument of every CRUD call merges with the ambient request scope (priority: explicit param → ALS scope → defaults). A bare `{ accessMode: "system" }` elevates **only** the mode, `session`, `db`, and `locale` inherit from the request automatically. The inverse works too: `{ accessMode: "user" }` inside system-scoped code re-enables access rules against the inherited session. Never re-thread session/locale by hand:

```ts
await app.collections.posts.find({}, { accessMode: "system" }); // mode elevated, request session/locale ride along
await app.collections.posts.find({}, { accessMode: "user" }); // rules enforced for the inherited session
```
