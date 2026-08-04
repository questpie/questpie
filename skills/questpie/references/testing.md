# Testing (@questpie/testing)

An opt-in package for testing a QUESTPIE app at three altitudes. Install it as a
dev dependency; nothing here ships to production.

```bash
bun add -d @questpie/testing
```

It has two entrypoints, and which one you import decides the altitude:

| Import                       | Runs                                   | Use for                                                |
| ---------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `@questpie/testing`          | your app in-process on PGlite          | access rules, hooks, jobs, most business logic         |
| `@questpie/testing/scenario` | a real built server on real PostgreSQL | anything the wire, the process or the database decides |

Everything is built from your generated app factory and public contracts. No test
here imports a QUESTPIE internal, and none is re-exported from the root
`questpie` barrel.

## Layer 1: the in-process app

`createTestApp()` builds a fresh app on its own PGlite database, runs your
committed migrations, and hands back typed actors.

```ts
import { createTestApp } from "@questpie/testing";

import { createAppForRuntime } from "#questpie/app-factory";

const harness = await createTestApp({ createApp: createAppForRuntime });
try {
	const { docs } = await harness
		.actor({ user: { email: "a@b.c" } })
		.run(({ app, context }) => app.collections.posts.find({}, context));
} finally {
	await harness.dispose();
}
```

### Actors

An actor is who the call runs as. `run()` gives the callback the app and a
context already carrying that actor's session, so the access rules you are
testing are the ones that execute.

| Method                 | Kind          | Session                                      |
| ---------------------- | ------------- | -------------------------------------------- |
| `harness.anonymous()`  | `"anonymous"` | none                                         |
| `harness.actor(input)` | `"user"`      | a seeded user                                |
| `harness.oauth(input)` | `"oauth"`     | a token with `clientId`, `scopes`, `tokenId` |
| `harness.system()`     | `"system"`    | none; skips the rules                        |

`system()` is the escape hatch for arranging fixtures. Assert through
`actor()`, or the test proves nothing about access.

### Options and lifecycle

```ts
interface TestAppOptions<TFactory> {
	createApp: TFactory; // your generated factory
	database?: PGliteTestDatabaseOptions; // kind: "pglite"
	runtime?: TestRuntimeOptions; // app.url, secret, adapters
	timeoutMs?: number;
}
```

`database.ownership` decides who closes the PGlite client. Pass your own
`client` and it stays open after `dispose()` unless you set
`ownership: "harness"`. `dispose()` is idempotent.

Setup failures throw `TestAppSetupError`. It carries the phase that failed
(`"database"`, `"app"`, `"migrations"` or `"readiness"`), the cause, and any
errors from the cleanup it attempted afterwards.
Teardown failures throw `TestAppCleanupError`. Neither is ever a silent skip.

### When PGlite is not enough

PGlite is Postgres compiled to WASM, in one process. Reach for Layer 2 when the
thing under test is something it cannot represent:

- more than one connection, so anything about pooling, locks between sessions or
  advisory-lock contention,
- extensions or server settings PGlite does not carry,
- the built server itself: startup, environment, signals, ports,
- a queue worker or realtime transport in its own process,
- HTTP: status codes, headers, cookies, uploads.

## Layer 2: the real scenario harness

```ts
import {
	createDisposablePostgres,
	startProductionServer,
	createHttpClient,
} from "@questpie/testing/scenario";
```

### Disposable PostgreSQL

`createDisposablePostgres({ adminUrl, migrate })` creates a uniquely named
database from an explicit admin connection, runs your migrations, and returns
`{ runId, name, url, dispose() }`. `dispose()` terminates sessions and drops that
database, and only that one.

The admin URL is required and checked. A non-PostgreSQL URL, a URL without an
administrative database, or a name outside the package grammar fails before any
SQL runs. `sweepStalePostgresDatabases()` removes package-owned databases past a
threshold, skipping any with a live lease, so concurrent runs cannot sweep each
other. Failures raise `DisposablePostgresSetupError` with the phase, or
`DisposablePostgresCleanupError`.

### The production server

`startProductionServer()` boots your built server command on a random loopback
port with an environment you list explicitly. It polls your readiness path and
returns `{ port, baseUrl, databaseUrl, pid(), logTail(), stop(), restart() }`.

`restart()` boots a fresh process on the same port and database, so fixtures
survive. `stop()` sends SIGTERM, escalates to SIGKILL after a bounded grace,
waits for exit and proves the port is free. Repeated stops share one result.
`ProductionServerStartError` carries the phase, exit code and a redacted log
tail; `ProductionServerStopError` carries every failure.

The child environment is built from scratch. `PORT`, `APP_URL`, `DATABASE_URL`
and `NODE_ENV` are the harness's to set and are rejected if you pass them.

### The HTTP client

`createHttpClient({ baseUrl, secrets })` is a transport, not an auth DSL. It
carries a cookie jar and shapes requests; who logs in and against which route
stays with your application.

```ts
const client = createHttpClient({ baseUrl: server.baseUrl });
await client.request("/api/auth/sign-in", { method: "POST", json: creds });
const me = await client.request("/api/me");
me.json<{ id: string }>();

await client.upload("/api/files/upload", {
	fields: { title: "avatar" },
	files: { file: { content: bytes, filename: "a.png", type: "image/png" } },
});
```

Every `Set-Cookie` on a response is absorbed, including several at once. A
repeated name replaces the old value and an expired one is dropped. Redirects
come back to you rather than being followed, so a login answering `302` is yours
to inspect. A response keeps its status, headers and raw body; `json()` throws
`HttpJsonError` holding the status and the raw text when the body is not JSON,
because that body is usually the error page you need to read.

### Evidence and cleanup

`createEvidence()` is the bounded ring every harness here uses. It caps lines and
characters per line, so a process that prints forever costs a fixed amount of
memory. Registered secrets are replaced longest first, before truncation. Give it
an `artifactDir` and a failing run writes a manifest and the captured output; a
passing run removes the directory.

`createCleanup()` tears down in reverse registration order, because a resource is
registered after the thing it depends on. Every step runs even when an earlier
one throws, and `CleanupError` carries all the failures rather than the first.
Repeated and concurrent calls share one result, and it works after a setup that
died halfway.

### Queue and realtime controls

`drainQueue({ pending })` waits for a queue to go quiet, where quiet means
several consecutive zero readings rather than the first. A job that enqueues its
follow-up leaves a gap where the queue reads as empty, and a drain that returns
on that gap is the flake that fails one run in twenty. It is bounded:
`QueueDrainError` names the last count it saw.

`cycleRealtimeTransport(control)` drops a transport and brings it back through
your own connect and disconnect. It writes to no ledger and no table, and it
reconnects even when the disconnect throws, because a transport left down breaks
every test after it.

Both take what to probe or drive from you, so neither names a queue, adapter or
channel.

## Public exports

| Entrypoint                   | Values                                                                                                                                                                                                                                             | Errors                                                                                                                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@questpie/testing`          | `createTestApp`                                                                                                                                                                                                                                    | `TestAppSetupError`, `TestAppCleanupError`                                                                                                                                      |
| `@questpie/testing/scenario` | `createDisposablePostgres`, `sweepStalePostgresDatabases`, `startProductionServer`, `createHttpClient`, `createEvidence`, `createCleanup`, `drainQueue`, `cycleRealtimeTransport`, `DEFAULT_MAX_EVIDENCE_LINES`, `DEFAULT_MAX_EVIDENCE_LINE_CHARS` | `DisposablePostgresSetupError`, `DisposablePostgresCleanupError`, `ProductionServerStartError`, `ProductionServerStopError`, `HttpJsonError`, `QueueDrainError`, `CleanupError` |

Types follow the value they belong to: `TestApp`, `TestActor`,
`TestActorRunContext`, `TestAppOptions`, `TestAppLifecycle`, `TestRuntimeOptions`,
`TestUserSeed`, `TestUserActorInput`, `TestOAuthActorInput`,
`PGliteTestDatabaseOptions`, `DisposablePostgres`, `DisposablePostgresOptions`,
`DisposablePostgresSetupPhase`, `SweepStalePostgresOptions`, `ProductionServer`,
`ProductionServerOptions`, `ProductionServerReadinessOptions`,
`ProductionServerStartPhase`, `HttpClient`, `HttpClientOptions`, `HttpCookieJar`,
`HttpRequestInit`, `HttpResponse`, `HttpUploadFile`, `HttpUploadInit`, `Evidence`,
`EvidenceOptions`, `EvidenceOutcome`, `EvidenceStream`, `Cleanup`,
`CleanupFailure`, `DrainQueueOptions`, `QueueDrainResult`,
`CycleRealtimeTransportOptions`, `RealtimeTransportControl`,
`RealtimeTransportCycle`.

## In CI

Layer 1 needs nothing but Bun. Layer 2 needs a reachable PostgreSQL and an
explicit admin URL, which the harness will not guess. A missing prerequisite is
an actionable failure, never a skip, because a scenario suite that quietly skips
is a suite that proves nothing on the day it matters.
