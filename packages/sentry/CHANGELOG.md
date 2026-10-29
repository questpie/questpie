# @questpie/sentry

## 3.42.0

### Minor Changes

- [#446](https://github.com/questpie/questpie/pull/446) [`d39a5e7`](https://github.com/questpie/questpie/commit/d39a5e77cc14ca21182f919277b3b4eb9ad06a16) Thanks [@MartinRapcan](https://github.com/MartinRapcan)! - - `installProcessErrorHandlers(app.errors)` from `@questpie/sentry/server` opts in to reporting uncaught exceptions and unhandled rejections with `source: "process"`. It waits for delivery up to `flushTimeoutMs` (2 s), then rethrows, so the process prints the error and exits as before; when the app has its own `uncaughtException` listener it only reports. On Bun, which does not raise unhandled rejections as uncaught exceptions unless run with `--unhandled-rejections=strict`, an `unhandledRejection` listener is added too. Returns a function that removes the listeners.
  - The browser reporter drops a `route` with a URL scheme or host (`https://…`, `//…`), including one without a query string.

### Patch Changes

- [#446](https://github.com/questpie/questpie/pull/446) [`d39a5e7`](https://github.com/questpie/questpie/commit/d39a5e77cc14ca21182f919277b3b4eb9ad06a16) Thanks [@MartinRapcan](https://github.com/MartinRapcan)! - Sentry no longer stores the sender's IP or a location derived from it. Events now carry `sdk.settings.infer_ip: "never"` and an empty `user.geo`. Before, Sentry stored the connecting IP as the user of every browser event (`user: ip:…`) and added a city-level `user.geo` to every event, although the event itself contains no IP. The project's "Prevent Storing of IP Addresses" setting alone does not remove that location.

## 3.41.0

### Minor Changes

- [#442](https://github.com/questpie/questpie/pull/442) [`7996485`](https://github.com/questpie/questpie/commit/7996485771c2d7e7fa8f803d9ff4e9cf1ebc4619) Thanks [@drepkovsky](https://github.com/drepkovsky)! - New package: `@questpie/sentry`, Sentry error reporting for QUESTPIE.

  - `@questpie/sentry/server`: `sentryErrorReporting()`, an adapter for `runtimeConfig({ errors: { adapter } })`. It reports the framework's HTTP and queue failures and your own `errors.report()` calls.
  - `@questpie/sentry/browser`: `createBrowserErrorReporter()`, `installGlobalErrorHandlers()` and `createRouterErrorReporter()`. The last one plugs into TanStack Router's `defaultOnCatch` and reports the route template, not the URL.
  - `@questpie/sentry/vite`: `questpieSentryVite()`. It injects debug ids, uploads source maps with `SENTRY_AUTH_TOKEN`, hides maps from bundles and deletes them after upload.

  Events are built from an allowlist:

  - the type: a built-in error name or one listed in `errorNames`, otherwise `Error`;
  - stack frames: line and column, plus the file only when it is a build artifact registered by debug id (`questpieSentryVite`) or listed exactly in the server's `trustedFiles`, rewritten to `app:///` without host or query;
  - the validated report fields.

  Function names are not sent; Sentry restores them from source maps by debug id. Error and cause messages, local variables, source context, requests, sessions, users, payloads, breadcrumbs, spans, logs and replays are never sent. By default, inspection runs none of the thrown value's code (getters, proxy traps, `toJSON`, `toString`) and no stack-formatting hook, and the reporter never modifies globals. On the server it relies on Node's brand checks (`isNativeError`/`isProxy`); proxies and other values that fail those checks are reported as `NonError` with no frames. In the browser the only brand check is `Error.isError`, which may be a polyfill that runs getters (core-js's reads `Symbol.toStringTag`), so by default the thrown value is not inspected: objects are reported as `Error` and primitives as `NonError`, without frames. `formattedStacks: true` enables inspecting the value with the runtime's `Error.isError`; values that fail that check are reported as `NonError`.

  Stacks that Node and browsers format lazily run `Error.prepareStackTrace` when read, and the realm whose hook runs cannot be determined, so by default those errors are reported without frames. On Node 20 and Bun, where even inspecting the `stack` property formats it, nothing about it is read; on Node 22+ only a stack that is already a plain data property is read. The explicit opt-in `formattedStacks: true` (server adapter and browser reporter) reads them exactly as `error.stack` does, which runs whatever formatter is installed and may run any code it calls; the reporter's own reads stay free of getters and proxies.

  Only `@sentry/core` 11.9.0 is used, with no `Sentry.init`, so no global Sentry scope or OpenTelemetry provider is registered and existing `@questpie/observability` setups are untouched. Requires Node 20.19+, 22.12+ or 23.2+.
