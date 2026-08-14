---
title: Connect HTTP, external effects, Auth, Files, and Search
description: Keep protocol handling and external systems explicit without creating a second application model.
status: design-fiction
implementation-status: unimplemented
candidate-contracts:
  - raw Request-to-Response Route with mandatory admission and typed path parameters
  - explicit application Execution transition after third-party protocol verification
  - server-only Mutation called through the generated operation surface
  - Action with caller-owned stable effect key, cancellation, and no automatic retry
  - concrete Better Auth credential-to-Principal and native HTTP integration
  - accepted ordinary Policy-protected File metadata before byte access
  - accepted committed durable Search projection and authorized result universe
  - direct, Fetch, nested, generated-client, error, and Studio parity
proof-blocked-contracts:
  - exact Route, Action, nested Execution, credential, File, and Search syntax
  - Route path matching, raw body preservation, direct-call, and limit artifacts
  - Action output, declared-error, effect-key, cancellation, and no-retry fixtures
  - Better Auth schema, credential-failure, native-route, and Principal mapping fixtures
  - generated App Contract, hover, negative-member, declaration-size, and TypeScript budget checks
  - focused Action and Better Auth reference-integration acceptance reviews
---

# Connect HTTP, external effects, Auth, Files, and Search

Use a Route when the application must own raw HTTP. Use an Action when it must
perform an external or nondeterministic effect. Keep credential Auth native,
store File metadata as ordinary application data, and treat Search as a
durable projection of committed rows.

These boundaries do not create a second authorization model. A Route crosses
into application work through generated Operations. An Action cannot read or
write Collections directly. Auth produces Principal. File bytes are opened
only after metadata Policy passes. Search candidates become results only after
the source Collection's current Policy authorizes the complete result
universe.

This chapter shows one complete collaboration-application path:

- a delivery provider posts a signed raw webhook;
- the Route verifies the exact bytes and opens an explicit application
  Execution;
- a server-only Mutation records the provider event in PostgreSQL;
- a durable Reaction calls one delivery Action with a stable effect key;
- Better Auth resolves browser credentials into Principal without hiding its
  native API;
- a File download authorizes metadata before opening bytes; and
- Message Search follows committed changes and reauthorizes every result.

The example spellings remain design fiction until ticket #21 consolidates the
public surface. ADR-0015 accepts Service/Route/Auth ownership, and ADR-0018
accepts File/Search ownership plus compiler-owned contract projections. Action
and a concrete Better Auth reference Package remain focused later verticals.

## Accept a signed raw webhook

A third-party webhook is not a generated-client request. It has no QUESTPIE
Context envelope and must not invent the browser's selected `companyId`. Its
Route first verifies the provider protocol. Only verified application data may
select the explicit root Execution that calls the server-only Mutation.

The event Collection is ordinary application data:

```ts title="src/model/provider-events.ts"
import {
	constraint,
	defineCollection,
	definePolicy,
	field,
	policy,
} from "questpie";

export const providerEvents = defineCollection({
	name: "providerEvents",
	fields: {
		id: field.text({ nullable: false, maxLength: 512 }),
		companyId: field.uuid({ nullable: false }),
		provider: field.text({ nullable: false, maxLength: 64 }),
		eventId: field.text({ nullable: false, maxLength: 255 }),
		type: field.text({ nullable: false, maxLength: 255 }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		providerEvent: constraint.unique({ fields: ["provider", "eventId"] }),
	},
});

export const providerEventPolicy = definePolicy(providerEvents, {
	name: "providerEvents.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.companyId.equal(tenant.id),
	},
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate, tenant }) => candidate.companyId.equal(tenant.id),
	},
});
```

The raw Route and Mutation stay together because they implement one provider
integration. The provider SDK is ordinary TypeScript. QUESTPIE does not require
a provider registry or generic integration SPI.

```ts title="src/features/delivery-webhook.ts"
import { Webhook } from "standardwebhooks";
import { defineMutation, defineRoute } from "#questpie/app";
import { operation, policy, principal } from "questpie";

const webhook = new Webhook(Bun.env.DELIVERY_WEBHOOK_SECRET!);

export const deliveryWebhookPrincipal = principal.service({
	name: "delivery.webhook",
});

const deliveryEvent = operation.object({
	id: operation.text({ maximumLength: 255 }),
	type: operation.text({ maximumLength: 255 }),
	companyId: operation.uuid(),
});

function verifyDeliveryEvent(rawBody: string, headers: Headers) {
	try {
		return deliveryEvent.parse(webhook.verify(rawBody, headers));
	} catch {
		return null;
	}
}

export const recordDeliveryEvent = defineMutation({
	name: "delivery.recordEvent",
	input: deliveryEvent,
	policy: policy.authenticated(),
	network: false,
	handler: async ({ input, ctx }) => {
		const id = `delivery:${input.id}`;
		const existing = await ctx.data.providerEvents.get({
			key: { id },
			select: { id: true },
		});

		if (existing !== null) {
			return { accepted: true as const };
		}

		await ctx.data.providerEvents.create({
			input: {
				id,
				companyId: ctx.tenant.id,
				provider: "delivery",
				eventId: input.id,
				type: input.type,
				createdAt: ctx.operationTime,
			},
			select: { id: true },
		});

		return { accepted: true as const };
	},
});

export const deliveryWebhook = defineRoute({
	name: "delivery.webhook",
	method: "POST",
	path: "/webhooks/delivery",
	policy: policy.public(),
	limits: {
		bodyBytes: 256_000,
		durationMs: 10_000,
	},
	handler: async ({ request, ctx }) => {
		const rawBody = await request.text();
		const event = verifyDeliveryEvent(rawBody, request.headers);

		if (event === null) {
			return Response.json({ code: "INVALID_SIGNATURE" }, { status: 400 });
		}

		await ctx.execution(
			{
				principal: deliveryWebhookPrincipal,
				context: { companyId: event.companyId },
			},
			({ mutations }) =>
				mutations.delivery.recordEvent({
					id: event.id,
					type: event.type,
					companyId: event.companyId,
				}),
		);

		return new Response(null, { status: 204 });
	},
});
```

`policy.public()` admits delivery to signature-verification code. It does not
declare the event trusted. Before verification, the Route context exposes the
raw `Request`, cancellation, deadline, trace, and the explicit
`ctx.execution(...)` transition. It does not expose `ctx.data`, a transaction,
raw SQL, System Authority, or an application Tenant.

After verification, `ctx.execution(...)` creates a normal root Execution. Its
`context` argument has the exact generated `appContext.input` type. Context
Resolution validates the selected Company for the application-owned
`deliveryWebhookPrincipal`; Collection Policy then rechecks the write inside
the Mutation transaction. The callback receives the concrete generated server
operation map. There is no `authority` argument and no `asSystem` escape hatch.

The verified `companyId` still acts as Context input, not as an authorization
proof. The signature proves which integration produced the event. Context and
Policy prove what that integration may do in the selected Company.

`network: false` removes `delivery.recordEvent` from the browser client. It is
not authorization, so the Mutation still declares Policy. The named unique
constraint is the concurrency guard for repeated webhook delivery. The Route
returns the same `204` for the original event and a valid duplicate; the
focused proof must normalize the concurrent unique-conflict loser to that same
result.

### Call the same Route through Fetch or directly

The standalone Runtime matches the literal method and path and passes the
untouched Fetch `Request` to the handler:

```ts title="scripts/post-delivery-webhook.ts"
const response = await fetch("http://localhost:4000/webhooks/delivery", {
	method: "POST",
	headers: signedHeaders,
	body: exactSignedBody,
	signal,
});

if (response.status !== 204) {
	throw new Error(`Delivery webhook failed: ${response.status}`);
}
```

Tests use the generated direct Route member and must supply an explicit ingress
Execution. Omitting it never becomes System Authority:

```ts title="test/delivery-webhook.test.ts"
import { createApp } from "#questpie/app";
import { principal } from "questpie";

const app = await createApp({
	postgres: { url: Bun.env.DATABASE_URL! },
});

const response = await app.routes["delivery.webhook"].direct({
	request: signedRequest,
	execution: {
		principal: principal.anonymous(),
	},
});

expect(response.status).toBe(204);
await app.close();
```

The raw Route ingress has a Principal but no fabricated Tenant or application
Context. The verified handler makes that later trusted transition explicitly.
An invalid signature returns the Route-owned `400`, never constructs an
application Execution, and never invokes the Mutation.

## Put external delivery in an Action

An Action owns one external or nondeterministic effect. It receives exact
input, declared errors, immutable Execution facts, cancellation, and generated
Operation callers. It does not receive `ctx.data`, a transaction, dispatch, or
automatic retry.

The provider wrapper is an ordinary TypeScript module:

```ts title="src/integrations/delivery-provider.ts"
export const deliveryProvider = {
	async send(
		input: { to: string; subject: string; text: string },
		options: { effectKey: string; signal: AbortSignal },
	) {
		const response = await fetch("https://api.delivery.example/v1/messages", {
			method: "POST",
			headers: {
				authorization: `Bearer ${Bun.env.DELIVERY_API_KEY!}`,
				"content-type": "application/json",
				"idempotency-key": options.effectKey,
			},
			body: JSON.stringify(input),
			signal: options.signal,
		});

		if (response.status === 422) return { kind: "rejected" as const };
		if (!response.ok) return { kind: "unknown" as const };

		const value: unknown = await response.json();
		return { kind: "sent" as const, value };
	},
};
```

The Action turns provider behavior into one closed application contract:

```ts title="src/features/send-delivery.ts"
import { defineAction } from "#questpie/app";
import { operation, policy } from "questpie";
import { deliveryProvider } from "../integrations/delivery-provider";

const sentDelivery = operation.object({
	providerId: operation.text(),
});

export const sendDelivery = defineAction({
	name: "delivery.send",
	input: operation.object({
		to: operation.email(),
		subject: operation.text({ maximumLength: 255 }),
		text: operation.text({ maximumLength: 100_000 }),
		effectKey: operation.text({ maximumLength: 255 }),
	}),
	policy: policy.authenticated(),
	errors: {
		rejected: operation.error({
			code: "DELIVERY_REJECTED",
			status: 422,
		}),
		outcomeUnknown: operation.error({
			code: "DELIVERY_OUTCOME_UNKNOWN",
			status: 502,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		const result = await deliveryProvider.send(
			{
				to: input.to,
				subject: input.subject,
				text: input.text,
			},
			{
				effectKey: input.effectKey,
				signal: ctx.signal,
			},
		);

		if (result.kind === "rejected") throw errors.rejected();
		if (result.kind === "unknown") throw errors.outcomeUnknown();

		return sentDelivery.parse(result.value);
	},
	network: true,
});
```

`effectKey` is explicit application data. QUESTPIE carries it unchanged through
the generated caller and Execution Envelope. It does not claim that the
provider honors the key. If the provider may have accepted a request before a
timeout, the Action reports `DELIVERY_OUTCOME_UNKNOWN`; it does not retry
blindly.

A durable Reaction deliberately reuses one stable logical effect key:

```ts title="src/features/message-delivery.ts"
import { defineReaction } from "#questpie/app";
import { durable, operation } from "questpie";

export const messageDelivery = defineReaction({
	name: "messages.delivery",
	input: operation.object({
		messageId: operation.uuid(),
		companyId: operation.uuid(),
	}),
	runAs: durable.caller({ whenDenied: "fail" }),
	retry: durable.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, run }) => {
		const delivery = await ctx.queries.messages.deliveryView({
			messageId: input.messageId,
		});

		if (delivery === null) return { kind: "unavailable" as const };

		const result = await ctx.actions.delivery.send({
			to: delivery.to,
			subject: delivery.subject,
			text: delivery.text,
			effectKey: run.effect("send-message"),
		});

		return { kind: "sent" as const, providerId: result.providerId };
	},
});
```

The Reaction may retry according to its durable contract. Every attempt derives
the same `run.effect("send-message")` value. A direct browser call is exactly
one Action invocation:

```ts title="web/send-test-delivery.ts"
import { createClient, isOperationError } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({ companyId });

try {
	const result = await company.actions["delivery.send"]({
		to,
		subject: "Delivery test",
		text: "This is a test.",
		effectKey,
	});
	console.log(result.providerId);
} catch (error) {
	if (isOperationError(error, "DELIVERY_OUTCOME_UNKNOWN")) {
		// Ask the provider or an operator to reconcile this exact effect key.
	} else {
		throw error;
	}
}
```

Browser retry with a new key requests a new effect. Durable retry with the same
key requests convergence on the same effect. Cancellation reaches `fetch`
through `ctx.signal`, but cancellation after send cannot prove non-delivery.

## Turn Better Auth credentials into Principal

Auth answers “which Principal presented these credentials?” Policy answers
“what may that Principal do?” Context answers “which application scope is this
Execution using?” Keeping those jobs separate lets QUESTPIE preserve Better
Auth's native endpoints, plugins, session rules, client, and server API.

```ts title="src/auth.ts"
import { betterAuth } from "better-auth";
import {
	defineCredentialResolver,
	defineService,
	policy,
	principal,
} from "questpie";
import { defineRoute } from "#questpie/app";

export const auth = betterAuth({
	emailAndPassword: { enabled: true },
});

export const authService = defineService({
	name: "auth",
	lifetime: "application",
	effect: "external",
	create: () => auth,
});

export const credentials = defineCredentialResolver({
	name: "app.credentials",
	service: authService,
	async resolve({ headers, service }) {
		const session = await service.api.getSession({ headers });
		return session
			? { kind: "resolved", principal: principal.user({ id: session.user.id }) }
			: { kind: "anonymous" };
	},
});

export const authHttp = defineRoute({
	name: "auth.http",
	method: "POST",
	path: "/auth/*",
	policy: policy.public(),
	credentials: "none",
	limits: { bodyBytes: 256_000, durationMs: 10_000 },
	handler: ({ request, ctx }) => ctx.services.auth.handler(request),
});
```

The concrete integration uses `auth.api.getSession({ headers })` at Runtime
ingress and delegates `/auth/*` to `auth.handler(request)`. Application code
still imports and configures the native `auth` object. Better Auth plugins and
native clients remain Better Auth APIs; QUESTPIE does not mirror every endpoint
as a Mutation.

For example, server code can still use the native API directly:

```ts title="src/integrations/read-native-session.ts"
import { headers } from "next/headers";
import { auth } from "../auth";

export async function readNativeSession() {
	return auth.api.getSession({
		headers: await headers(),
	});
}
```

The integration maps only the bounded identity needed by the generated App
Contract. It does not place the entire mutable session, reusable bearer tokens,
provider client, or raw headers on `ctx.principal`. Missing or invalid
credentials may resolve to `principal.anonymous()` according to the concrete
integration contract. Provider failure is an ingress error, never a silent
downgrade to anonymous.

Better Auth tables remain application-owned Collections and participate in the
normal reviewed schema lifecycle. A later reference Package may export the
same ordinary Definitions, but this chapter publishes neither a privileged Auth
SPI nor mandatory schema or client authority.

## Authorize File metadata before opening bytes

A File row and its blob have different jobs. The row contains application
identity, ownership, metadata, and Policy facts. Object storage contains bytes.
Storage does not decide application authorization, and QUESTPIE never creates a
hidden File mini-Collection.

```ts title="src/model/files.ts"
import {
	constraint,
	defineCollection,
	definePolicy,
	field,
	policy,
} from "questpie";

export const files = defineCollection({
	name: "files",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		companyId: field.uuid({ nullable: false }),
		storageKey: field.text({ nullable: false, maxLength: 1_024 }),
		name: field.text({ nullable: false, maxLength: 255 }),
		mediaType: field.text({ nullable: false, maxLength: 255 }),
		size: field.integer({ nullable: false }),
		checksum: field.text({ nullable: false, maxLength: 255 }),
		createdBy: field.uuid({ nullable: false }),
		createdAt: field.timestamp({
			nullable: false,
			withTimezone: true,
			default: "now",
		}),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		storageObject: constraint.unique({ fields: ["storageKey"] }),
	},
});

export const filePolicy = definePolicy(files, {
	name: "files.default",
	read: {
		admit: policy.authenticated(),
		rows: ({ row, tenant }) => row.companyId.equal(tenant.id),
	},
	create: { admit: policy.authenticated() },
	delete: {
		admit: policy.authenticated(),
		rows: ({ current, tenant }) => current.companyId.equal(tenant.id),
	},
});
```

The private Query owns the exact metadata disclosure. The raw download Route
gets Company selection from its explicit path, then creates a normal
application Execution with the credential-resolved ingress Principal:

```ts title="src/features/file-download.ts"
import { defineQuery, defineRoute } from "#questpie/app";
import { operation, policy } from "questpie";

export const downloadFileMetadata = defineQuery({
	name: "files.downloadMetadata",
	input: operation.object({ id: operation.uuid() }),
	policy: policy.authenticated(),
	network: false,
	handler: ({ input, ctx }) =>
		ctx.data.files.get({
			key: { id: input.id },
			select: {
				storageKey: true,
				mediaType: true,
				size: true,
			},
		}),
});

export const downloadFile = defineRoute({
	name: "files.download",
	method: "GET",
	path: "/companies/:companyId/files/:id",
	params: operation.object({
		companyId: operation.uuid(),
		id: operation.uuid(),
	}),
	policy: policy.authenticated(),
	limits: {
		durationMs: 60_000,
		responseBytes: 50_000_000,
	},
	handler: ({ params, ctx }) =>
		ctx.execution(
			{
				principal: ctx.principal,
				context: { companyId: params.companyId },
			},
			async ({ queries, files, signal }) => {
				const file = await queries.files.downloadMetadata({
					id: params.id,
				});

				if (file === null) {
					return new Response("Not found", { status: 404 });
				}

				const object = await files.open(file.storageKey, { signal });
				if (object === null) {
					return new Response("Not found", { status: 404 });
				}

				return new Response(object.body, {
					headers: {
						"content-length": String(file.size),
						"content-type": file.mediaType,
					},
				});
			},
		),
});
```

Unlike the signed webhook, this path parameter is ordinary untrusted caller
input. Context Resolution validates the Company selection for the credential
Principal. The metadata Query then applies the File Collection's row and Field
Policy. Only a non-null authorized result reveals `storageKey` to server code;
only then does `files.open` touch object storage.

Missing metadata, unauthorized metadata, and missing bytes all produce the
same external `404`. A guessed storage key is not accepted by the Route.
Object existence without an authorized File row is never disclosed.

`files.open` illustrates the accepted narrow Runtime byte capability, not a
generic storage-provider API. It does not accept Principal, Tenant, Policy, or
an authorization override. Filesystem and S3-compatible adapters now prove the
bounded `put`/`open`/`head`/`delete` seam; provider configuration and optional
provider features remain outside it.

Upload is not hidden behind this download contract. PostgreSQL and object
storage cannot commit atomically. ADR-0018 therefore requires pending, ready,
aborted/failed, checksum, size, finalize, response-loss, and orphan-cleanup
states rather than pretending `upload(file)` is one transaction. Final syntax
remains with ticket #21 and the later File implementation slice.

## Search committed rows and reauthorize the result universe

Search is a derived projection, not an authority. Bind one deterministic
document projection and one query projection to the exact source Collection:

```ts title="src/features/message-search.ts"
import { defineSearch, search } from "questpie/search";
import { messages } from "../model/collaboration";

export const messageSearch = defineSearch(messages, {
	name: "messages.search",
	document: ({ fields }) => ({
		title: fields.title,
		text: fields.body,
		facets: {
			channelId: fields.channelId,
		},
	}),
	query: {
		input: search.input({
			text: search.text(),
			channelId: search.facet.uuid({ optional: true }),
			first: search.first({ maximum: 50 }),
			after: search.cursor({ nullable: true }),
		}),
		select: ({ fields }) => ({
			id: fields.id,
			channelId: fields.channelId,
			title: fields.title,
			body: fields.body,
		}),
	},
});
```

`messages` supplies the exact type for both `fields` callbacks. The document
callback is structural and context-free. It cannot read Principal, Tenant,
Services, the clock, or another Collection. The compiler emits deterministic
projection bytes and a generated search Query.

Every committed source Mutation records the Search projection identity and
changed Message key as Transactional Dispatch in the same PostgreSQL commit.
The durable worker rereads committed current state, idempotently updates or
removes the document, and advances a durable checkpoint. A lost wake or worker
crash delays indexing; it does not lose the committed change. Studio shows the
checkpoint, lag, failure, retry, and rebuild state.

The client uses one exact generated member:

```ts title="web/search-messages.ts"
import { createClient } from "#questpie/client";

const client = createClient({
	baseUrl: "http://localhost:4000",
	credentials: "include",
});

const company = client.withContext({ companyId });
const page = await company.search["messages.search"]({
	text: "incident review",
	channelId,
	first: 20,
	after: null,
});

for (const message of page.nodes) {
	console.log(message.title);
}
```

The index returns ranked candidate keys. It never returns trusted application
rows. Before pagination, totals, facets, cursor continuation, or statistics,
the Runtime intersects the complete candidate set with the source Collection's
current read Policy, Tenant scope, deletion rules, requested facets, and Field
output Policy.

```text
authorized search universe
  = ranked index candidates
  AND current Message row Policy
  AND current relational Policy evidence
  AND current Tenant scope
  AND requested facet predicates
  AND current disclosure projection
```

The returned `nodes`, `total`, facets, cursor, and statistics all describe this
same universe. QUESTPIE does not fetch twenty untrusted hits, filter them in
JavaScript, return an under-filled page, and leak the provider's original
count. A stale or forged index key cannot disclose a row. If the complete
authorization plan cannot lower, Search fails closed.

PostgreSQL is the accepted first Search engine seam so ranking candidates and
authorized source rows can form one bounded plan. The public Index contract
remains B-tree-only; a real full-text physical Index needs its own focused
decision. External engines add lag, refill, exact-total, facet, revocation, and
side-channel contracts. ADR-0018 publishes no generic Search provider SPI.

## Know where every type comes from

No callback depends on illustrative implicit `any` or an ambient registry:

| Code or callback                             | Exact contextual type source                                          |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Route `request`                              | the fixed Fetch `Request` contract                                    |
| Route `params.companyId` and `params.id`     | local `params` codec checked against literal path names               |
| ingress Route `ctx`                          | concrete generated App Contract narrowed to raw Route mode            |
| `ctx.execution` context and callback         | generated Context input plus generated server App Contract            |
| Mutation and Action `input`                  | local `operation.object(...)` codec                                   |
| Mutation `ctx.data.providerEvents`           | concrete generated Collection map in Mutation transaction mode        |
| Action `errors`                              | local literal declared-error map                                      |
| Action `ctx`                                 | generated Action mode with signal and Operation callers but no `data` |
| `ctx.actions.delivery.send`                  | nested generated Action input, output, errors, and exposure contract  |
| credential resolver `service`                | explicit application/external Auth Service reference                  |
| File Policy row and Field keys               | exact `files` Collection passed to `definePolicy`                     |
| nested `queries`, `files`, and `signal`      | generated App Contract for the explicit application Execution         |
| Search `document` and `select` fields        | exact `messages` Collection passed to `defineSearch`                  |
| generated client Route/Action/Search members | one concrete generated App Contract and exposure projection           |

An unknown Route parameter, Action error, Action data member, nested Operation,
Better Auth user Field, File Field, Search facet, or client member fails in the
editor and compiler. The focused proof must preserve those negative cases and
measure the generated declaration and TypeScript instantiation budgets.

## Predict execution, Fetch, errors, and cancellation

The four Operation kinds remain separate because each factory communicates a
different runtime guarantee:

| Operation | Owns                                                                             | Does not own                                          |
| --------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Query     | one read snapshot and an optional Live Query                                     | writes or external effects                            |
| Mutation  | one PostgreSQL transaction and atomic durable dispatch                           | provider I/O inside automatic transaction retry       |
| Action    | one external or nondeterministic effect invocation                               | `ctx.data`, transaction atomicity, or automatic retry |
| Route     | raw Fetch `Request` and `Response`, protocol verification, streaming, and limits | implicit client Context or application data bypass    |

The same compiled Resource supplies every applicable entry:

| Surface           | Behavior                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| generated client  | exposes only `network: true` Query, Mutation, Action, and Search members; raw Routes remain URLs                |
| Runtime Fetch     | resolves credentials and generated Context for normal Operations; passes exact raw bytes to Routes              |
| direct Route test | requires `Request` plus explicit ingress Execution; omission is never System                                    |
| nested Operation  | inherits one resolved Execution unless a raw Route makes the explicit root transition shown above               |
| durable attempt   | creates a fresh run-as Execution and deliberately reuses stable effect identity on retry                        |
| File stream       | closes on request cancellation; metadata authorization always precedes byte access                              |
| Search            | obeys Query duration, candidate, row, byte, and refill budgets and fails closed when authorization cannot lower |

Raw Route errors are its chosen `Response`. Action errors are declared and
generated for typed callers. Auth provider failure is an ingress error.
Missing or forbidden File rows are the same `404`. Search index or Policy-plan
failure never falls back to unfiltered results.

`ctx.signal` and `ctx.deadline` exist in every handler mode. Route cancellation
combines the incoming Request signal with Runtime shutdown. Action passes the
signal to the provider, but cannot undo an accepted effect. Mutation
cancellation before commit rolls back; cancellation after commit cannot erase
the row or durable dispatch. Durable attempts persist whether cancellation was
requested, observed, or too late.

## Inspect one causal path in Studio

Studio uses the common Execution Envelope. It does not infer integration state
from unrelated logs or expose hidden Admin bypasses. Starting from the delivery
webhook, a developer can follow:

1. Route Resource, Origin, method/path match, body and duration limits,
   credential class, signature outcome, and raw response status;
2. explicit application Execution transition, selected Context input,
   resolved Principal/Tenant/Authority class, and Context failure without
   exposing credentials;
3. nested `delivery.recordEvent` Mutation, Policy decision, transaction,
   duplicate identity, committed row, Change Ledger facts, and dispatch;
4. durable run, attempts, cancellation, stable redacted effect-key digest,
   `delivery.send` Action, provider receipt or ambiguous outcome;
5. File metadata Policy before storage open, stream bytes and cancellation;
   and
6. Search source transaction, projection checkpoint, lag, retry, rebuild,
   candidate authorization, result count, and query limits.

Studio calls ordinary authorized application surfaces or explicit trusted
maintenance surfaces. It does not list Auth sessions with reusable credentials,
open object storage by guessed key, read unfiltered Search documents, rerun an
ambiguous Action blindly, or turn operator location into System Authority.

## Keep the first integration layer small

The first useful v4 layer needs only these owned seams:

1. raw `defineRoute` with mandatory Policy, literal method/path, typed params,
   limits, direct call, Fetch match, cancellation, and exact `Response`;
2. `defineAction` with exact input/output/errors, stable caller-supplied effect
   key, generated callers, cancellation, and no automatic retry;
3. one explicit post-verification application Execution transition for a
   non-client Route;
4. one concrete Better Auth credential and HTTP integration that keeps the
   native API;
5. ordinary File metadata Policy plus one bounded Runtime-proxied download;
   and
6. committed PostgreSQL Search projection plus one authorized result universe.

Do not add a generic provider framework to make this list look uniform.
Multipart helpers, delegated service Authority, upload finalization, provider
idempotency receipts, multiple Auth providers, storage backends, external
Search engines, vector ranking, WebSocket upgrades, OpenAPI, MCP, compensation,
and Workflow integration require their own later proofs. The seams above keep
those verticals possible without claiming their details already work.

## Know the guarantee

For the candidate contract shown here, QUESTPIE intends to guarantee:

1. a raw Route receives the exact Fetch body and must declare admission;
2. a third-party Route receives no fabricated client Context or implicit
   System Authority;
3. verified protocol data crosses into application work through an explicit
   typed Execution and generated server Operation;
4. a Mutation owns all database writes and commits before external work;
5. an Action has no Collection data surface or automatic retry, and propagates
   cancellation without claiming rollback of an accepted effect;
6. credential Auth produces bounded Principal while preserving Better Auth's
   native API;
7. File metadata Policy succeeds before storage bytes can be opened;
8. committed source changes drive a durable idempotent Search projection;
9. Search results, totals, facets, cursors, and statistics use the same current
   authorized universe; and
10. direct, Fetch, nested, durable, generated-client, and Studio surfaces keep
    the same Resource, Context, Policy, error, cancellation, and identity
    meanings.

Route/Auth composition and File/Search ownership have passed their focused
proofs and reviews and are projected separately into public guides. This
combined design-fiction page remains non-authoritative because its Action,
Better Auth reference integration, and final #21 spellings have not passed.
