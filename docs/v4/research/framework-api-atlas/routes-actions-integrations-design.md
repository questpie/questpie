# Route, Action, Auth, File, and Search ownership

- Status: design evidence; no v4 acceptance authority
- Atlas tickets: #5 and #10
- Scope: the smallest coherent developer interface for raw HTTP, external
  effects, credential Auth, file bytes, and Search without creating another
  authorization or runtime system
- Fixed authority: `SPEC.md`, `CONTEXT.md`, and the accepted foundational data
  contract

## Recommendation in one sentence

Keep four semantic Operations with separate Definitions: Query reads, Mutation
owns one transaction, Action owns an external effect with no automatic retry,
and Route owns raw HTTP; let concrete Auth integration resolve credentials to
the core Principal, keep File metadata in ordinary Policy-protected
Collections while blob storage owns bytes, and make Search a committed derived
projection whose results, counts, facets, and source rows are authorized by the
same Collection Policy.

This is a candidate design, not accepted syntax. Every inferred callback and
generated member below needs an executable TypeScript proof before it may move
to the design-fiction guide.

## Product invariants this design must preserve

1. A developer writes one cohesive Definition with one inline handler. There
   is no mandatory handler file, binding registry, or repeated Resource name.
2. Query, Mutation, Action, and Route are not four spellings for the same
   function. Each name communicates a runtime guarantee.
3. Normal JSON application calls use generated Queries, Mutations, and Actions.
   Route is the Fetch `Request`/`Response` escape hatch, not a second RPC layer.
4. Every entry point has an explicit Policy admission. Omitting it is a compile
   error; a public webhook says `policy.public()` visibly.
5. An Action is never automatically retried as part of a database transaction.
   A durable caller may retry it deliberately with one stable effect key.
6. A Route or Action receives no raw database, SQL, transaction handle,
   `asSystem`, Policy override, or ambient System Authority.
7. Credential Auth produces Principal. It does not replace Policy, Tenant, or
   Context Resolution.
8. A File row is ordinary application data. Reading bytes must first authorize
   the corresponding row; storage visibility is not a second access model.
9. Search is derived data. A stale or forged index entry cannot make a source
   row readable, inflate an authorized total, or reveal a forbidden facet.
10. Direct, Fetch, generated-client, nested, worker, and Studio execution use
    the same compiled Operation and Policy paths.

## Evidence from v3: preserve the jobs, not the architecture

V3's Route work proves demand for raw HTTP, parsed JSON, exact client inference,
direct execution, path parameters, streaming, and one generated client. It also
shows three failures v4 must not copy: an omitted Route rule was public, direct
execution without context silently became system, and dynamic path parameters
were not usable in the generated client
(`11617485:apps/docs/content/docs/code/routes.mdx:9-102,104-154` and
`11617485:apps/docs/content/docs/code/routes/typescript.mdx:50-105`).

V3's runtime did run Route access and handlers inside the same resolved app
context, but handed both a very broad service bag and defaulted a missing direct
context to `accessMode: "system"`
(`11617485:packages/questpie/src/server/routes/execute.ts:155-218,245-294`).
The parity job is valuable. The authority default is not.

V3 Search explicitly opted Collections into indexing, projected records in a
background Job, and joined search candidates back to source tables before
computing results. Its tests require denied candidates to disappear from both
hits and `total`, and require unsupported semantic modes to fail instead of
degrading silently
(`11617485:packages/questpie/test/search/search-index-opt-in.test.ts:11-99`,
`11617485:packages/questpie/src/server/modules/core/jobs/index-records.ts:65-155`,
and `11617485:packages/questpie/test/search/search-access.test.ts:99-227`).
The durable projection and authorized-candidate jobs should survive. The
untyped adapter/service plumbing should not.

V3 upload Collections kept metadata in PostgreSQL and bytes in storage. The
serve path used the row as an object-existence anchor, but then switched to a
separate `serve` access fallback and read the row in system mode
(`11617485:packages/questpie/src/server/adapters/routes/storage.ts:370-470`).
V4 keeps the row anchor and removes the second access chain: the normal File
Collection read Policy decides whether bytes can be disclosed.

V3 Better Auth integration retained the provider's native handler and session
semantics. Its facade tests also caught a real disclosure risk: session lists
must not return reusable bearer tokens
(`11617485:packages/questpie/test/integration/auth-session-facade.test.ts:62-113`).
This supports a thin credential-to-Principal seam, not a framework-owned Auth
plugin ABI.

External primary sources reinforce the runtime boundaries:

- Stripe requires the raw, unmodified request body for webhook signature
  verification, so a webhook cannot be forced through a JSON Operation codec:
  [Stripe webhook documentation](https://docs.stripe.com/webhooks?lang=node).
- Stripe's idempotency key makes deliberate retries converge on the first
  provider result, but the provider owns that guarantee:
  [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests?lang=curl).
- `Request` bodies are one-shot and `Request.signal` carries cancellation, so
  Route must receive the actual Fetch object:
  [MDN Request](https://developer.mozilla.org/en-US/docs/Web/API/Request) and
  [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).
- Better Auth's server `getSession` consumes request headers and returns its
  native session/user result; QUESTPIE can map that result without redefining
  the provider:
  [Better Auth server API](https://better-auth.com/docs/concepts/api).
- An S3 presigned URL grants time-bounded access under the signing identity and
  may be reused until expiry. It is a storage capability, not application
  Policy:
  [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

## Design it three ways

All three variants implement the same two jobs: accept a signed Stripe webhook
and send one provider request with a stable effect key. The comparison is about
the authored interface, not internal lowering.

### Variant A: one generic Operation Definition

```ts
export const stripeWebhook = defineOperation({
	name: "payments.stripeWebhook",
	kind: "route",
	http: { method: "POST", path: "/webhooks/stripe" },
	policy: policy.public(),
	handler: async ({ request, ctx }) => {
		const event = verifyStripe(await request.text(), request.headers);
		await ctx.mutations["payments.recordStripeEvent"]({
			eventId: event.id,
			type: event.type,
		});
		return new Response(null, { status: 204 });
	},
});

export const sendReceipt = defineOperation({
	name: "payments.sendReceipt",
	kind: "action",
	input: sendReceiptInput,
	policy: policy.authenticated(),
	handler: ({ input, ctx }) =>
		stripe.receipts.send(input.receipt, {
			idempotencyKey: input.effectKey,
			signal: ctx.signal,
		}),
});
```

This has one factory to remember, but it is a shallow interface. `kind`
conditionally changes legal properties, handler arguments, direct calls,
runtime guarantees, and generated client members. Documentation and compiler
diagnostics must repeatedly explain which branches do not apply. It optimizes
factory count rather than developer understanding.

### Variant B: four explicit semantic Definitions

```ts
export const stripeWebhook = defineRoute({
	name: "payments.stripeWebhook",
	method: "POST",
	path: "/webhooks/stripe",
	policy: policy.public(),
	handler: async ({ request, ctx }) => {
		const event = verifyStripe(await request.text(), request.headers);
		await ctx.mutations["payments.recordStripeEvent"]({
			eventId: event.id,
			type: event.type,
		});
		return new Response(null, { status: 204 });
	},
});

export const sendReceipt = defineAction({
	name: "payments.sendReceipt",
	input: sendReceiptInput,
	policy: policy.authenticated(),
	handler: ({ input, ctx }) =>
		stripe.receipts.send(input.receipt, {
			idempotencyKey: input.effectKey,
			signal: ctx.signal,
		}),
});
```

This is the recommendation. Four factory names buy four small, honest
interfaces. Removing them would force their transaction, retry, HTTP, and
observation rules back into every handler and review. They are deep modules,
not cosmetic aliases.

### Variant C: v3-style convention file and fluent builder

```ts
// src/routes/webhooks/stripe.post.ts
export default route()
	.post()
	.public()
	.raw()
	.handler(async ({ request, mutations }) => {
		const event = verifyStripe(await request.text(), request.headers);
		await mutations.payments.recordStripeEvent({
			eventId: event.id,
			type: event.type,
		});
		return new Response(null, { status: 204 });
	});

export const sendReceipt = action()
	.input(sendReceiptInput)
	.access(({ principal }) => principal.kind !== "anonymous")
	.handler(({ input, signal }) =>
		stripe.receipts.send(input.receipt, {
			idempotencyKey: input.effectKey,
			signal,
		}),
	);
```

This feels familiar and reads fluently. It loses the v4 identity rule when the
path/file supplies meaning, introduces a second `.access()` vocabulary beside
Policy, and makes the final type depend on builder history. A compiler can
discover a normal exported Definition without making source layout semantic.
The useful familiarity is the compact inline handler, which Variant B keeps.

## Recommended complete Route API

The normal webhook is one Definition and one private Mutation. The Route owns
HTTP verification and response. The Mutation owns the database transaction.

```ts title="src/features/payments.ts"
import Stripe from "stripe";
import { defineMutation, defineRoute, operation, policy } from "questpie";
import { providerEvents } from "../model/billing";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export const recordStripeEvent = defineMutation({
	name: "payments.recordStripeEvent",
	input: operation.object({
		eventId: operation.text({ maximumLength: 255 }),
		type: operation.text({ maximumLength: 255 }),
	}),
	policy: policy.public(),
	network: false,
	handler: async ({ input, ctx }) => {
		const recordId = `stripe:${input.eventId}`;
		const existing = await ctx.data.providerEvents.get({
			key: { id: recordId },
			select: { id: true },
		});

		if (existing !== null) return { accepted: true as const };

		await ctx.data.providerEvents.create({
			input: {
				id: recordId,
				provider: "stripe",
				eventId: input.eventId,
				type: input.type,
				createdAt: ctx.operationTime,
			},
			select: { id: true },
		});

		return { accepted: true as const };
	},
});

export const stripeWebhook = defineRoute({
	name: "payments.stripeWebhook",
	method: "POST",
	path: "/webhooks/stripe",
	policy: policy.public(),
	limits: {
		bodyBytes: 256_000,
		durationMs: 10_000,
	},
	handler: async ({ request, ctx }) => {
		const signature = request.headers.get("stripe-signature");
		if (signature === null) {
			return Response.json({ code: "INVALID_SIGNATURE" }, { status: 400 });
		}

		let event: Stripe.Event;
		try {
			event = stripe.webhooks.constructEvent(
				await request.text(),
				signature,
				process.env.STRIPE_WEBHOOK_SECRET!,
			);
		} catch {
			return Response.json({ code: "INVALID_SIGNATURE" }, { status: 400 });
		}

		await ctx.mutations["payments.recordStripeEvent"]({
			eventId: event.id,
			type: event.type,
		});

		return new Response(null, { status: 204 });
	},
});
```

`policy.public()` is explicit, mandatory Route admission. It admits delivery
to the signature-verification code; it does not assert that the Stripe event is
valid. Signature verification remains ordinary trusted application code over
the raw bytes.

`recordStripeEvent` is not in the generated network client. `network: false`
is exposure, not authorization, so its own Operation Policy remains explicit.
This example intentionally admits its narrow deduplicating insert because any
direct server caller is application code and the Collection has no generated
write surface. Applications with untrusted Package handlers need a later
narrow delegated-Authority proof; they must not simulate it with
`ctx.asSystem()`.

The provider event Collection still has an ordinary Collection Policy. Nothing
about Route bypasses Field, row, or candidate checks. Its ordinary `id` Field
is the named primary key and receives the deterministic provider event
identity. A second named unique constraint on `provider` plus `eventId` is the
final concurrency guard; the pre-read alone is not deduplication. The focused
Mutation proof must map a concurrent duplicate-key loser to the same accepted
result rather than leaking a storage error.

### Route generated surface

The compiler emits an exact server member and Fetch matcher:

```ts
type AppRoutes = {
	"payments.stripeWebhook": {
		method: "POST";
		path: "/webhooks/stripe";
		direct(args: {
			request: Request;
			execution: AppExecutionInput;
		}): Promise<Response>;
	};
};
```

Raw Routes do not become a JSON client method. A normal browser calls Queries,
Mutations, and Actions. Tests call the same Route directly with an explicit
Execution:

```ts
const response = await app.routes["payments.stripeWebhook"].direct({
	request: signedStripeRequest,
	execution: {
		principal: principal.anonymous(),
		context: {},
	},
});
```

There is no missing-context ⇒ System fallback. `context` is the same compiled,
transport-neutral Context input used by `client.withContext(...)`. A third-party
webhook does not use the generated client and therefore supplies no generated
context wire value. Its Route must be valid with `{}` or must derive a trusted
application scope after credential verification through a future explicit
Context/Authority contract. A Route must never spell a custom header binding
inside `defineContext`.

For generated-client Fetch, QUESTPIE carries Context input using its compiled
protocol. For a raw third-party Request, only the Request's actual credentials
and protocol fields exist. That distinction prevents the framework from
pretending every non-client caller knows a browser-selected `companyId`.

## Recommended complete Action API

An Action receives exact input/output/errors, immutable Execution facts,
cancellation, external Services, and generated Operation callers. It receives
no transaction-owned `ctx.data` surface.

```ts title="src/features/receipts.ts"
import { defineAction, operation, policy } from "questpie";

export const sendReceipt = defineAction({
	name: "payments.sendReceipt",
	input: operation.object({
		receiptId: operation.uuid(),
		to: operation.email(),
		effectKey: operation.text({ maximumLength: 255 }),
	}),
	policy: policy.authenticated(),
	errors: {
		rejected: operation.error({
			code: "RECEIPT_REJECTED",
			status: 422,
		}),
		outcomeUnknown: operation.error({
			code: "RECEIPT_OUTCOME_UNKNOWN",
			status: 502,
		}),
	},
	handler: async ({ input, ctx, errors }) => {
		try {
			const delivery = await ctx.services.receipts.send(
				{
					receiptId: input.receiptId,
					to: input.to,
				},
				{
					idempotencyKey: input.effectKey,
					signal: ctx.signal,
				},
			);

			return { providerId: delivery.id };
		} catch (error) {
			if (ctx.services.receipts.isRejected(error)) {
				throw errors.rejected();
			}
			throw errors.outcomeUnknown();
		}
	},
	network: true,
});
```

```ts title="src/features/message-created.ts"
import { defineReaction, operation, reaction } from "questpie";

export const messageCreated = defineReaction({
	name: "messages.created",
	input: operation.object({
		messageId: operation.uuid(),
	}),
	retry: reaction.retry({ maximumAttempts: 8 }),
	handler: async ({ input, ctx, attempt }) => {
		const receipt = await ctx.queries["messages.receipt"]({
			messageId: input.messageId,
		});
		if (receipt === null) return;

		await ctx.actions["payments.sendReceipt"]({
			receiptId: receipt.id,
			to: receipt.email,
			effectKey: attempt.effect("send-receipt"),
		});
	},
});
```

The stable effect key is explicit application data. The durable attempt derives
it from stable dispatch/attempt identity and reuses it on retry. QUESTPIE does
not claim the provider honored it; the Action maps an ambiguous network outcome
to a declared error and Studio records the attempt.

An ordinary client call is exact:

```ts
await company.actions["payments.sendReceipt"]({
	receiptId,
	to,
	effectKey,
});
```

It is one Action invocation, not an automatic retry contract. A browser retry
with a new key requests a new effect. A durable Reaction retry with the same key
requests convergence on the same effect.

### Generated Action context

```ts
type SendReceiptContext = {
	readonly principal: AppPrincipal;
	readonly tenant: AppTenant | null;
	readonly values: AppContextValues;
	readonly authority: OrdinaryAuthority;
	readonly signal: AbortSignal;
	readonly deadline: Date;
	readonly trace: AppTraceContext;
	readonly services: AppActionServices;
	readonly queries: AppQueryCallers;
	readonly mutations: AppMutationCallers;
};
```

Each nested Query or Mutation starts its own semantic scope; Action does not
smear several Mutation calls into one transaction. Cancellation reaches
provider SDKs through `ctx.signal`. Once an external server may have accepted a
request, cancellation cannot prove the effect did not happen.

## Credential Auth becomes Principal

Core owns the Principal union and its propagation. ADR-0015 accepts an
application-owned Better Auth composition that preserves the native `auth`
object, endpoints, plugins, client, and tables, then normalizes only ordinary
Service, credential-resolver, and raw Route Definitions.

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

The credential resolver receives request headers at Runtime ingress, calls the
native server session function through its explicit application Service, and
returns either the mapped Principal or anonymous. Provider failure is not
silently anonymous; it becomes a credential-resolution ingress error.

The Route delegates raw Auth endpoints to `auth.handler(request)`. It does not
translate every plugin endpoint into a QUESTPIE Mutation, nor make Better
Auth's schema/plugin order part of the compiler ABI. A later reference Package
may reduce repetition only by emitting the same ordinary core artifacts.

The generated `ctx.principal` type comes from the application's closed
Principal mapping, not from an ambient Better Auth session type. Context
Resolution runs after Principal resolution and can use the Principal plus
transport-neutral Context input to select a Tenant. Policy then rechecks
mutable membership in the Query snapshot or Mutation transaction.

This is intentionally one concrete integration, not a public generic Auth
provider SPI. The minimum core seam is credential bytes/request metadata in and
`Principal | credential error` out. A second genuinely required Auth adapter is
needed before publishing a generic adapter interface.

## File metadata owns Policy; blob storage owns bytes

There is no hidden File mini-Collection. The developer declares an ordinary
Collection with explicit Fields, key, constraints, and Policy:

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
		id: field.uuid(),
		companyId: field.uuid(),
		storageKey: field.text({ maximumLength: 1_024 }),
		name: field.text({ maximumLength: 255 }),
		mediaType: field.text({ maximumLength: 255 }),
		size: field.integer(),
		checksum: field.text({ maximumLength: 255 }),
		createdBy: field.uuid(),
		createdAt: field.timestamp({ withTimezone: true, default: "now" }),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: ["id"] }),
		storageObject: constraint.unique({ fields: ["storageKey"] }),
	},
});

export const filePolicy = definePolicy(files, {
	read: {
		admit: policy.authenticated(),
		rows: ({ fields, tenant }) => fields.companyId.equal(tenant.id),
	},
	create: { admit: policy.authenticated() },
	delete: {
		admit: policy.authenticated(),
		rows: ({ fields, tenant }) => fields.companyId.equal(tenant.id),
	},
});
```

A private Query owns the exact Policy-aware metadata read. The download Route
calls that Query and then streams the corresponding object:

```ts title="src/features/file-download.ts"
import { defineQuery, defineRoute, operation, policy } from "questpie";

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
	path: "/files/:id",
	params: operation.object({ id: operation.uuid() }),
	policy: policy.authenticated(),
	handler: async ({ params, ctx }) => {
		const file = await ctx.queries["files.downloadMetadata"]({ id: params.id });
		if (file === null) return new Response("Not found", { status: 404 });

		const object = await ctx.files.open(file.storageKey, {
			signal: ctx.signal,
		});
		if (object === null) return new Response("Not found", { status: 404 });

		return new Response(object.body, {
			headers: {
				"content-type": file.mediaType,
				"content-length": String(file.size),
			},
		});
	},
});
```

The metadata Query is not exposed to the network, so `storageKey` remains a
server value. Missing and unauthorized metadata return the same `null`, and
missing bytes return the same external `404`. `ctx.files.open` never accepts a
Principal and never decides Policy. It is a byte capability available only in
Route/Action/durable modes after application code has crossed the metadata
Policy seam.

Upload is not transactionally atomic across PostgreSQL and object storage. A
complete API therefore needs an explicit state machine (`pending`, `ready`,
`failed`), checksum/size validation, commit/finalize Mutation, durable orphan
cleanup, and recovery from response loss. A presigned URL also needs a narrow
object key, size/type/checksum conditions, expiry, and a later Policy-protected
finalize call. Hiding those states behind `collection.upload(file)` would make
the guarantee false. The beta seam may support Runtime-proxied upload with
strict limits, but direct-to-storage and provider matrices belong to the later
File vertical.

`ctx.files` is the first concrete Runtime byte module. Do not publish a generic
storage adapter/compiler SPI until a second required backend proves the seam.
Local development and one production object store can use internal adapters
behind the same tested interface.

## Search indexes committed state and reauthorizes the candidate universe

The recommended authoring shape is one Search Resource bound to an exact
Collection. Its projection is structural and context-free:

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

```ts title="web/search.ts"
const page = await company.search["messages.search"]({
	text: "incident review",
	channelId,
	first: 20,
	after: null,
});
```

The compiler emits a projection artifact and a normal generated Query. A
successful source Mutation records the Search projection identity plus changed
source key in Transactional Dispatch inside the same commit. The worker rereads
the committed current row, updates or removes the index idempotently, advances
a durable checkpoint, and exposes lag/rebuild state in Studio. No in-memory
debounce is part of correctness.

At read time the index returns ranked candidate keys, not trusted application
rows. The Runtime intersects those candidates with the source Collection's
current read Policy, Tenant predicate, soft-delete rule, requested facet rules,
and Field output Policy before calculating the returned page. `total`, facets,
cursor continuation, and statistics are computed from the same authorized
candidate universe. Post-filtering twenty provider hits and returning an
under-filled page with an unfiltered total is not conforming.

The first useful implementation should target PostgreSQL search so the
authorized candidate universe can be expressed as one bounded SQL plan, as v3
already demonstrated. External engines introduce lag, bounded refill, exact
count, facet, revocation, and side-channel questions. They are a later proven
adapter seam, not a beta generic provider interface.

Search projection code cannot call Services, inspect Principal, or branch on
Context. It maps committed row values to deterministic index material. Query
Policy owns per-Execution disclosure. Reindex uses the same projection bytes
and durable checkpoint rules as incremental indexing.

## Where every type comes from

| Callback or member                            | Exact contextual type source                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Route `request`                               | fixed Fetch `Request` contract                                                 |
| Route `params`                                | local `params` codec checked against literal `path` names                      |
| Route `ctx`                                   | concrete generated App Contract narrowed to Route mode                         |
| Action `input`                                | local closed `operation.object(...)`                                           |
| Action `errors`                               | local literal declared-error map                                               |
| Action `ctx.services`                         | concrete generated external-effect Services                                    |
| `ctx.queries`, `ctx.mutations`, `ctx.actions` | generated exact Operation maps and their compiled input/output/error contracts |
| Auth `map({ user })`                          | concrete Better Auth instance passed to the integration                        |
| File Policy `fields`                          | exact `files` Collection first argument                                        |
| Search `document({ fields })`                 | exact `messages` Collection first argument                                     |
| Search query `select({ fields })`             | same exact source Collection plus local projection                             |
| client members                                | one concrete generated App Contract; no ambient registry                       |

The proof must include hover fixtures and negative cases for an unknown Route
parameter, Action Service, nested Operation, Auth user Field, File Field,
Search facet, and generated client member. Illustrative implicit `any` is a
failed design, not unfinished documentation.

## Error, cancellation, and execution semantics

### Errors

- Operation admission failures are framework Policy results. Handlers do not
  redeclare `UNAUTHENTICATED` or `FORBIDDEN` for the normal case.
- Raw Route owns its full `Response`, including webhook-specific `400` and
  provider acknowledgement status.
- Action declares application/provider errors that a generated caller can
  discriminate. Network outcome ambiguity is different from a known provider
  rejection.
- Nested Query/Mutation/Action declared errors preserve their Resource identity
  and causation in the Execution Envelope.
- File missing and File unauthorized are nondisclosing equivalents.
- Search Policy compilation or authorized-universe construction fails closed;
  it never falls back to unfiltered candidates.

### Cancellation and deadlines

- `ctx.signal` and `ctx.deadline` exist in every handler mode.
- Route's signal is connected to the incoming Request and Runtime shutdown.
- Action passes the signal to external SDKs where supported, but cancellation
  after send does not imply rollback or non-delivery.
- Mutation cancellation before commit rolls back. Cancellation after commit
  cannot uncommit data or dispatch intent.
- Durable attempts persist whether cancellation was requested, observed, or
  too late; retry policy decides the next attempt.
- File streams close on Request cancellation. Search work obeys query duration,
  candidate, row, byte, and refill budgets.

### Direct and Fetch parity

| Surface                                | Execution input                                                                              | Same semantic path |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------ |
| generated client Query/Mutation/Action | credential plus compiled Context wire value                                                  | yes                |
| low-level Runtime Fetch                | raw Request; Runtime resolves credential and compiled protocol Context                       | yes                |
| third-party raw Route                  | raw Request; no invented client Context                                                      | yes                |
| direct Operation call                  | explicit Principal, Context input, cancellation/deadline                                     | yes                |
| nested handler call                    | inherited immutable Execution; nested Operation opens only its declared snapshot/transaction | yes                |
| durable attempt                        | persisted run-as/Context strategy resolved into a fresh Execution                            | yes                |
| Studio                                 | explicit operator Principal and ordinary Policy path                                         | yes                |

No row, Field, File, or Search access rule is reimplemented in Fetch, the
generated client, Studio, or a provider adapter.

## Beta seam versus later detailed APIs

### Small first usable v4 layer

The first layer should close and prove:

1. `defineRoute` with explicit Resource name, literal method/path, typed path
   parameters, mandatory Policy admission, one raw `Request`→`Response`
   handler, limits, generated direct call, and Runtime Fetch matching;
2. `defineAction` with exact input/inferred-or-pinned output/declared errors,
   mandatory Policy admission, generated client/direct/nested callers,
   external Services, cancellation, and an explicit no-automatic-retry rule;
3. one stable caller-supplied effect key carried unchanged through generated
   types, Runtime events, and a durable Reaction retry;
4. one concrete Better Auth integration that maps native session identity to
   Principal and delegates native Auth HTTP without defining a generic Auth
   plugin ABI;
5. the File ownership rule and one authorized Runtime-proxied download proof;
6. the Search ownership rule, canonical projection artifact, committed durable
   indexing seam, and result-reauthorize invariant—even if the complete Search
   product ships after beta; and
7. direct/Fetch/nested parity with no implicit System Authority.

This is enough to keep implementation seams honest while the first executable
tracer concentrates on compiler, Collections, typed Query/Mutation, Policy,
generated server/client, realtime, and durable dispatch.

### Later focused verticals

Do not freeze these details merely to claim breadth in beta:

- JSON Route codecs, multipart helpers, streaming transforms, CORS, OpenAPI,
  MCP, WebSocket upgrades, and custom protocol negotiation;
- delegated service Principal/Authority after webhook verification;
- provider-aware Action idempotency receipts, rate limits, circuit breaking,
  compensation, and ambiguous-result reconciliation;
- a generic credential Auth adapter interface, multiple Auth providers, account
  linking, impersonation, and Auth schema ownership beyond the concrete package;
- upload reservation/finalization, presigned grants, multipart upload, byte
  scanning, transforms, retention, orphan cleanup, CDN, range requests, and
  multiple storage backends;
- stemming/language analyzers, vectors, hybrid ranking, highlighting, external
  engines, exact-count semantics under lag, and rebuild/version cutover; and
- generic provider/compiler SPIs for Auth, storage, or Search.

The later list is not permission to leave ownership ambiguous. It records the
seams the first layer must preserve without pretending their detailed interface
has passed.

## Hostile acceptance matrix

| Case                                         | Required result                                                        |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Route omits `policy`                         | compile error                                                          |
| webhook body was parsed before handler       | impossible on raw Route; fixture proves exact bytes reach verification |
| invalid signature                            | Mutation is not invoked; explicit `400`                                |
| repeated provider event                      | named unique constraint plus Mutation produces one stored event        |
| direct Route omits Execution                 | type/runtime error; never System Authority                             |
| Action called inside retryable Mutation body | compile error: Mutation `ctx` has no Actions/external Services         |
| durable Action retry                         | same stable effect key and distinct attempt identity                   |
| provider timed out after accepting request   | declared ambiguous outcome; no automatic blind retry                   |
| credential provider failed                   | ingress error, not anonymous elevation or silent downgrade             |
| File row denied but key guessed              | same `404` as absent row; storage is not opened                        |
| object exists without File row               | not served                                                             |
| object missing after authorized row          | nondisclosing `404`, reconciliation event emitted                      |
| forged/stale Search key                      | source Policy removes it                                               |
| denied Search result                         | absent from hit, `total`, facet, cursor, and statistic                 |
| Search Policy cannot lower                   | fail closed; no post-filter fallback claim                             |
| index worker crashes after source commit     | durable checkpoint retries; source transaction remains committed       |
| arbitrary external engine requested          | unsupported until a focused adapter contract passes                    |

## Acceptance position

Adopt Variant B as the workbench direction. It preserves the compact inline DX
of v3 while giving the compiler and Runtime four truthful seams. Reject the
generic Operation factory and builder/file convention as public defaults.

The next focused proofs should be split rather than accepting this whole note
at once:

1. Route + Action Definition/type/runtime artifact proof;
2. concrete Better Auth credential-to-Principal proof;
3. File metadata/download authorization proof; and
4. committed PostgreSQL Search projection plus authorized-candidate proof.

Only after each bounded proof, budgets, golden artifacts, hostile cases, and a
fresh focused Opus-medium `PASS` should its names enter the API inventory,
design-fiction guide, ADR index, glossary, implementation gates, or public v4
documentation.
