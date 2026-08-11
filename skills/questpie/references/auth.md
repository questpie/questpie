---
name: questpie-core-auth
description:
  QUESTPIE authentication Better Auth authConfig emailAndPassword requireEmailVerification socialProviders OAuth google plugins anonymous admin role banned session user collection authClient signIn signUp signOut useSession createAdminAuthClient getContext auth callbacks
  - questpie-core
---

# Authentication Reference

Detailed authentication configuration for QUESTPIE using Better Auth.

## Contents

- [File Convention](#file-convention), `config/auth.ts`, `authConfig()` factory
- [Configuration Options](#configuration-options), options table + effective defaults
- [Social Providers (OAuth)](#social-providers-oauth), `socialProviders`, verified Google/GitHub entry catalog, client `signIn.social`
- [Session Access](#session-access), routes, hooks, access rules
- [User Collection](#user-collection), starter user model, merge + extend recipe
- [Reaching the App from Better Auth Callbacks](#reaching-the-app-from-better-auth-callbacks), `getContext<App>()`, partial overrides
- [Client-Side Auth (authClient)](#client-side-auth-authclient), sign-in/up/out, `useSession`
- [Environment Variables](#environment-variables)
- [Production Security Checklist](#production-security-checklist)

## File Convention

Auth is configured via `config/auth.ts` using the `authConfig()` factory:

```ts
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie/app";
export default authConfig({
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
	},
	baseURL: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
	secret: process.env.BETTER_AUTH_SECRET || "change-me",
});
```

Codegen discovers this file automatically. No manual registration needed. Your config is merged over every module's `config.auth`, including nested modules. The starter module contributes the default `admin()` and `bearer()` Better Auth plugins (plugins are deduped by ID), so you only need to declare the keys you want to change. In admin-enabled apps, keep `admin()` and `bearer()` explicit in app config as well so the auth contract is visible in the project.

## Configuration Options

Effective defaults below are what the `starterModule` ships (your config merges over it), not the bare Better Auth library defaults:

| Option                                      | Type      | Default       | Description                                                 |
| ------------------------------------------- | --------- | ------------- | ----------------------------------------------------------- |
| `emailAndPassword.enabled`                  | `boolean` | `true`        | Enable email/password authentication                        |
| `emailAndPassword.requireEmailVerification` | `boolean` | `true`        | Require email verification before login                     |
| `baseURL`                                   | `string`  | none          | Application public URL (used for OAuth callbacks)           |
| `basePath`                                  | `string`  | `"/api/auth"` | Auth API route prefix                                       |
| `secret`                                    | `string`  | none          | Session signing secret. **Must be 32+ chars in production** |

## Social Providers (OAuth)

Add OAuth providers via `socialProviders`. The same `baseURL` is used to build the redirect URI:

```ts
// config/auth.ts
import { authConfig } from "questpie/app";

export default authConfig({
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID || "",
			clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
		},
	},
});
```

Trigger the OAuth flow from the client with `signIn.social`:

```tsx
await authClient.signIn.social({ provider: "google", callbackURL: "/" });
```

### Verified Google/GitHub Entry Catalog

Use `configureAuthEntryMethods()` when the product must expose a public sign-in
method catalog and must reject an unverified Google or GitHub identity before
QUESTPIE persists a user, account, token, or session. Declare and validate these
environment variables in `env.ts`; do not send provider secrets to the client.

```ts
// config/auth.ts
import { authConfig } from "questpie/app";
import { configureAuthEntryMethods } from "questpie/auth";

import env from "../env";

const entryMethods = configureAuthEntryMethods({
	authOptions: {
		baseURL: env.APP_URL,
		secret: env.BETTER_AUTH_SECRET,
	},
	credentials: { enabled: true },
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		},
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
		},
	},
	requireVerifiedProviderEmail: true,
	lastLoginMethod: {
		enabledWhenMultiple: true,
		storeInDatabase: false,
	},
});

export const publicAuthEntryMethods = entryMethods.publicMethods;
export default authConfig(entryMethods.authOptions);
```

Omit a provider property to disable that provider. If a provider is present,
both `clientId` and `clientSecret` must be non-empty. The helper accepts only
Google and GitHub, requires `emailVerified === true` plus non-empty provider ID
and email, disables implicit account linking, and returns `publicMethods` in the
stable `email`, `google`, `github` order without secrets. It also rejects social
providers passed through `authOptions`, provider `getUserInfo` overrides, and a
Google `verifyIdToken` override. Only the reviewed non-entry `admin`, `bearer`,
`open-api`, `jwt`, and OAuth authorization-server `oauth-provider` plugins may
pass through `authOptions`; every other plugin is rejected so it cannot add an
undeclared human entry method outside the catalog. The OAuth provider authorizes
an existing session and redirects an unauthenticated person to its configured
login page; it does not authenticate a new human identity itself.

The optional last-login method hint is enabled only when at least two methods
are configured and remains browser-only (`storeInDatabase: false`). Provider
callback failures are sanitized for the client; their raw diagnostics stay in
server logs. Explicit account linking remains a separate authenticated
operation.

## Session Access

### Generated Session Contract

`session.user.role` must be typed by the generated app. The role comes from Better Auth's `admin()` plugin, which is contributed by the starter module and folded through nested modules such as `adminModule -> starterModule`. App-local `config/auth.ts` is merged on top and can add more plugin or `additionalFields` session shape.

After changing `modules.ts` or `config/auth.ts`, run `questpie generate`. Then route handlers, hooks, services, access rules, `AppSession`, `AppSessionUser`, and `createAdminAuthClient<AppConfig>()` all see the same merged auth graph.

Never write `(session?.user as any)?.role`. If role is missing from the type, fix the module/auth/codegen chain.

### In Routes

```ts
import { route } from "questpie/services";
import z from "zod";

export default route()
	.post()
	.schema(z.object({ postId: z.string() }))
	.handler(async ({ input, session, collections }) => {
		if (!session) {
			throw new Error("Not authenticated");
		}

		const user = session.user;
		// user.id      - unique user ID
		// user.email   - user email address
		// user.name    - user display name

		const post = await collections.posts.create({
			title: "My Post",
			author: user.id,
		});

		return post;
	});
```

### In Hooks

```ts
.hooks({
  beforeChange: async ({ data, operation, session }) => {
    if (operation === "create") {
      if (!session) throw new Error("Must be logged in");
      data.createdBy = session.user.id;
    }
    return data;
  },
})
```

### In Access Rules

```ts
.access({
  // Public read
  read: true,

  // Authenticated users can create
  create: ({ session }) => !!session,

  // Only admins can update/delete
  update: ({ session }) => session?.user.role === "admin",
  delete: ({ session }) => session?.user.role === "admin",
})
```

## User Collection

The `starterModule` defines the canonical Better Auth `user` collection, including all its fields. It stores:

- `id` -- unique identifier
- `email` -- email address
- `name` -- display name
- `image` -- avatar URL
- `emailVerified` -- verification status
- `role` -- admin access role (`admin` or `user`)
- `avatar`, `banned`, `banReason`, `banExpires` -- profile and ban/access fields

The `adminModule` does not define these fields, it only `.merge()`s `starterModule.collections.user` and layers on the admin UI (label, list/form views, custom actions). Add either module to your config and the collection is created automatically.

Critical: the built-in admin setup route and admin `AuthGuard` depend on `user.role`. Setup checks whether any user has `role = "admin"`, and the admin UI expects `session.user.role === "admin"`. Do not replace `collection("user")` from scratch in an app that uses these modules; merge `starterModule.collections.user` and extend it if custom user fields or admin layout are needed.

```ts
import { starterModule } from "questpie/app";
import { collection } from "#questpie/factories";

export default collection("user")
	.merge(starterModule.collections.user)
	.fields(({ f }) => ({
		internalNotes: f.textarea(),
	}));
```

`.fields()` is cumulative -- it adds to the merged starter fields and overrides them by key, never wipes them, so this recipe keeps the full starter user model.

### Anonymous Users (Better Auth plugin)

Better Auth plugins that extend the user model follow the same recipe. For the anonymous plugin, register it in `auth.ts` (merged after the built-in plugins) and extend the starter user with the `isAnonymous` field the plugin expects:

```ts
// auth.ts
import { anonymous } from "better-auth/plugins";
import { authConfig } from "questpie/app";

export default authConfig({
	plugins: [anonymous()],
});
```

Use `authConfig()` (not a bare object with `satisfies AuthConfig`) so the session type is inferred from your plugins and flows into `createAdminAuthClient`.

```ts
// collections/user.ts
import { starterModule } from "questpie/app";
import { collection } from "#questpie/factories";

export default collection("user")
	.merge(starterModule.collections.user)
	.fields(({ f }) => ({
		isAnonymous: f.boolean().default(false),
	}));
```

Run `questpie generate` and apply migrations to add the column. Anonymous sign-in (`authClient.signIn.anonymous()` on the client) creates throwaway users that Better Auth can later link to real accounts.

## Reaching the App from Better Auth Callbacks

The `/auth/*` catch-all is a plain **raw route**, and raw routes execute their handler inside `runWithContext()` (the request's AsyncLocalStorage scope). That means every Better Auth callback, `onLinkAccount`, `databaseHooks`, `sendMagicLink`, plugin hooks, already runs inside the request scope, and `getContext<App>()` returns the live app, session, db, and locale.

**Never build a module-level app singleton or a hand-rolled context bridge for auth callbacks.** The `App` import stays type-only, so there is no circular import:

```ts
// config/auth.ts
import { anonymous } from "better-auth/plugins";
import { getContext } from "questpie";
import { authConfig } from "questpie/app";
import type { App } from "#questpie"; // type-only, no runtime cycle

export default authConfig({
	plugins: [
		anonymous({
			// Fires when an anonymous user signs in with a real account, // re-point the guest's rows onto the new user before the plugin
			// deletes the anonymous user.
			onLinkAccount: async ({ anonymousUser, newUser }) => {
				const { app } = getContext<App>();
				// Bare { accessMode: "system" } elevates ONLY the mode, // session, db, and locale inherit from the request scope (ALS).
				await app.collections.memberships.updateMany(
					{
						where: { user: anonymousUser.user.id },
						data: { user: newUser.user.id },
					},
					{ accessMode: "system" },
				);
			},
		}),
	],
});
```

### Partial Context Overrides

CRUD context normalization merges what you pass with the ambient request scope, priority: explicit param → ALS scope → defaults (`accessMode: "system"`, `locale: "en"`). Passing only `{ accessMode: "system" }` elevates the mode while the request's session/db/locale ride along. The inverse also holds: `{ accessMode: "user" }` inside system-scoped code re-enables access rules against the inherited session without re-threading it:

```ts
// Inside any handler, session comes from the request ALS scope
await app.collections.posts.find({}, { accessMode: "user" }); // rules enforced for the current user
await app.collections.posts.find({}, { accessMode: "system" }); // rules bypassed, same session/locale
```

## Client-Side Auth (authClient)

For session state and sign-in/out on the frontend, create a typed Better Auth client. In admin-equipped apps use the typed wrapper (session includes your merged user fields):

```ts
// src/lib/auth-client.ts
import { createAdminAuthClient } from "@questpie/admin/client";
import type { AppConfig } from "#questpie";
import { env } from "#questpie/env.client.vite"; // generated from env.client.ts

export const authClient = createAdminAuthClient<AppConfig>({
	baseURL: typeof window !== "undefined" ? window.location.origin : env.APP_URL,
	basePath: "/api/auth",
});
```

```tsx
const { data: session, isPending } = authClient.useSession();
await authClient.signUp.email({ email, password, name });
await authClient.signIn.email({ email, password });
await authClient.signIn.social({ provider: "google" }); // with a social provider
await authClient.signIn.anonymous(); // with the anonymous plugin
await authClient.signOut();
```

Apps without `@questpie/admin` use Better Auth's own `createAuthClient` from `better-auth/react` pointed at `${APP_URL}/api/auth`, same call surface, without the app-inferred session typing.

## Environment Variables

| Variable             | Required   | Description                                               |
| -------------------- | ---------- | --------------------------------------------------------- |
| `APP_URL`            | Yes        | Public URL -- used for OAuth callback URLs                |
| `BETTER_AUTH_SECRET` | Yes (prod) | Session signing secret. Use a random 32+ character string |

## Production Security Checklist

1. Set `BETTER_AUTH_SECRET` to a strong random value (32+ chars)
2. Serve `APP_URL` and all auth endpoints over HTTPS in production
3. Enable `requireEmailVerification` if using email/password
4. Configure proper CORS if API and frontend are on different domains
