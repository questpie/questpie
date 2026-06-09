# Authentication Reference

Detailed authentication configuration for QUESTPIE using Better Auth.

## File Convention

Auth is configured via `config/auth.ts` using the `authConfig()` factory:

```ts
// src/questpie/server/config/auth.ts
import { authConfig } from "questpie/app";
export default authConfig({
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: false,
	},
	baseURL: process.env.APP_URL || "http://localhost:3000",
	basePath: "/api/auth",
	secret: process.env.BETTER_AUTH_SECRET || "change-me",
});
```

Codegen discovers this file automatically. No manual registration needed.

## Configuration Options

| Option                                      | Type      | Default       | Description                                                 |
| ------------------------------------------- | --------- | ------------- | ----------------------------------------------------------- |
| `emailAndPassword.enabled`                  | `boolean` | `false`       | Enable email/password authentication                        |
| `emailAndPassword.requireEmailVerification` | `boolean` | `false`       | Require email verification before login                     |
| `baseURL`                                   | `string`  | —             | Application public URL (used for OAuth callbacks)           |
| `basePath`                                  | `string`  | `"/api/auth"` | Auth API route prefix                                       |
| `secret`                                    | `string`  | —             | Session signing secret. **Must be 32+ chars in production** |

## Session Access

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
  update: ({ session }) => (session?.user as any)?.role === "admin",
  delete: ({ session }) => (session?.user as any)?.role === "admin",
})
```

## User Collection

The `adminModule` includes the starter auth model and provides the canonical Better Auth `user` collection. It stores:

- `id` -- unique identifier
- `email` -- email address
- `name` -- display name
- `image` -- avatar URL
- `emailVerified` -- verification status
- `role` -- admin access role (`admin` or `user`)
- `avatar`, `banned`, `banReason`, `banExpires` -- admin-managed profile and access fields

This collection is automatically created when you add the admin module to your config.

Critical: the built-in admin setup route and admin `AuthGuard` depend on `user.role`. Setup checks whether any user has `role = "admin"`, and the admin UI expects `session.user.role === "admin"`. Do not replace `collection("user")` from scratch in an app that uses `adminModule`; merge `starterModule.collections.user` and extend it if custom user fields or admin layout are needed.

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
import type { AuthConfig } from "questpie/app";

export default {
	plugins: [anonymous()],
} satisfies AuthConfig;
```

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

## Environment Variables

| Variable             | Required   | Description                                               |
| -------------------- | ---------- | --------------------------------------------------------- |
| `APP_URL`            | Yes        | Public URL -- used for OAuth callback URLs                |
| `BETTER_AUTH_SECRET` | Yes (prod) | Session signing secret. Use a random 32+ character string |

## Production Security Checklist

1. Set `BETTER_AUTH_SECRET` to a strong random value (32+ chars)
2. Set `APP_URL` to your production domain (HTTPS)
3. Enable `requireEmailVerification` if using email/password
4. Use HTTPS for all auth endpoints
5. Configure proper CORS if API and frontend are on different domains
