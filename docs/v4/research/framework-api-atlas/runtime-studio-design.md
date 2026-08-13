# Standalone Runtime, generated client, deployment, and Studio design

- Status: design evidence; no v4 acceptance authority
- Date: 2026-08-12
- Atlas tickets: #11 and #12
- Scope: Runtime/Fetch/generated-client lifecycle, deploy compatibility,
  Execution Envelope, `questpie explain`, and Studio
- Fixed authority: `SPEC.md`, ADR-0001, ADR-0003, ADR-0006, ADR-0007,
  ADR-0008, `docs/v4/schema-lifecycle.md`, and
  `docs/v4/definition-composition.md`

## Recommendation in one paragraph

Make the normal production interface three commands and no authored Runtime
file: `questpie build`, `questpie migration apply`, and `questpie start`.
`start` runs one matched immutable application bundle as a standalone
long-lived Runtime; by default the one process owns Fetch, Live Query
reconciliation, and durable workers. The generated `createApp()` loader exposes
the same semantic engine through `app.fetch`, `app.execution`, and `app.close`
for tests and special embedding. A generated client owns the versioned wire
protocol and creates immutable Context-scoped clients. Runtime lifecycle and
application transitions emit one append-only Execution Event family. Studio and
`questpie explain` consume the same compiled artifacts, current durable state,
and correlated events. They do not become another backend, SQL console, hidden
Admin CRUD path, host adapter, or provider abstraction.

This recommendation is design fiction. It fixes ownership and the smallest
developer/operator journey. Exact bundle, wire, event, health, and remote
operator protocols remain proof-blocked below.

## Product invariants

1. Runtime startup loads only compiler output. It does not scan source, inspect
   installed Packages, merge Definitions, or bind handlers by string at startup.
2. One build publishes one checksum-verified artifact set whose structural
   artifacts, executable slots, generated server contract, generated client
   contract, and Runtime ABI match.
3. Migration apply remains an explicit deployment step. `questpie start` never
   performs an unreviewed schema push or creates a migration from current source.
4. Direct, Fetch, generated-client, Live Query, durable-worker, and Studio calls
   enter the same Operation, Context, Policy, codec, error, and transaction
   engine.
5. Context input is transport-neutral application data. An application never
   configures `context.fetch.header(...)`, and no missing Request or Context
   value grants System Authority.
6. The standalone process owns accepting, readiness, draining, active
   Executions, realtime sessions, worker claims, resource disposal, and signal
   handling. An embedder that uses the low-level Fetch seam owns its outer HTTP
   server but must stop ingress before it closes the generated App.
7. PostgreSQL remains visible. Local PostgreSQL and supported managed
   PostgreSQL use the same artifacts and semantic Runtime. Provider differences
   pass concrete conformance profiles; they do not create a public provider SPI.
8. A deployment never silently runs a handler against another Manifest, Data
   Contract, Policy program, wire contract, or durable Definition version.
9. Health endpoints expose only coarse state. Detailed digests, lag, errors,
   identities, and recovery commands require the operational inspection
   contract.
10. Studio reads application data or changes it only through ordinary generated
    Operations and their Policy. Framework maintenance commands are separate,
    narrow, audited transitions; Studio never edits internal tables directly.
11. The Execution Envelope is a common immutable correlation header on
    append-only typed events, not one mutable record containing every possible
    lifecycle field.
12. Runtime state tables and accepted receipts remain the current durable
    truth. Events explain transitions and feed telemetry; a lossy OpenTelemetry
    exporter never becomes the only copy of a durable fact.

## The complete developer journey

### Build one matched deployable application

The zero-configuration local path remains:

```bash
bunx questpie build
bunx questpie migration apply
bunx questpie start --port 4000
```

For an immutable deployment, the same commands name the built directory
explicitly:

```bash
bunx questpie build --out dist/questpie
bunx questpie artifact verify dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie migration apply --bundle dist/questpie

DATABASE_URL="$DATABASE_URL" \
	bunx questpie start --bundle dist/questpie --port 4000
```

`--bundle` and the exact output directory spelling are candidates. The required
job is fixed: deploy and start use the bytes produced by the successful build,
not a later source scan or whatever happens to be in `.questpie/generated/`.

`questpie build` performs the accepted two-run structural determinism check,
the separate runtime graph typecheck/bundle, canonical artifact generation,
generated declaration checks, and complete artifact-set verification before it
publishes the directory. It fails without replacing the last complete build.

The matched set contains, at minimum:

```text
dist/questpie/
  manifest.json
  schema-projection.json
  origin-map.json
  build-input.json
  app.ts
  client.ts
  runtime-build.json          candidate new descriptor
  wire-contract.json          candidate generated protocol projection
  checksums.json              candidate complete file inventory
  server/                     compiler-owned executable slots and loader
  internal/                   compiler-private programs and projections
```

The accepted artifact names retain their existing meanings. A future
`runtime-build.json` must identify the compiler protocol, Runtime ABI,
executable-slot digests, Operation wire projection, required internal database
protocol, and file inventory. `checksums.json` proves file integrity; it does
not replace the semantic digests inside the artifacts.

One coarse bundle digest is not used as every compatibility decision. Moving a
source file can change Build Input and Origin bytes without changing Query
semantics. Operation wire compatibility, a Live Query dependency plan, a
durable pending run, and database schema compatibility each compare the exact
digests that affect that job.

### Start the normal standalone Runtime

The normal application has no `src/server.ts`, worker registration file, or
`defineRuntime({...})` Definition. The compiler already knows the Operations,
Routes, Context resolver, credential resolver, Live Query programs, Reactions,
Jobs, schedules, and executable slots.

```bash
# Equivalent to --role all.
bunx questpie start --port 4000
```

The candidate process roles are deliberately small:

```bash
# Fetch, Routes, generated protocol, Live Query sessions and reconciliation.
bunx questpie start --role api --port 4000

# Durable dispatch reconciliation, schedules and Reaction/Job attempts.
bunx questpie start --role worker
```

`all` is the default and the first conformance target. `api` and `worker` are
the same Runtime bundle with different owned loops, not application Resources,
Queue adapters, or separately generated programs. A deployment can scale them
independently only after cross-role wake, readiness, lease, and shutdown proofs
pass. No application handler branches on the role.

Startup proceeds through an observable state machine:

```text
loading bundle
  -> verifying files, artifact versions and cross-digests
  -> connecting to PostgreSQL and verifying provider profile
  -> verifying internal protocol, migration head and Schema Fingerprint
  -> starting owned listener/reconciler/worker loops
  -> reconciling durable Change Ledger and dispatch state
  -> ready
```

A checksum, artifact-version, Runtime-ABI, application binding, migration
history, schema drift, required PostgreSQL feature, or collation failure blocks
startup with its structured diagnostic. Runtime does not reinterpret such a
failure as an empty application. Temporary dependency loss after startup makes
readiness false and produces bounded call failures; it does not make liveness
false while the process can still report and recover.

### Scope and call the generated client

The browser-safe generated surface remains small:

```ts
// web/messages.ts
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "https://api.example.com",
	credentials: "include",
});

const company = client.withContext({ companyId });

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5_000);

try {
	const page = await company.queries["messages.page"](
		{ channelId, first: 20, after: null },
		{ signal: controller.signal, timeoutMs: 5_000 },
	);
	console.log(page.nodes);
} finally {
	clearTimeout(timeout);
}
```

The second call argument is a candidate common invocation option. `signal`
owns local cancellation. `timeoutMs` asks the Runtime for a shorter server
deadline; the effective deadline is the minimum of the Operation limit,
deployment limit, and request budget. A client cannot extend a server limit.
The generated client also aborts its Fetch when the signal fires.

`withContext` returns an immutable client view. It does not mutate `client`, a
global header, cookie state, or the transport. Two SSR requests or two Company
panes can safely use different views concurrently:

```ts
const northwind = client.withContext({ companyId: northwindId });
const contoso = client.withContext({ companyId: contosoId });

const [northwindFeed, contosoFeed] = await Promise.all([
	northwind.queries["messages.page"](northwindInput),
	contoso.queries["messages.page"](contosoInput),
]);
```

The client carries Context input in the generated versioned QUESTPIE protocol.
An author does not choose a header, body key, WebSocket field, or reconnect
frame for `companyId`. An application with an empty Context input uses the base
client directly.

Non-browser entries use the same Context contract:

| Root entry                    | Source of Context input                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| generated client call         | the immutable `client.withContext(...)` value encoded by generated protocol                                        |
| low-level framework Fetch     | the same generated wire envelope; a hand-written caller must follow that versioned contract                        |
| direct server/test execution  | explicit `context` passed to `app.execution(...)`                                                                  |
| raw third-party Route         | no invented Context; the Route validates its own protocol and enters a typed root Execution explicitly when needed |
| Live Query reconnect          | opaque client continuation plus the original typed Context input; Context Resolution runs again                    |
| Reaction/Job/Workflow attempt | the durable run-as recipe reconstructs typed Context input and creates a fresh Execution                           |
| Studio application-data call  | its immutable generated-client scope under the operator's explicit Principal                                       |

Credential headers/cookies and Context input are different. Auth resolves the
former into Principal. The Context Definition validates the latter and derives
Tenant and bounded immutable values. Policy still rechecks mutable membership
inside the owning Query snapshot or Mutation transaction.

### Watch the same Query and survive deployment

The generated client keeps `.watch` on the same Query member:

```ts
const stop = company.queries["messages.page"].watch(
	{ channelId, first: 20, after: null },
	(page, delivery) => {
		render(page);

		if (delivery.kind === "reset") {
			console.info("Fresh authorized snapshot", delivery.reason);
		}
	},
	{
		signal: pageAbort.signal,
		onStateChange: setConnectionState,
		onError: reportTerminalWatchError,
	},
);
```

The Runtime binds retained observation to the exact Query executable, output,
Policy, Context, Data Contract, normalized input, and authority partition.
During an ordinary retryable disconnect, the client sends an opaque continuation
token. The Runtime either proves continuation under the active deployment or
publishes a complete fresh `reset` result. An incompatible Query wire contract
ends the watch with a typed version error; reset cannot make an old decoder
understand a breaking output.

Draining a Runtime closes watches with a retryable server-draining reason after
it stops accepting new ones. Another compatible instance reauthorizes,
reconciles the durable Change Ledger, and resumes or resets. The client never
sees a ledger row, PostgreSQL transaction id, trigger id, or internal
reconciliation frontier.

### Call the same engine directly or through low-level Fetch

Generated direct execution remains the preferred server/test seam:

```ts
// scripts/read-messages.ts
import { createApp } from "#questpie/app";
import { principal } from "questpie";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

try {
	const page = await app.execution(
		{
			principal: principal.user({ id: principalId }),
			context: { companyId },
			signal: AbortSignal.timeout(5_000),
		},
		({ queries }) =>
			queries["messages.page"]({ channelId, first: 20, after: null }),
	);

	console.log(page.nodes);
} finally {
	await app.close();
}
```

`createApp()` loads the generated bundle and opens owned Runtime resources. It
does not compile source. `app.execution` creates one root Execution, runs
Context Resolution, and disposes its execution-scoped Services after the
callback. Its public input has no `authority: "system"` escape hatch.

The same generated object has the low-level Fetch seam:

```ts
const response = await app.fetch(request);
```

`app.fetch` receives and returns standard Fetch objects and owns QUESTPIE
protocol calls plus compiled Routes. It returns a `Response`; it is not a Hono,
Elysia, Next.js, Express, or Cloudflare adapter. A special embedder can mount or
forward requests to it and can inject a standards-compatible Fetch function in
the generated client for tests. QUESTPIE publishes no lifecycle-parity promise
for the surrounding host.

An embedder must stop its own ingress first, then call idempotent `app.close()`.
The standalone `questpie start` command owns that ordering automatically. The
exact embedded server-drain handle needs proof; it must not grow into the v3
host-adapter matrix.

## Generated wire protocol and version failure

Application authors normally never build this envelope. It is shown because
agents, operators, tests, and non-generated callers need an explainable
contract:

```ts
interface OperationCallEnvelopeV1 {
	protocol: { name: "questpie.operation"; version: 1 };
	application: `application:${string}`;
	clientContractDigest: string;
	operation: {
		identity: `query:${string}` | `mutation:${string}` | `action:${string}`;
		wireDigest: string;
	};
	callId: string;
	context: unknown;
	input: unknown;
	timeoutMs: number | null;
}
```

This shape is illustrative, not accepted canonical bytes. `context` and `input`
become exact codecs in the concrete generated client; they are `unknown` only
in this protocol-reader sketch. The server resolves credentials from the Fetch
request separately. Neither `Principal` nor `Authority` can be serialized in
the body by an ordinary client.

The protocol needs a closed safe failure family:

| Failure                                      | Required public behavior                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------- |
| malformed or oversized envelope              | reject before Context Resolution or handler execution                                  |
| unsupported protocol version                 | typed `protocolUnsupported` result with supported family, no operation inventory       |
| wrong Application Identity                   | typed `applicationMismatch`; never route to another loaded app                         |
| stale/incompatible Operation wire digest     | typed `clientOutdated` result naming only the requested safe identity and recovery     |
| Operation absent or not network-exposed      | one nondisclosing not-found result                                                     |
| Runtime not ready or draining                | typed retryable availability result; Mutations are never blindly retried by the client |
| deadline/cancellation before Mutation commit | transaction abort and no success result                                                |
| cancellation or response loss after commit   | committed call identity is inspectable; no claim that state rolled back                |
| output does not match compiled codec         | sanitized internal failure and correlated Runtime event; invalid bytes are never sent  |

The exact HTTP status, media type, path, body union, digest negotiation, and old
client compatibility window remain protocol proof work. The important boundary
is that generated code owns them once. Context Definitions, Operations, Route
handlers, and every frontend do not repeat transport fields.

`callId` is a correlation fact. It becomes Mutation deduplication authority
only after the response-loss/duplicate-delivery contract proves retention,
scope, payload conflict, and retry behavior. A generated client must not
automatically replay an ambiguous Mutation merely because the transport is
retryable.

## Health, readiness, drain, and shutdown

### Coarse health surface

The Runtime reserves two exact-path concepts; the final path spelling remains
a small protocol decision:

```text
GET /_questpie/health/live
GET /_questpie/health/ready
```

- Liveness says the process lifecycle can still run and report state. It does
  not query every dependency and remains true while draining until exit.
- Readiness says the instance can accept work for its selected role. It is
  false during startup, dependency degradation, incompatible database state,
  excessive unreconciled lag, and drain.
- Public health responses contain only coarse status and a stable reason class.
  They never include a database URL, Principal, Tenant, payload, source path,
  stack, Package inventory, or internal object name.
- Detailed diagnostics come from `questpie status`, `questpie explain`, Studio,
  and authenticated operational events.

Readiness for `all` requires every mandatory owned loop. Readiness for `api`
does not depend on worker throughput, but it does depend on Fetch, credential
resolution availability, database access, realtime listener/reconciliation
health when Live Query is enabled, and all deployed artifact/schema gates.
Readiness for `worker` depends on durable dispatch/run state, database time,
claim/lease capability, Definition compatibility, and scheduler/reconciliation
health; it does not require an HTTP port.

Migration apply is not a readiness action. A bundle whose expected migration
head or Schema Fingerprint does not match the database fails deploy/start with
the accepted schema diagnostic. A running instance whose database later becomes
temporarily unavailable changes readiness and fails bounded executions; it
does not invent or apply schema changes.

### Ordered drain

Standalone `SIGTERM` and `SIGINT` start one idempotent drain. An operator can
also request the same lifecycle transition through the narrow Runtime control
surface. Drain proceeds in this order:

1. Mark readiness false and reject new root Operation calls, Routes, watches,
   direct Executions, schedules, and worker claims with a retryable reason.
2. Stop acquiring durable reconciliation work. Keep already-owned leases and
   heartbeats alive while their attempts receive the grace period.
3. Let in-flight Queries, Mutations, Actions, Routes, streams, and worker
   attempts finish within their current deadlines and the smaller shutdown
   deadline.
4. Stop publishing new Live Query results and close sessions with an opaque
   retryable continuation/reset reason. The durable ledger remains the recovery
   authority.
5. Abort remaining execution signals. A pre-commit Mutation rolls back. A
   committed Mutation or already accepted external Action is not described as
   undone.
6. A worker that stops after abort cannot complete through a stale fence. If it
   cannot persist a safe retry transition, its lease expires and another worker
   reclaims the same logical run with a new attempt.
7. Dispose execution-scoped then application-scoped Services, listener
   sessions, pools, exporters, and the outer server in their owned order.
8. Emit the terminal lifecycle event and exit with a status that distinguishes
   graceful completion from forced timeout.

The Runtime never releases a worker lease while the old handler can still make
unfenced state transitions. A timeout aborts and fences local completion; it
does not make an irreversible external call disappear. Forced termination is
therefore visible as recovery work, not a fabricated successful drain.

V3 supplied useful behavior here: `app.queue.listen()` returned a stoppable
long-running worker, drained committed intent before consuming, reconciled
periodically, and installed graceful signal handling. Its queue adapter
capability matrix, authored worker entrypoint, duplicated `listen/runOnce/push`
models, and silent unsupported cron behavior do not carry into the default v4
standalone Runtime. V4 keeps the one-command start/stop job and makes the owned
role and degraded state explicit.

## Deployment and PostgreSQL compatibility

### One explicit deployment sequence

The safest first deploy contract is intentionally conservative:

```text
build and verify immutable bundle
  -> stop admitting old work and drain incompatible instances
  -> apply the bundle's committed migration chain
  -> verify target Schema Fingerprint
  -> start the new bundle
  -> reconcile Change Ledger and durable dispatch
  -> become ready
  -> send traffic
```

This sequence may have downtime for a schema-changing deploy. It is truthful
under the accepted linear transactional migration artifact. Zero-downtime
rolling schema change needs an explicit compatibility artifact for old and new
read/write sets; additive-looking SQL is not enough to infer it safely.

For a code-only compatible deploy, old and new instances can overlap only when
the deployment checker proves all shared database, wire, realtime, durable,
and internal-protocol requirements. Otherwise the old instance drains first.
`--force` cannot bypass this decision.

| Changed fact                                | Required behavior                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Origin-only relocation                      | regenerate diagnostics; semantic compatibility can remain unchanged                  |
| Query handler or Policy                     | old observation plan is invalid; recompute/reset under new exact digests             |
| compatible wire implementation              | old generated client may continue only through a proven retained wire contract       |
| incompatible Query/Mutation output or input | old client receives typed `clientOutdated`; no best-effort decode                    |
| Schema Projection or migration head         | explicit migration/drift gate before readiness                                       |
| Context resolver or credential mapping      | every new/recomputed Execution uses the new version; subscriptions repartition/reset |
| Reaction/Job executable with pending runs   | new deployment must retain a compatible executable or deployment blocks              |
| Workflow code with live history             | use the future pin/patch/proven evolution rule or block deployment                   |
| internal Runtime protocol                   | registered transactional upgrade under the bootstrap lock; never mutate v1 in place  |

Durable pending-run compatibility is more demanding than a browser client
refresh. Work already accepted cannot disappear because its source Definition
was removed. The first implementation may choose the KISS safe rule—block a
deploy that removes or incompatibly changes any Definition/version referenced
by non-terminal runs—before it implements multi-build workers or versioned
compatibility branches.

### Local and managed PostgreSQL use one contract

Local development and a supported managed deployment run the same build:

```bash
# Local PostgreSQL 16+
DATABASE_URL='postgres://postgres:postgres@localhost:5432/collaboration' \
	bunx questpie doctor

# The managed environment supplies its direct/session-capable endpoint.
DATABASE_URL="$MANAGED_DATABASE_URL" bunx questpie doctor
```

The accepted `questpie.json` PostgreSQL profile remains the declared minimum:
major version, exact database collation and ctype, extensions, and application
schema. `doctor`, migration apply, and Runtime startup verify the facts they
need. Migration/Seed session locks require the accepted direct or session-mode
endpoint. The Runtime also needs a dedicated session for `LISTEN`; a provider
or pool mode that cannot preserve it must use a separately proven configuration
or cannot claim the Live Query profile.

The first conformance matrix targets local PostgreSQL and one managed Supabase
PostgreSQL project, as required by `SPEC.md`. Neon, RDS, and other compatible
providers can be added through the same test suite. No application code imports
`SupabaseAdapter`, `NeonAdapter`, a generic database engine interface, or a
provider compiler plugin. A second genuinely different implementation is
required before an internal connection/capture seam becomes public.

## Design the Runtime interface three ways

### Variant A: authored `defineRuntime` and lifecycle plugins

```ts
export const runtime = defineRuntime({
	host: bunHost(),
	database: postgresProvider(),
	workers: queueProvider(),
	realtime: realtimeProvider(),
	health: { readinessPath: "/ready" },
});
```

This makes deployment choices look structurally composable, but most
applications have one supported implementation. It creates shallow adapters,
puts process/environment choices into compiler discovery, multiplies test
matrices, and recreates the v3 Module/provider architecture. Reject it as the
normal v4 interface.

### Variant B: one generated App plus CLI-owned standalone lifecycle

```bash
bunx questpie start
```

```ts
const app = await createApp({ postgres: { url } });
await app.fetch(request);
await app.execution(executionInput, callback);
await app.close();
```

This is the recommendation. The standalone CLI is a deep module: a tiny
interface owns verification, startup, requests, realtime, workers, signals,
drain, and disposal. The generated App exposes only the three useful low-level
jobs. Internal test seams can replace clocks, PostgreSQL pools, transports, and
event sinks without making them public application configuration.

### Variant C: official host adapters plus separate worker entrypoints

```ts
export default createNextHandler(app);
export const worker = createCloudflareQueueHandler(app);
```

This preserves familiar v3 embedding, but makes host lifecycle, streaming,
signals, context propagation, realtime, workers, and availability semantics an
N-by-M compatibility matrix. It also tempts providers to become semantic
owners. Keep low-level Fetch for deliberate embedding and reject an official
adapter matrix for v4.0.

## Execution Event and Envelope contract

### Use a small common envelope plus typed event bodies

The event family needs one stable correlation header, not one optional-field
mega-record:

```ts
interface ExecutionEnvelopeV1 {
	format: "questpie.execution-envelope";
	version: 1;
	eventId: string;
	occurredAt: string;
	application: `application:${string}`;
	deploymentDigest: string;
	executionId: string | null;
	traceId: string | null;
	correlationId: string;
	causationId: string | null;
	actor: {
		principalRef: string | null;
		tenantRef: string | null;
		authority: "ordinary" | "system" | "maintenance";
	};
	links: Array<{
		kind:
			| "operationCall"
			| "transaction"
			| "change"
			| "subscription"
			| "dispatch"
			| "run"
			| "attempt"
			| "effect"
			| "migration"
			| "seed";
		id: string;
	}>;
}

interface ExecutionEventV1<E extends ExecutionEventBodyV1> {
	envelope: ExecutionEnvelopeV1;
	durability: "durable" | "telemetry";
	event: E;
}
```

This is a candidate shape. The generated closed event-body union, exact ID
codecs, sorting, timestamp source, canonical bytes, redaction, persistence, and
retention need their own proof. A `links` array keeps correlation extensible
without adding dozens of nullable foreign keys to the common header. It is a
semantic set and would need deterministic ordering in any canonical form.

The common actor projection contains safe references and Authority class, not
cookies, tokens, credential headers, serialized Context, membership rows,
database URLs, Service state, or arbitrary payloads. Whether an identifier is
stored verbatim, hashed, encrypted, or omitted is a compiled privacy decision;
Studio cannot assume IDs are harmless.

Typed event bodies own their facts:

| Family            | Representative events and body ownership                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| Runtime lifecycle | build verified, connecting, ready, degraded, drain started, drain timed out, stopped                            |
| Operation         | accepted, input decoded, admission denied, handler started, result validated, declared error, failed, cancelled |
| Policy            | program identity, decision phase, safe branch/reason IDs, dependency counts; never matching evidence rows       |
| Transaction       | begun, lock wait, committed, rolled back, response lost/unknown; Runtime transaction identity                   |
| Realtime          | watch opened, dependencies replaced, change matched, dirty, recomputed, reset, lagged, closed                   |
| Durable           | dispatch accepted, run ready, attempt leased, heartbeat, retry scheduled, cancelled, terminal, ambiguous        |
| Action            | effect identity digest, provider correlation, known result, rejection, ambiguous outcome                        |
| Schema/Seed       | references to accepted plans, receipts, attempts, checksums, and drift diagnostics                              |
| Observability     | structured log, span link, metric/budget breach, audit command                                                  |

Facts whose survival is part of correctness are persisted atomically with their
owning state transition where possible. A committed dispatch, run attempt,
cancellation winner, or maintenance command cannot rely only on an in-memory
exporter. High-volume logs, spans, and metrics may be telemetry delivery with
explicit loss/backpressure semantics. Both use the same correlation vocabulary,
but `durability` prevents Studio from presenting a sampled span as an audit
receipt.

The accepted `questpie.internal.v1` bootstrap has no placeholder Execution
Envelope column or event table. Persisted Execution Events require a registered
new internal protocol and upgrade, for example `questpie.internal.v2`; the
implementation cannot mutate bootstrap v1 or retrofit unchecksummed columns
into accepted Migration/Seed receipts.

No single global event sequence is implied. PostgreSQL transaction order,
Change Ledger reconciliation, client acknowledgement, worker attempt order,
and telemetry-export order are different. Causation links and domain-specific
positions carry the actual guarantee.

### One correlated operator journey

For a successful `messages.submit`, Studio can follow this graph without
searching text logs:

```text
operation call
  -> root Execution and resolved Context
  -> Policy admission/evidence
  -> Mutation transaction
       -> Message rows
       -> Change Ledger facts
       -> messageSubmitted dispatch
  -> commit and encoded response

Change Ledger fact
  -> matching messages.page subscription
  -> fresh Execution + Policy + recomputation
  -> dependency replacement + result delivery/reset

messageSubmitted dispatch
  -> logical run
  -> physical attempt + fenced lease
  -> delivery Action + stable effect identity
  -> terminal result, retry, denial, cancellation, or ambiguity
```

Every arrow is a typed causation/link fact. The graph does not imply that all
nodes share one database transaction or one globally ordered timeline.

## Studio and `questpie explain`

### Studio is two narrow surfaces, not a second backend

Studio combines:

1. a read-only artifact and operational inspector over the compiled bundle,
   Runtime state, accepted receipts, and Execution Events; and
2. ordinary generated application Operations for safe data inspection and
   edits under an explicit operator Principal, Context, and Policy.

Framework maintenance commands such as cancel run, retry attempt, replay as a
new run, acknowledge ambiguity, or start drain are separately typed Runtime
commands. Each requires operator authorization, an explicit reason, exact
identity semantics, and an append-only audit event. Studio never updates
`questpie_internal` rows as generic Collection data.

Studio has no application `defineStudio`, dashboard builder, page schema,
navigation Augmentation, private Admin Collection methods, or Operator App
plugin model. A product-specific back office is an ordinary frontend using
`#questpie/client`.

### Required views

| View            | Same source of truth it presents                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Application     | Manifest Resources, Owners, accepted Augmentations, Origin Map, generated contract, executable and artifact digests               |
| Schema          | current desired projection, committed migration chain, plan/checksum/receipt, live fingerprint, drift, provider profile, Seeds    |
| Deployments     | Runtime build/ABI, wire contracts, active roles, readiness reasons, compatible clients, blocked pending runs/workflows            |
| Operations      | Query/Mutation/Action/Route calls, input/output codec versions, deadline/cancel, errors, transaction or snapshot, budgets         |
| Policy          | target Collection, operation phase, safe decision/reason, relational dependency graph, SQL pushdown, optional RLS projection      |
| Realtime        | Query/input digest, authority partition, current dependency kinds/count, ledger/wake/recompute state, lag, reset and close reason |
| Durable         | dispatch, run, attempt, lease/fence, heartbeat, retry/backoff, schedule, cancellation, dead letter, effect ambiguity and result   |
| Logs and traces | envelope-correlated structured logs/spans/metrics with sampling and durability labels visible                                     |
| Data            | only generated Policy-protected Operations and their exact selections; never raw SQL or inferred CRUD                             |
| Audit           | operator identity, reason, requested command, identity semantics, winner/result and correlated state transition                   |

Studio redacts by contract before data reaches its browser. Hiding a DOM cell
is not redaction. Policy evidence rows, credentials, durable secrets, raw error
objects, stack traces, and external provider payloads do not enter the Studio
wire result unless a separate safe projection explicitly allows them.

### CLI uses the same explanations

The compact CLI jobs are:

```bash
bunx questpie explain query:messages.page
bunx questpie explain mutation:messages.submit
bunx questpie explain --execution "$EXECUTION_ID"
bunx questpie explain --transaction "$TRANSACTION_ID"
bunx questpie explain --subscription "$SUBSCRIPTION_ID"
bunx questpie explain --run "$RUN_ID"
bunx questpie status --url http://localhost:4000
bunx questpie studio --url http://localhost:4000
```

Resource explanation can work from local generated artifacts. Runtime instance,
execution, subscription, and run explanations use the authenticated operational
protocol. Human and `--format json` output share identities, diagnostic codes,
safe values, and recovery commands. CLI does not scrape logs, and Studio does
not maintain a parallel event ontology.

Remote Studio operator authentication, authorization, CSRF protection, audit
retention, local loopback bootstrap, and multi-instance aggregation are a
focused security contract. Until it passes, the safe first surface is local or
explicitly trusted deployment access, not an accidentally public operational
Route.

## Where the types come from

| Callback or generated member               | Exact contextual type source                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `createClient` Operations                  | network-exposed Resources in the generated App Contract                              |
| `client.withContext`                       | the one compiled Context input contract                                              |
| Query/Mutation/Action input and output     | the concrete compiled Operation codec and wire digest                                |
| common call `signal`/`timeoutMs`           | generated base invocation options narrowed by Operation limits                       |
| `.watch` result and delivery               | the same Query output plus generated realtime delivery union                         |
| `createApp`/`app.execution` callback       | concrete generated server App Contract and ordinary root Execution input             |
| `app.fetch`                                | standard Fetch `Request`/`Response` plus generated protocol/Route matcher internally |
| `ctx.signal`, deadline and Execution facts | the closed Runtime Execution contract                                                |
| worker handler `ctx`, `run`, and `attempt` | owning durable Definition plus generated App Contract narrowed to its mode           |
| Studio application data                    | the same generated client members available to its explicit Principal/Context        |
| Studio operational events                  | the versioned closed Execution Event union, never an open log object                 |

The proof must compile the complete browser, direct, low-level Fetch, watch,
worker, and Studio-client examples. It must reject an unknown Context key,
server-only Operation, Operation input, lifecycle option, event kind, Studio
command, and System Authority construction. Generated declarations must contain
no ORM type, application-wide recursive generic, ambient registry, `any`, or
fallback `string` discriminant.

## V3 evidence to retain and delete

Retain these demonstrated developer jobs:

- one generated client can own typed Collection/Route calls and a standard
  Fetch function;
- one generated application factory can create isolated Apps for tests;
- the worker can drain committed intents before listening, reconcile them
  periodically, return a stoppable handle, and handle `SIGINT`/`SIGTERM`;
- graceful shutdown must stop request ingress before destroying application
  resources;
- direct and HTTP execution can share request scope and observability;
- production-server tests must wait for readiness and drain logs/processes on
  teardown.

Do not retain these v3 mechanisms:

- a user-authored worker file as the required happy path;
- queue capability probing and separate `listen`, `runOnce`, and push-consumer
  semantics in every application;
- silent cron omission on an unsupported adapter;
- mutable client locale/context state;
- broad client `AppConfig` generics and `any` transport payloads;
- `Response | null` host routing as a promise of equal host-adapter behavior;
- missing direct Request/context becoming system access;
- Runtime Module flattening, Admin-specific routes, or provider-owned
  application semantics.

The concrete v3 evidence is available at commit `11617485`, especially
`apps/docs/content/docs/code/jobs/workers.mdx`,
`packages/questpie/src/server/config/graceful-server-shutdown.ts`,
`packages/questpie/src/server/adapters/http.ts`, and
`packages/questpie/src/client/index.ts`. It is behavior evidence, not v4 source
authority.

## Proof blockers

No name in this note should become accepted or public before its bounded proof
passes.

### Build and executable binding

1. Freeze the Runtime Build, wire projection, file-inventory, checksum, and
   executable-slot artifacts with canonical bytes and version/digest domains.
2. Prove source relocation/permutation stability, handler-only change
   classification, corrupt/missing/extra file rejection, failed-build atomic
   replacement, and exact source-map/Origin explanation.
3. Prove the generated handler graph is excluded from structural evaluation,
   statically bound at Runtime load, and cannot bind to another Manifest.
4. Measure build time, cold start, bundle size, generated declaration size,
   TypeScript instantiations/check time, and memory before readiness.

### Fetch, client, Context, and errors

5. Freeze the exact Fetch path/media type, request/response frame, size limits,
   error union, call identity, wire digest, and old/new client compatibility
   matrix.
6. Prove generated client, hand-written Fetch, direct execution, nested calls,
   watched reconnect, and durable run-as reconstruct exactly the intended
   Principal/Context/Tenant/Authority facts without a transport-specific
   Context Definition.
7. Prove immutable scoped clients under SSR concurrency, credential refresh,
   two simultaneous Tenants, abort-before-send, disconnect, timeout, and
   response loss.
8. Close Mutation duplicate delivery and response-lost-after-commit semantics
   before the client automatically retries any ambiguous write.
9. Prove nondisclosing absent/unexposed/version errors do not enumerate the
   application contract or protected Resource existence.

### Lifecycle and PostgreSQL

10. Freeze lifecycle states, health paths/bodies, readiness dependencies,
    retryable reasons, exit codes, startup timeouts, and role semantics.
11. Kill the process during every startup and drain phase; prove no request is
    accepted before readiness and no resource is destroyed while an owned
    Execution can still use it.
12. Exercise Query, pre/post-commit Mutation, streaming Route, external Action,
    Live Query, worker heartbeat, lease loss, cancellation race, and forced
    shutdown during drain.
13. Prove migration-head/fingerprint/readiness behavior, internal-protocol
    upgrade, response-lost migration apply, and exact no-auto-migrate start.
14. Pass local PostgreSQL and managed Supabase conformance for sessions, locks,
    collation, triggers, `LISTEN`, Change Ledger, worker claims, restart, and
    drift. Document unsupported pooler/role modes precisely.
15. Prove `all`, `api`, and `worker` roles coordinate without losing ledger or
    dispatch work before role splitting is advertised.

### Deployment, realtime, and durable work

16. Freeze separate compatibility decisions for schema, Operation wire,
    executable, Policy/Context, Live Query observation, internal protocol, and
    durable Definition/history; do not hide them behind one bundle equality.
17. Prove code-only overlap, drain-before-migration, startup against older/newer
    database state, rollback to a prior build, and typed old-client failure.
18. Prove deployment-triggered Live Query recomputation/reset with no old
    dependency plan under new code, including the commit-safe ledger frontier
    and retained-token expiry.
19. Prove worker drain, stale lease fencing, pending-run Definition removal,
    retained executable policy, schedule ownership, and Workflow evolution
    before rolling durable deployment.

### Envelope, Studio, and operations

20. Freeze Execution Event identities, canonical envelope/event unions,
    causation/link rules, durability classes, clock/order guarantees, storage,
    retention, privacy, encryption, redaction, and export backpressure.
21. Prove atomic durable-event/state transitions where claimed and explicit
    loss/sampling for telemetry. An exporter outage must not block a business
    commit unless the accepted audit contract says it must.
22. Version the internal bootstrap through a registered upgrade rather than
    modifying `questpie.internal.v1`.
23. Prove Studio and CLI derive identical explanations from artifacts, Runtime
    state, receipts, and events after restart, retention, missing telemetry, and
    partial multi-instance availability.
24. Prove Studio data access uses generated Operations and Policy, operational
    inspection cannot disclose Policy evidence/secrets, and every maintenance
    command has authorization, reason, identity semantics, fencing, and an
    audit event.
25. Measure event volume, write amplification, query latency, retained bytes,
    Studio fanout, audit retention, and redaction cost under the realtime and
    worker load budgets.

## Candidate decisions ready for the focused design pass

The following ownership choices are strong enough to carry forward as design
constraints, but not yet accepted syntax:

1. CLI-first standalone Runtime, default `all` role, and no authored Runtime
   Definition on the happy path.
2. Generated `createApp()` with `fetch`, `execution`, and idempotent `close` as
   the complete low-level seam.
3. One generated versioned operation protocol shared by client and Fetch;
   Context input is encoded internally and never bound to an authored header.
4. Immutable `client.withContext(...)` and common per-call cancellation/deadline
   options.
5. Explicit migration apply and strict artifact/schema verification before
   readiness; no auto-push at startup.
6. Conservative drain-before-incompatible-deploy as the first truthful rule;
   rolling compatibility must be proven per contract.
7. Local and concrete managed PostgreSQL conformance without a public host,
   database, capture, queue, or provider SPI.
8. One small Execution Envelope over typed append-only events, with durable
   state and accepted receipts remaining authoritative.
9. Studio as artifact/runtime inspector plus ordinary generated application
   client; typed audited maintenance commands only, never raw internal-table
   edits or an Operator App builder.

## Decisions deliberately left open

- exact build directory, bundle filenames, checksum inventory, signing and
  supply-chain attestation;
- exact Runtime Build digest composition and executable slot/source-map format;
- exact Fetch route, content type, streaming frames, wire error status codes,
  client compatibility window and CDN/proxy behavior;
- exact `createApp`, `app.fetch`, invocation options, health paths, role names,
  graceful timeout and remote drain command spellings;
- whether split API/worker roles ship in the first beta or remain one-process
  conformance targets;
- temporary database outage retry policy and which degraded conditions remove
  readiness versus terminate the process;
- zero-downtime schema evolution and rollback compatibility artifacts;
- pending durable-run executable retention and Workflow versioning strategy;
- commit-safe Change Ledger frontier, realtime resume retention, and exact
  deployment reset algebra;
- canonical Execution Event schemas, storage and internal-protocol version;
- operator identity, remote Studio authentication, multi-instance aggregation,
  maintenance authorization, audit retention, and privacy policy; and
- whether a future managed Cloud signs bundles or operates fleet rollout. That
  control plane cannot change the open Runtime's application semantics.

These are the next focused proof inputs. None requires a public generic host or
provider seam, and none should be hidden by presenting Studio as a second
backend.
