# Service, Route, and Auth composition

ADR-0015 accepts the smallest integration seam that preserves the useful v3
jobs without retaining mutable registries, middleware ordering, ambient request
context, or vendor-owned framework authority.

## Contract

One compiler-owned graph contains Service and Route Definitions. A Service has
stable identity, Owner, Origin, explicit dependencies, a lifetime, and an
effect class. A Route has stable identity, literal Fetch mount, admission and
limit metadata, one statically bound handler, and a generated direct-call
projection. Duplicate identities, dependency cycles, invalid lifetime/effect
edges, and conflicting mounts fail compilation.

Application Services are lazy per Runtime instance. Execution Services are
lazy per root boundary. Construction coalesces concurrent consumers and cleanup
runs once in reverse dependency order after success, failure, stream EOF, or
stream cancellation. There is no cluster singleton and no Service instance in
the Compiled Manifest or resolved Context.

The transaction-safe Service projection cannot contain or depend on an
external-effect Service. Query and Mutation therefore cannot hide provider
calls. Routes and later Actions may receive the explicit external projection;
neither gains automatic retry.

## Route and Fetch

The generated Runtime remains the only server entrypoint. It mounts every
accepted Route into `app.fetch` and emits a `routes` direct-invocation map. A
raw handler receives exact Fetch values and a deliberately small context:

```ts
import { policy, principal } from "questpie";
import { defineRoute } from "#questpie/app";

export const deliveryWebhook = defineRoute({
	name: "delivery.webhook",
	method: "POST",
	path: "/webhooks/delivery",
	policy: policy.public(),
	credentials: "none",
	limits: { bodyBytes: 256_000, durationMs: 10_000 },
	async handler({ request, ctx }) {
		const body = await request.text();
		await verifyDeliverySignature(request.headers, body);

		return ctx.execution(
			{
				principal: principal.service({ name: "delivery.webhook" }),
				context: { companyId: request.headers.get("x-company-id")! },
			},
			async ({ mutations }) => {
				await mutations.delivery.record({ body });
				return new Response(null, { status: 204 });
			},
		);
	},
});
```

Before `ctx.execution`, the Route has no Collection data, mutations, raw
database, or System elevation. The transition constructs a fresh ordinary
application Execution and reuses the accepted Context, Policy, Operation,
transaction, observation, and error engines.

Network Fetch resolves credentials at ingress. Direct invocation supplies an
explicit Principal:

```ts
await app.routes["delivery.webhook"].direct({
	request,
	execution: { principal: principal.anonymous() },
});
```

Direct invocation never replays cookies or bearer tokens. A Route is not a
generated JSON client Operation; callers that want that contract author a
Query, Mutation, or Action.

## Auth composition

Auth produces Principal. Policy alone decides admission and disclosure, and
Context Resolution produces application scope. An application can own an auth
library, its Collections, migration participation, and native client while
using ordinary QUESTPIE primitives at the boundary:

```ts
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

Provider failure returns a typed ingress failure rather than anonymous. The
native Auth client remains native application code. A later reference Package
may remove repetition, but it must normalize into these ordinary Definitions
and the normal reviewed migration lifecycle.

## Proof and limits

The accepted proof input is
`7211bd3c8a9cdbe131b026874d4441f3ccb39c9d`; the acceptance record head is
`79d3667019e0a4cda6f7652d24f2d9c6b68d4fca`. One fresh stateless Claude Opus
review at medium effort returned `PASS`. The proof covers exact resource/mount
digests, raw/direct parity, credential outcomes, two Runtime instances,
execution coalescing, reverse cleanup at EOF/error/cancellation, forbidden
capabilities and dependencies, Package isolation, exact completions, 2,396
declaration bytes, 1,257 TypeScript instantiations, and a 0.39-second focused
typecheck.

The proof fixes semantic shape, not production compiler behavior. The Route
slice must derive artifacts from real source, test exact and overlapping path
collisions and typed parameters, and retain relocation and TypeScript budgets.
ADR-0019 consolidates the factory names without changing this
contract.
