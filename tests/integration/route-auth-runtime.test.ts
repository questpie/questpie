import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";

import {
	createApplicationRuntime,
	createRuntimeRouteExecutor,
} from "../../packages/runtime/src";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";

test("resolves application credentials before executing a handcrafted Route binding", async () => {
	let contextResolutions = 0;
	const auth = defineService({
		name: "route.auth",
		lifetime: "application",
		effect: "external",
		create: () => ({
			resolve(headers: Headers) {
				const id = headers.get("authorization");
				return id ? principal.user({ id }) : principal.anonymous();
			},
		}),
	});
	const context = defineContext({
		name: "route.context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => {
			contextResolutions += 1;
			return { tenant: { id: input.companyId }, values: {} };
		},
	});
	const runtime = createApplicationRuntime({
		services: [auth],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const routes = createRuntimeRouteExecutor({
		runtime,
		credentials: {
			service: auth,
			resolve: ({ request, service }) => ({
				kind: "resolved",
				principal: service.resolve(request.headers),
			}),
		},
		project: ({ principal: caller, execution }) => ({
			principal: caller,
			execution,
		}),
		bindings: [
			{
				identity: "route:account.raw",
				method: "GET",
				path: "/account",
				credentials: "application",
				admission: "public",
				execute: ({ ctx }) => {
					const contextResolutionsBeforeTransition = contextResolutions;
					return ctx.execution(
						{ principal: ctx.principal, context: { companyId } },
						(facts) =>
							Response.json({
								contextResolutionsBeforeTransition,
								principalId: facts.principal.id,
								tenantId: facts.tenant.id,
							}),
					);
				},
			},
		],
	});

	const response = await routes.fetch(
		new Request("https://app.test/account", {
			headers: { authorization: "user:resolved" },
		}),
	);
	expect(response).not.toBeNull();
	expect(await response!.json()).toEqual({
		contextResolutionsBeforeTransition: 0,
		principalId: "user:resolved",
		tenantId: companyId,
	});
	expect(contextResolutions).toBe(1);
	await runtime.close();
});

test("keeps anonymous credentials distinct from typed provider unavailability", async () => {
	let handlerCalls = 0;
	let routeProjections = 0;
	const auth = defineService({
		name: "route.auth-outcomes",
		lifetime: "application",
		effect: "external",
		create: () => ({ ready: true }),
	});
	const context = defineContext({
		name: "route.outcome-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [auth],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const routes = createRuntimeRouteExecutor({
		runtime,
		credentials: {
			service: auth,
			resolve: ({ request, service }) => {
				expect(service.ready).toBe(true);
				return request.headers.has("x-provider-down")
					? { kind: "unavailable" }
					: { kind: "anonymous" };
			},
		},
		project: ({ principal: caller }) => {
			routeProjections += 1;
			return { principal: caller };
		},
		bindings: [
			{
				identity: "route:outcomes.raw",
				method: "GET",
				path: "/outcomes",
				credentials: "application",
				admission: "public",
				execute: ({ ctx }) => {
					handlerCalls += 1;
					return Response.json({ principalKind: ctx.principal.kind });
				},
			},
		],
	});

	const anonymous = await routes.fetch(
		new Request("https://app.test/outcomes"),
	);
	expect(await anonymous!.json()).toEqual({ principalKind: "anonymous" });
	expect({ handlerCalls, routeProjections }).toEqual({
		handlerCalls: 1,
		routeProjections: 1,
	});

	const unavailable = await routes.fetch(
		new Request("https://app.test/outcomes", {
			headers: { "x-provider-down": "provider detail must not escape" },
		}),
	);
	expect(unavailable!.status).toBe(503);
	expect(unavailable!.headers.get("cache-control")).toBe("no-store");
	expect(await unavailable!.json()).toEqual({
		error: { code: "CREDENTIALS_UNAVAILABLE", retryable: true },
	});
	expect({ handlerCalls, routeProjections }).toEqual({
		handlerCalls: 1,
		routeProjections: 1,
	});
	await runtime.close();
});

test("uses a trusted anonymous Principal when no credential resolver is installed", async () => {
	const context = defineContext({
		name: "route.zero-resolver-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const routes = createRuntimeRouteExecutor({
		runtime,
		project: ({ principal: caller }) => ({ principal: caller }),
		bindings: [
			{
				identity: "route:zero-resolver.raw",
				method: "GET",
				path: "/zero-resolver",
				credentials: "application",
				admission: "public",
				execute: ({ ctx }) =>
					Response.json({
						principalId: ctx.principal.id,
						trusted: principal.is(ctx.principal),
					}),
			},
		],
	});

	const response = await routes.fetch(
		new Request("https://app.test/zero-resolver"),
	);
	expect(await response!.json()).toEqual({
		principalId: "anonymous",
		trusted: true,
	});
	await runtime.close();
});

test("uses one Route handler for Fetch and direct invocation while direct bypasses credentials", async () => {
	let credentialResolutions = 0;
	let handlerCalls = 0;
	const auth = defineService({
		name: "route.auth-parity",
		lifetime: "application",
		effect: "external",
		create: () => ({ ready: true }),
	});
	const context = defineContext({
		name: "route.parity-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [auth],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const routes = createRuntimeRouteExecutor({
		runtime,
		credentials: {
			service: auth,
			resolve: ({ request, service }) => {
				expect(service.ready).toBe(true);
				credentialResolutions += 1;
				return {
					kind: "resolved",
					principal: principal.user({
						id: request.headers.get("authorization")!,
					}),
				};
			},
		},
		project: ({ principal: caller }) => ({ principal: caller }),
		bindings: [
			{
				identity: "route:echo.raw",
				method: "POST",
				path: "/echo",
				credentials: "application",
				admission: "authenticated",
				execute: async ({ request, ctx }) => {
					handlerCalls += 1;
					return Response.json({
						body: await request.text(),
						principalId: ctx.principal.id,
					});
				},
			},
		],
	});
	const rawBody = "raw=bytes%0Aremain";

	const direct = await routes.direct("route:echo.raw", {
		request: new Request("https://app.test/echo", {
			method: "POST",
			headers: { authorization: "must-not-be-resolved" },
			body: rawBody,
		}),
		execution: { principal: principal.user({ id: "user:same" }) },
	});
	expect(credentialResolutions).toBe(0);
	const fetched = await routes.fetch(
		new Request("https://app.test/echo", {
			method: "POST",
			headers: { authorization: "user:same" },
			body: rawBody,
		}),
	);

	expect(await fetched!.text()).toBe(await direct.text());
	expect(credentialResolutions).toBe(1);
	expect(handlerCalls).toBe(2);
	await runtime.close();
});

test("disposes Route execution Services after response EOF, error, and cancellation", async () => {
	const events: string[] = [];
	let nextService = 0;
	const streamed = defineService({
		name: "route.streamed",
		lifetime: "execution",
		effect: "external",
		create: () => {
			nextService += 1;
			events.push(`create:${nextService}`);
			return Object.freeze({ id: nextService });
		},
		dispose: ({ id }) => {
			events.push(`dispose:${id}`);
		},
	});
	const context = defineContext({
		name: "route.stream-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [streamed],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const streamBinding = (
		identity: `route:${string}`,
		path: `/${string}`,
		body: () => ReadableStream<Uint8Array>,
	) => ({
		identity,
		method: "GET" as const,
		path,
		credentials: "none" as const,
		admission: "public" as const,
		execute: ({ ctx }: { ctx: Readonly<{ serviceId: number }> }) => {
			expect(ctx.serviceId).toBeGreaterThan(0);
			return new Response(body());
		},
	});
	const routes = createRuntimeRouteExecutor({
		runtime,
		project: async ({ service }) => ({
			serviceId: (await service(streamed)).id,
		}),
		bindings: [
			streamBinding(
				"route:stream.eof",
				"/stream/eof",
				() =>
					new ReadableStream({
						start(controller) {
							controller.enqueue(new TextEncoder().encode("done"));
							controller.close();
						},
					}),
			),
			streamBinding(
				"route:stream.error",
				"/stream/error",
				() =>
					new ReadableStream({
						start(controller) {
							controller.error(new Error("route body failed"));
						},
					}),
			),
			streamBinding(
				"route:stream.cancel",
				"/stream/cancel",
				() => new ReadableStream({ pull() {} }),
			),
		],
	});

	const eof = await routes.fetch(new Request("https://app.test/stream/eof"));
	expect(events).toEqual(["create:1"]);
	expect(await eof!.text()).toBe("done");
	expect(events).toEqual(["create:1", "dispose:1"]);

	const failed = await routes.fetch(
		new Request("https://app.test/stream/error"),
	);
	expect(events).toEqual(["create:1", "dispose:1", "create:2", "dispose:2"]);
	await expect(failed!.text()).rejects.toThrow("route body failed");
	expect(events).toEqual(["create:1", "dispose:1", "create:2", "dispose:2"]);

	const cancelled = await routes.fetch(
		new Request("https://app.test/stream/cancel"),
	);
	expect(events.at(-1)).toBe("create:3");
	await cancelled!.body!.cancel("consumer disconnected");
	expect(events.at(-1)).toBe("dispose:3");
	await runtime.close();
	expect(events.filter((event) => event.startsWith("dispose:"))).toHaveLength(
		3,
	);
});
