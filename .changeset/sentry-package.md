---
"@questpie/sentry": minor
---

New package: `@questpie/sentry`, Sentry error reporting for QUESTPIE.

- `@questpie/sentry/server`: `sentryErrorReporting()`, an adapter for `runtimeConfig({ errors: { adapter } })`. It reports the framework's HTTP and queue failures and your own `errors.report()` calls.
- `@questpie/sentry/browser`: `createBrowserErrorReporter()`, `installGlobalErrorHandlers()` and `createRouterErrorReporter()`. The last one plugs into TanStack Router's `defaultOnCatch` and reports the route template, not the URL.
- `@questpie/sentry/vite`: `questpieSentryVite()`. It injects debug ids, uploads source maps with `SENTRY_AUTH_TOKEN`, hides maps from bundles and deletes them after upload.

Events are built from an allowlist: the error type, sanitized stack frames (credentials, query strings, invite tokens, ids and e-mails removed from file names) and the validated report fields. Error and cause messages, local variables, source context, requests, sessions, users, payloads, breadcrumbs, spans, logs and replays are never sent. The sanitizer never calls user getters, `toJSON` or `toString`.

Only `@sentry/core` 11.9.0 is used, with no `Sentry.init`, so no global Sentry scope or OpenTelemetry provider is registered and existing `@questpie/observability` setups are untouched. Requires Node 20.19+, 22.12+ or 23.2+.
