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

Function names are not sent; Sentry restores them from source maps by debug id. Error and cause messages, local variables, source context, requests, sessions, users, payloads, breadcrumbs, spans, logs and replays are never sent. By default, inspection runs none of the thrown value's code (getters, proxy traps, `toJSON`, `toString`) and no stack-formatting hook, and the reporter never modifies globals. On the server it relies on Node's brand checks (`isNativeError`/`isProxy`); proxies are reported as `Error` with no frames. In the browser the only brand check is `Error.isError`, which may be a polyfill that runs getters (core-js's reads `Symbol.toStringTag`), so by default the thrown value is not inspected and every thrown object is reported as `Error` with no frames; `formattedStacks: true` enables inspecting it with the runtime's `Error.isError`.

Stacks that Node and browsers format lazily run `Error.prepareStackTrace` when read, and the realm whose hook runs cannot be determined, so by default those errors are reported without frames. On Node 20 and Bun, where even inspecting the `stack` property formats it, nothing about it is read; on Node 22+ only a stack that is already a plain data property is read. The explicit opt-in `formattedStacks: true` (server adapter and browser reporter) reads them exactly as `error.stack` does, which runs whatever formatter is installed and may run any code it calls; the reporter's own reads stay free of getters and proxies.

Only `@sentry/core` 11.9.0 is used, with no `Sentry.init`, so no global Sentry scope or OpenTelemetry provider is registered and existing `@questpie/observability` setups are untouched. Requires Node 20.19+, 22.12+ or 23.2+.
