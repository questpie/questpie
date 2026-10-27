# @questpie/sentry

Sentry error reporting for QUESTPIE: a server adapter for the framework's
`errors` seam, a browser reporter with a router error-boundary bridge, and a
Vite plugin for private source map upload.

```bash
bun add @questpie/sentry
```

```ts
// questpie.config.ts
import { sentryErrorReporting } from "@questpie/sentry/server";
import { runtimeConfig } from "questpie/app";

export default runtimeConfig({
	errors: {
		adapter: sentryErrorReporting({
			dsn: process.env.SENTRY_DSN,
			release: process.env.RELEASE,
			environment: process.env.NODE_ENV,
			filenameRoot: process.cwd(),
			formattedStacks: true, // read Node's lazily formatted stacks
		}),
	},
});
```

| Entrypoint                 | Exports                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `@questpie/sentry/server`  | `sentryErrorReporting`                                                                  |
| `@questpie/sentry/browser` | `createBrowserErrorReporter`, `installGlobalErrorHandlers`, `createRouterErrorReporter` |
| `@questpie/sentry/vite`    | `questpieSentryVite`                                                                    |

Events are built from an allowlist:

- the error type, if it is a built-in name or listed in `errorNames`;
- stack frames with line and column, keeping a file only when it is a build
  artifact registered by debug id or listed in `trustedFiles`, rewritten to
  `app:///`;
- the framework's validated report fields.

Error messages, function names, requests, sessions, payloads, breadcrumbs,
tracing, logs and replays are never sent. No Sentry client or OpenTelemetry
provider is initialised.

Requires Node 20.19+, 22.12+ or 23.2+ (the Sentry 11 SDK floor).

Full guide: https://questpie.com/docs/infrastructure/error-reporting
