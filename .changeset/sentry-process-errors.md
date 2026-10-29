---
"@questpie/sentry": minor
---

- `installProcessErrorHandlers(app.errors)` from `@questpie/sentry/server` opts in to reporting uncaught exceptions and unhandled rejections with `source: "process"`. It waits for delivery up to `flushTimeoutMs` (2 s), then rethrows, so the process prints the error and exits as before; when the app has its own `uncaughtException` listener it only reports. On Bun, which does not raise unhandled rejections as uncaught exceptions unless run with `--unhandled-rejections=strict`, an `unhandledRejection` listener is added too. Returns a function that removes the listeners.
- The browser reporter drops a `route` with a URL scheme or host (`https://…`, `//…`), including one without a query string.
