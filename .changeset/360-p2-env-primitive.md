---
"questpie": minor
---

New env primitive: schema-declared, boot-validated environment variables with typed server and client access.

- **`env.ts` file convention + `env()` factory** (`questpie/env`): declare server vars with any Standard Schema validator (zod, valibot, arktype); validation runs at module evaluation and the generated app imports `env.ts` **before** the runtime config, so a misconfigured environment fails boot before adapters/auth/db init. Failures aggregate into one error listing every offending var **name** (values never logged). The framework base preset (`NODE_ENV`, `QUESTPIE_*`, `DATABASE_URL`, `APP_URL`, `BETTER_AUTH_SECRET`) is merged under the app schema — re-declare a base var to tighten it. Includes `refine` cross-field boot guards, `emptyStringAsUndefined` (default `true`), and a compile-time error for server keys with client prefixes (`VITE_*`, `EXPO_PUBLIC_*`, …).
- **`env.client.ts` + `clientEnv({ consumers, vars })`**: declare client-safe vars once with unprefixed logical names. Codegen emits one `.generated/env.client.<consumer>.ts` module per consumer (`expo`, `vite`, `next`, or custom) with literal prefixed references (`process.env.EXPO_PUBLIC_X`, `import.meta.env.VITE_X`) that bundlers can inline — server keys are physically absent by construction. Server-side, client vars validate under the unprefixed name with prefixed fallback per consumer.
- **`questpie/env-client`** export: tiny browser-safe `resolveClientEnv()` used by the generated modules.
- **`app.env`**: the validated env is stored on the app instance and typed via the generated app type; the generated index also re-exports it as `env`.
- **`QUESTPIE_SKIP_ENV_VALIDATION=1`** skips validation for env-less build/codegen steps; `questpie generate` and `questpie dev` set it automatically.

Purely additive — apps without `env.ts` behave exactly as before.
