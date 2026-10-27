---
"@questpie/sentry": minor
---

New package: `@questpie/sentry`, Sentry error reporting for QUESTPIE.

- `@questpie/sentry/server`: `sentryErrorReporting()`, an adapter for `runtimeConfig({ errors: { adapter } })`. It reports the framework's HTTP and queue failures and your own `errors.report()` calls.
- `@questpie/sentry/browser`: `createBrowserErrorReporter()`, `installGlobalErrorHandlers()` and `createRouterErrorReporter()`. The last one plugs into TanStack Router's `defaultOnCatch` and reports the route template, not the URL.
- `@questpie/sentry/vite`: `questpieSentryVite()`. It injects debug ids, uploads source maps with `SENTRY_AUTH_TOKEN`, hides maps from bundles and deletes them after upload.

Events are built from an allowlist:

- the type: a built-in error name or one listed in `errorNames`, otherwise `Error`;
- stack frames: line and column, plus the file only when it is a build artifact registered by debug id (`questpieSentryVite`) or listed exactly in the server's `trustedFiles`, rewritten to `app:///` without host or query;
- the validated report fields.

Function names are not sent; Sentry restores them from source maps by debug id. Error and cause messages, local variables, source context, requests, sessions, users, payloads, breadcrumbs, spans, logs and replays are never sent. Inspection runs none of the thrown value's code (getters, proxy traps, `toJSON`, `toString`) and modifies nothing global. It relies on a native brand check (`isNativeError`/`isProxy` on the server, `Error.isError` in the browser); proxies, and every value in a browser without `Error.isError`, are reported as `Error` with no frames.

Stacks that Node and browsers format lazily run `Error.prepareStackTrace` when read, and the realm whose hook runs cannot be determined, so they are read only with `formattedStacks: true` (server adapter and browser reporter), which formats them exactly as `error.stack` does. Without it, frames are sent only for stacks that are already plain strings (Bun, or a stack your code assigned).

Only `@sentry/core` 11.9.0 is used, with no `Sentry.init`, so no global Sentry scope or OpenTelemetry provider is registered and existing `@questpie/observability` setups are untouched. Requires Node 20.19+, 22.12+ or 23.2+.
