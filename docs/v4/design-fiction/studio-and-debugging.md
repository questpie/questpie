---
title: Inspect and debug with Studio
description: Explain compiled Resources and follow one correlated execution through Runtime state.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - questpie explain over local artifacts and authenticated Runtime state
  - append-only typed Execution Events with one common Execution Envelope
  - Manifest, Origin, migration, Policy, transaction, realtime, and durable views
  - generated Policy-protected Operations for application data
  - narrow typed audited Runtime maintenance commands
  - identical CLI, Studio, telemetry, test, and future Cloud correlation vocabulary
proof-blocked-contracts:
  - canonical Execution Envelope and closed event-body union
  - event identities, causation links, clocks, ordering, durability, storage, and retention
  - internal-protocol upgrade for persisted Execution Events
  - operator authentication, authorization, CSRF, audit retention, and remote access
  - event privacy, identifier treatment, payload redaction, encryption, and export backpressure
  - multi-instance aggregation, partial availability, and missing-telemetry behavior
  - maintenance command identity, reason, fencing, retry, and winner semantics
  - Studio event volume, query latency, fanout, retained-byte, and redaction budgets
  - focused Execution Envelope and Studio Opus-medium acceptance review
---

# Inspect and debug with Studio

Studio explains one compiled QUESTPIE application. It joins the Compiled
Manifest and Origin Map to migration receipts, Runtime state, generated
Operations, and append-only Execution Events so you can follow a request from
source Definition through Policy, PostgreSQL, realtime, and durable work.

Start with the CLI when you know an identity:

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

Resource explanation works from the local generated artifacts. Execution,
transaction, subscription, and run explanation uses the authenticated
operational protocol of a Runtime instance. Human output and `--format json`
use the same identities, diagnostic codes, safe facts, and recovery commands.
The CLI does not scrape logs, and Studio does not maintain a parallel model.

## Explain source and generated behavior together

For a Resource, `questpie explain` starts with stable identity and follows the
compiler's owned projections:

```text
query:messages.page
  Owner       query:messages.page
  Origin      src/features/messages.ts:44
  Manifest    input, output, errors, Policy, limits, network exposure
  Executable  statically bound handler slot and Runtime-build digest
  Generated   server queries.messages.page and exact-key client member
  Data        observed Collection and Policy reads at Runtime
  Wire        exact operation contract and compatible client digests
```

The exact rendering is a candidate, but the facts are not reconstructed from
file naming or runtime import order:

- Resource Identity comes from the Definition;
- Owner and accepted Augmentations come from the Compiled Manifest;
- current source locations come from the Origin Map;
- schema ownership comes from the Schema Projection;
- executable binding comes from the matched Runtime build;
- network members come from the generated App Contract and wire projection;
- actual execution facts come from Runtime state and Execution Events.

Moving a file updates Origin without pretending the Resource was renamed.
Changing a handler can update executable and observation digests without
inventing a schema migration. Studio keeps those facts separate so a developer
can see exactly what changed.

## Read three schema truths without mixing them

The Schema view shows the three accepted facts side by side:

| Fact                                    | Authority                           | Studio evidence                                                    |
| --------------------------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| Compiled Manifest and Schema Projection | current Definitions and compiler    | desired Resources, PostgreSQL objects, digest, Owners, and Origins |
| Committed Migration chain               | reviewed version-controlled history | identities, plans, SQL, checksums, target snapshots, and receipts  |
| live Schema Fingerprint                 | connected PostgreSQL                | current catalog digest and exact Drift comparison                  |

Studio can show a Migration Plan, its safe, guarded, or destructive
classification, the exact Plan Digest, generated SQL, apply attempt, immutable
Migration Receipt, and post-apply Drift result. It does not create an
unrecorded `db push`, approve a destructive plan with a generic force button,
edit committed SQL, or repair Drift by changing PostgreSQL behind the
application's back.

The equivalent CLI remains the authoritative operational path:

```bash
bunx questpie migration plan --name add-message-delivery
bunx questpie migration create --plan "$PLAN_FILE"
bunx questpie migration apply
bunx questpie schema drift
```

If Studio later offers these actions, it submits the same typed command with
the exact plan identity and acknowledgement. A lost response uses the same
Migration Receipt retry behavior as the CLI.

## Follow one append-only Execution Envelope

QUESTPIE does not maintain one mutable mega-record with nullable fields for
every possible lifecycle. It emits a closed family of typed append-only events.
Each event carries a small common Execution Envelope that provides correlation:

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

This shape is deliberately marked candidate until canonical bytes, identity
codecs, ordering, privacy, persistence, and retention pass proof. Its ownership
rule is already clear: the envelope carries correlation and safe actor
references; each typed event body carries its domain facts.

| Event family      | Body owns                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Runtime lifecycle | build verification, connecting, ready, degraded, drain, timeout, and stop                                 |
| Operation         | accepted call, decode, admission, handler, validated result, declared error, cancellation, and failure    |
| Policy            | program identity, phase, safe decision/reason, dependency count, and SQL pushdown; never evidence rows    |
| Transaction       | begin, lock wait, commit, rollback, and response-lost or unknown outcome                                  |
| Realtime          | watch open, dependency replacement, change match, dirty, recompute, reset, lag, and close                 |
| Durable           | dispatch, logical run, physical attempt, lease, heartbeat, retry, cancel, terminal, and ambiguous outcome |
| Action            | effect identity digest, provider correlation, known result, rejection, and ambiguity                      |
| Schema and Seed   | accepted plan, checksum, attempt, receipt, and Drift references                                           |
| Observability     | structured log, span link, metric, budget breach, and audit command                                       |

The envelope never contains cookies, tokens, credential headers, serialized
Context, membership rows, database URLs, Service state, arbitrary provider
payloads, or raw Policy evidence. Safe identifier projection is itself a
compiled privacy decision; Studio does not assume every UUID is harmless.

## Understand durability and order

An event that proves a correctness transition is not allowed to exist only in
an in-memory telemetry buffer. A committed dispatch, attempt lease, terminal
result, cancellation winner, or maintenance command must survive according to
the state transition it explains. Logs, spans, and metrics may have explicit
sampling or loss semantics.

The `durability` discriminant prevents Studio from presenting a sampled span as
an audit receipt. Durable Runtime tables and accepted Migration and Seed
receipts remain authoritative; events explain their transitions and correlate
them with the rest of the application.

There is no invented global sequence across PostgreSQL commit order, Change
Ledger reconciliation, client delivery, worker attempts, and telemetry export.
Causation links and each domain's own position carry the real guarantee.
Persisting the new event family also requires a registered internal-protocol
upgrade; implementation cannot mutate the accepted `questpie.internal.v1`
bootstrap in place.

## Follow a Query and Policy decision

An Operation view starts at the compiled contract and then shows one execution:

```text
messages.page call
  -> credentials resolved to safe Principal reference
  -> Context input decoded and Context Resolution completed
  -> ordinary Authority and Tenant established
  -> Query snapshot opened
  -> Operation admission evaluated
  -> messages Policy and relational evidence lowered to SQL
  -> selected rows read and actual dependencies observed
  -> output codec validated
  -> result returned
```

Studio shows the Policy Resource and Origin, target Collection, decision phase,
safe reason identifier, relational dependency graph, SQL-pushdown status, and
the count and kind of observed dependencies. It does not show the membership
row that proved access, interpolate secrets into SQL, or fall back to reporting
a post-fetch filter as enforcement.

For a denied keyed read, Studio can correlate the internal Policy decision
without weakening the public nondisclosure result. The client still receives
the same `notFound` outcome for absent and Policy-invisible rows.

## Follow a Mutation through PostgreSQL

For `messages.submit`, the correlated view shows one transaction boundary:

```text
operation call
  -> root Execution and resolved Context
  -> admission and current-row Policy
  -> Mutation transaction
       -> server-owned values and candidate-row Policy
       -> Message row writes
       -> Change Ledger facts
       -> messageSubmitted dispatch intent
  -> commit
  -> validated response
```

The transaction view includes its Runtime identity, begin and lock-wait
timings, Operation time, touched semantic Resources, safe Policy decisions,
Change Ledger positions, dispatch identities, commit or rollback, and response
delivery state. It does not expose a raw transaction handle or imply that a
cancelled response rolled back an already committed write.

If the process dies after commit and before responding, the committed row,
Change Ledger fact, and dispatch remain visible. The call is correlated as a
response-lost or unknown client outcome rather than rewritten as failure.

## Follow realtime reconciliation

Starting from the same Query, Studio can explain a watched result:

```text
subscription opened
  -> authorized initial Query result
  -> observed data, Policy, Relation, tenant, and pagination dependencies
  -> Change Ledger position retained

committed change
  -> lossy wake or periodic reconciliation
  -> dependency match
  -> subscription marked dirty
  -> fresh Context Resolution and Policy
  -> complete Query recomputation
  -> successful dependency replacement
  -> update, reset, or typed close
```

The Realtime view shows Query and normalized-input digest, deployment and
authority partition, dependency kinds and counts, ledger and wake state,
recompute duration, lag, continuation status, and reset or close reason. It
does not send ledger rows, internal transaction identifiers, or Policy evidence
to the application client.

A wake can be lost without losing correctness because reconciliation reads the
durable Change Ledger. A failed recomputation does not replace the last
successful dependency plan. A deployment that changes Query, Policy, Context,
or Data contracts invalidates the old observation; the next compatible client
delivery is a fresh reset, while a breaking wire change is a typed
`clientOutdated` failure.

## Follow dispatch, Job, and Workflow history

The durable view connects committed intent to every attempt:

```text
messages.submit transaction
  -> messageSubmitted dispatch
  -> logical durable run
  -> physical attempt and fenced lease
  -> fresh run-as Context Resolution and Policy
  -> delivery Action with stable effect identity
  -> success, retry, denial, cancellation, ambiguity, or terminal failure
```

Studio shows dispatch identity and causation, durable Resource identity and
version, redacted input digest, run-as recipe, schedule or due time, `runId`,
`attemptId`, Runtime build, lease/fence, heartbeat, progress, deadline,
cancellation observation, retry classification, backoff, next availability,
safe error, and bounded result receipt.

A later Workflow uses the same view. Its history adds named Mutation, Action,
timer, and signal steps, wait state, version/evolution decision, compensation,
and result. Workflow does not create a second event system or hide its Job,
lease, timer, and effect facts behind text logs.

Ambiguous external effect outcomes stay ambiguous. An operator cannot click
`retry` and cause QUESTPIE to claim an unknown provider call was absent.
Replaying completed work creates a new logical run with explicit causation; it
does not mutate old history.

## Correlate logs and traces without making them truth

Handler logs, spans, metrics, budget violations, and audits use the same
Execution Envelope identifiers. A developer can filter from an Operation to
its transaction, subscription, dispatch, run, attempt, Action, log, and trace
without copying correlation IDs through application parameters.

An OpenTelemetry exporter is a consumer of the event vocabulary, not the only
copy of durable application facts. Sampling, exporter outage, and backpressure
are visible. They cannot silently erase a committed dispatch receipt or block a
business transaction unless a later accepted audit contract explicitly makes
that write synchronous.

## Inspect and change application data safely

Studio data access uses the same generated application client as a product
frontend:

```ts
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: runtimeUrl,
	credentials: "include",
});

const company = client.withContext({ companyId });

const page = await company.queries["messages.page"]({
	channelId,
	first: 50,
	after: null,
});

await company.collections.messages.update({
	key: { id: messageId },
	patch: { body: correctedBody },
});
```

Those exact generated members, codecs, Context Resolution, Policy decisions,
transactions, errors, and audits apply in Studio. If an application does not
expose a safe Operation for a task, Studio does not infer one from a table or
use a private Admin bypass.

Redaction happens in the server contract before data reaches the browser.
Hiding a DOM cell is not authorization. Credentials, Policy evidence rows,
durable secrets, raw error objects, stack traces, and provider payloads do not
enter Studio results unless a separate safe projection explicitly permits
them.

A product-specific back office remains an ordinary frontend built with the
same generated client. Studio has no `defineStudio`, page builder, navigation
Augmentation, dashboard schema, or private Collection API.

## Keep maintenance commands narrow and audited

Framework maintenance is not application CRUD. Commands such as drain an
instance, request cancellation, retry an eligible failed attempt, replay as a
new run, or acknowledge an ambiguous result use a separately typed operational
surface.

Every maintenance command requires:

- authenticated operator identity and explicit maintenance Authority;
- authorization for that exact command and target;
- a human or automation reason;
- exact identity, idempotency, race, and fencing semantics;
- a typed result that names the winning transition; and
- an append-only audit event correlated to resulting state.

Studio never updates `questpie_internal` rows through a SQL console or treats
them as ordinary Collections. A cancellation request cannot rewrite a terminal
run, a stale retry cannot bypass a live lease, and acknowledging ambiguity
cannot fabricate a known external result.

Remote operator authentication, CSRF, multi-instance aggregation, privacy, and
audit retention are proof-blocked. Until they pass, the safe first Studio is
local or explicitly trusted deployment access, not an accidentally public
application Route.

## Know where the types come from

| Studio or CLI value                                       | Exact type source                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Resource identity, Owner, and structural contract         | the concrete Compiled Manifest                                                 |
| source location                                           | the Origin Map for the same build                                              |
| schema plan, history, and Drift                           | Schema Projection, Committed Migrations, receipts, and live Schema Fingerprint |
| generated Query and Mutation calls                        | network-exposed Resources in the generated App Contract                        |
| Context scope                                             | the one compiled Context input contract                                        |
| Operation input, output, and errors                       | the concrete compiled Operation codecs                                         |
| Policy explanation                                        | compiled Policy program and its closed safe decision/reason projection         |
| transaction, subscription, dispatch, run, and attempt IDs | the closed Runtime event and state contracts                                   |
| log, trace, metric, and audit correlation                 | the versioned Execution Envelope                                               |
| maintenance command and result                            | the generated closed operational command union                                 |

The proof must reject an unknown event kind, link kind, Resource identity,
Context key, application Operation, maintenance command, and System Authority
construction. Public declarations cannot fall back to `Record<string, any>` or
a broad event discriminant merely to make Studio rendering convenient.

## Predict inspection failures

| Failure                                       | Required result                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Origin file moved                             | identity remains stable; explanation points to the new Origin                        |
| local artifact and Runtime build differ       | refuse to combine them as one explanation and name the digest mismatch               |
| migration receipt missing or checksum changed | show the accepted blocking history diagnostic, never infer success from schema shape |
| event exporter unavailable                    | durable facts remain inspectable; telemetry loss or lag is explicit                  |
| telemetry sampled or expired                  | show a gap and durability class; never synthesize a complete trace                   |
| Policy denies application data                | generated Operation returns its normal nondisclosing result; Studio has no bypass    |
| Policy evidence contains a sensitive row      | show only the compiled safe decision/reason and dependency metadata                  |
| redaction contract fails                      | block the Studio result and emit a sanitized correlated failure                      |
| operator lacks maintenance Authority          | reject before state transition without exposing protected target detail              |
| retry races another worker                    | one fenced transition wins; audit records the rejected stale command                 |
| external Action outcome is ambiguous          | preserve ambiguity; do not offer blind automatic replay                              |
| one Runtime instance is unavailable           | mark partial operational evidence; do not present a fleet-wide complete claim        |
| unknown or newer event version                | preserve stored bytes and report unsupported version; never decode as an older event |

## Know what Studio is not

Studio is an application and Runtime inspector plus a small audited maintenance
surface. It is not:

- a second QUESTPIE backend or hidden Admin API;
- a raw SQL console or generic PostgreSQL hosting dashboard;
- a way to edit migration history or internal Runtime tables;
- a CMS page builder or application-specific Operator App framework;
- an authorization bypass based on operator location;
- the sole durable store for jobs, workflows, migrations, or audit facts; or
- a separate log ontology that disagrees with CLI, tests, telemetry, or a
  future Cloud.

That boundary keeps the operational view powerful without asking application
developers to maintain another schema, Policy model, handler registry, or UI
extension system. The same compiled application meaning remains visible from
Definition and Origin through PostgreSQL commit, client delivery, realtime
reconciliation, and durable completion.
