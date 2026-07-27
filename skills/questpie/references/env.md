# Environment, `env.ts` + `env.client.ts`

Schema-declared, boot-validated environment variables. One schema, typed access on the server, codegen-emitted typed modules for every frontend bundler. **Never use raw `process.env.X` / `process.env.X!` in QUESTPIE app code**, declare the var in `env.ts` instead.

> **Scaffold default vs. this system.** A fresh `create-questpie` app validates env with `@t3-oss/env-core` in `src/lib/env.ts` - a plain app-level choice, not a framework requirement, and what `quickstart.md` / `production.md` show. The `questpie/env` system documented here (`env()` / `clientEnv()` convention files, boot-ordered validation, codegen-emitted typed client modules) is the framework-native alternative; adopt it when you want validation that fails before adapters/auth/db init and typed client env across bundlers. The two can coexist - pick one as the source for a given var.

## Server: `env.ts`

Lives beside `questpie.config.ts`. Default-exports `env()`, which validates **at module evaluation**:

```ts title="src/questpie/server/env.ts"
import { env } from "questpie/env";
import { z } from "zod";

import client from "./env.client"; // optional, only when you have client vars

export default env({
	client,
	server: {
		DATABASE_URL: z.url(), // tightens framework base var: optional → required
		BETTER_AUTH_SECRET: z.string().min(32),
		STRIPE_SECRET_KEY: z.string().startsWith("sk_").optional(),
		SMTP_PORT: z.coerce.number().default(587),
	},
	refine: (e) => {
		// cross-field boot guards, return (or throw) a message to fail boot
		if (e.NODE_ENV === "production" && e.BETTER_AUTH_SECRET === "dev-secret")
			return "BETTER_AUTH_SECRET must not be the dev default in production";
	},
});
```

Consume it via direct import, the path of least resistance:

```ts title="src/questpie/server/questpie.config.ts"
import { runtimeConfig } from "questpie/app";

import env from "./env";

export default runtimeConfig({
	db: { url: env.DATABASE_URL },
	secret: env.BETTER_AUTH_SECRET,
});
```

```ts title="src/questpie/server/jobs/send-invoice.ts"
import env from "../env";
// env.STRIPE_SECRET_KEY: string | undefined, typed, validated at boot
```

Also available as `app.env` (typed) on the app instance and `export const env` from `#questpie`.

### Semantics

- **Boot-validated**: codegen emits `import "../env"` as the FIRST import of `.generated/index.ts`, validation fails the process before `runtimeConfig()`, adapters, auth, and db init.
- **Aggregate errors, names only**: one error lists every offending var NAME. Values are never logged.
- **Framework base preset merged under your schema** (your keys win): `NODE_ENV` (enum, optional), `QUESTPIE_DB`/`DATABASE_URL`, `QUESTPIE_APP_URL`/`APP_URL`, `QUESTPIE_SECRET`/`BETTER_AUTH_SECRET`, `QUESTPIE_STORAGE_*`, all optional typed strings. `env.DATABASE_URL` is always typed; re-declare to make it required.
- **`emptyStringAsUndefined: true` by default**, `FOO=` in `.env` behaves as unset.
- **`QUESTPIE_SKIP_ENV_VALIDATION=1` skips validation**, `questpie generate`/`questpie dev` set it automatically; use it for Docker build stages and CI typecheck that import server code without secrets.
- **Server-only**: importing `env.ts` in a browser context throws. Client code uses the generated client modules.
- **Server keys must not use client prefixes**: `EXPO_PUBLIC_*`/`VITE_*`/`NEXT_PUBLIC_*`/`PUBLIC_*` in the `server` block is a compile error.
- **Standard Schema**: zod, valibot, and arktype schemas all work. Schemas must be synchronous.

## Client: `env.client.ts`

Client-safe vars with **unprefixed logical names** + the bundlers that consume them. Pure frozen definition, no validation, no env reads, imports only `questpie/env` + a validator:

```ts title="src/questpie/server/env.client.ts"
import { clientEnv } from "questpie/env";
import { z } from "zod";

export default clientEnv({
	consumers: ["expo", "vite"],
	vars: {
		APP_URL: z.url(),
		POSTHOG_KEY: z.string().optional(),
	},
});
```

Pass it to `env({ client })`. Server-side, client vars validate under the unprefixed name with prefixed fallback per consumer (`APP_URL ?? EXPO_PUBLIC_APP_URL ?? VITE_APP_URL`, unprefixed wins), one `.env` works for both sides.

### Generated per-consumer modules

`questpie generate` emits `.generated/env.client.<consumer>.ts` per declared consumer. Every var is a LITERAL prefixed member expression (the only form bundlers inline); server keys are physically absent:

```ts title=".generated/env.client.vite.ts (generated, do not edit)"
import _envClient from "../env.client";
import { resolveClientEnv } from "questpie/env-client";

export const env = resolveClientEnv(
	_envClient,
	{
		APP_URL: import.meta.env.VITE_APP_URL,
		POSTHOG_KEY: import.meta.env.VITE_POSTHOG_KEY,
	},
	"vite",
);
export type ClientEnv = typeof env;
```

Frontend usage (same app, via the `#questpie/*` alias to `.generated/`):

```ts title="src/lib/client.ts"
import { createClient } from "questpie/client";
import type { AppConfig } from "#questpie";
import { env } from "#questpie/env.client.vite";

export const client = createClient<AppConfig>({
	baseURL: typeof window !== "undefined" ? window.location.origin : env.APP_URL,
	basePath: "/api",
});
```

Separate frontend app in a monorepo, add a one-time export glob to the API package:

```json title="apps/api/package.json"
{ "exports": { "./env/*": "./src/questpie/server/.generated/env.client.*.ts" } }
```

```ts title="Expo app"
import { env } from "@acme/api/env/expo";
env.APP_URL; // string, from EXPO_PUBLIC_APP_URL, validated at import
// @ts-expect-error, server keys do not exist here
env.DATABASE_URL;
```

### Consumers

| Consumer | Prefix         | Inlined expression          |
| -------- | -------------- | --------------------------- |
| `expo`   | `EXPO_PUBLIC_` | `process.env.EXPO_PUBLIC_X` |
| `vite`   | `VITE_`        | `import.meta.env.VITE_X`    |
| `next`   | `NEXT_PUBLIC_` | `process.env.NEXT_PUBLIC_X` |

Custom: `{ name: "astro", prefix: "PUBLIC_", envObject: "import.meta.env" }`.

## Rules

| Severity | Rule                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| CRITICAL | No raw `process.env.X` / `process.env.X!` in app/server code, declare in `env.ts`, import `env` from there.     |
| CRITICAL | Secrets never go in `env.client.ts` vars, everything there ships in client bundles.                             |
| CRITICAL | Never edit `.generated/env.client.*.ts`, regenerate with `questpie generate`.                                   |
| HIGH     | Client code never imports `env.ts` (throws), import the generated `env.client.<consumer>` module.               |
| HIGH     | Set the PREFIXED spelling (`VITE_APP_URL`, `EXPO_PUBLIC_APP_URL`) in frontend build environments (EAS, Vercel). |
| MEDIUM   | Devtools-only toggles read by the bundler (e.g. `import.meta.env.DEV`) don't need declaration.                  |
