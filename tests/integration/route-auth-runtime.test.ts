import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";

import {
	createApplicationRuntime,
	createRuntimeRouteExecutor,
} from "../../packages/runtime/src";
import { OperationFailure } from "../../packages/runtime/src/operation";

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
			resolve: async ({ request, service }) => {
				expect(service.ready).toBe(true);
				if (request.headers.has("x-resolver-bug"))
					throw new Error("credential provider detail must not escape");
				if (request.headers.has("x-wait-for-abort")) {
					request.signal.throwIfAborted();
					await new Promise<never>((_resolve, reject) => {
						request.signal.addEventListener(
							"abort",
							() => reject(request.signal.reason),
							{ once: true },
						);
					});
				}
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

	const resolverBug = await routes.fetch(
		new Request("https://app.test/outcomes", {
			headers: { "x-resolver-bug": "1" },
		}),
	);
	expect(resolverBug!.status).toBe(500);
	expect(await resolverBug!.json()).toEqual({
		error: { code: "INTERNAL", retryable: false },
	});
	expect({ handlerCalls, routeProjections }).toEqual({
		handlerCalls: 1,
		routeProjections: 1,
	});

	const controller = new AbortController();
	const cancelled = routes.fetch(
		new Request("https://app.test/outcomes", {
			headers: { "x-wait-for-abort": "1" },
			signal: controller.signal,
		}),
	);
	await Promise.resolve();
	controller.abort(new DOMException("credential caller left", "AbortError"));
	await expect(cancelled).rejects.toMatchObject({
		name: "AbortError",
		message: "credential caller left",
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
	await expect(
		routes.direct("route:echo.raw", {
			request: new Request("https://app.test/echo", {
				method: "POST",
				body: rawBody,
			}),
			execution: {
				principal: {
					questpiePrincipal: true,
					kind: "user",
					id: "forged",
				} as never,
			},
		}),
	).rejects.toThrow("Route requires a trusted Principal");
	expect(handlerCalls).toBe(2);
	await runtime.close();
});

test("preserves typed Route execution failures and propagates request cancellation", async () => {
	const context = defineContext({
		name: "route.failure-context",
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
		project: ({ signal }) => ({ signal }),
		bindings: [
			{
				identity: "route:failure.typed",
				method: "GET",
				path: "/failure/typed",
				credentials: "none",
				admission: "public",
				execute: () => {
					throw new OperationFailure("RUNTIME_UNAVAILABLE", true);
				},
			},
			{
				identity: "route:failure.cancelled",
				method: "GET",
				path: "/failure/cancelled",
				credentials: "none",
				admission: "public",
				execute: ({ ctx }) =>
					new Promise<Response>((_resolve, reject) => {
						ctx.signal.addEventListener(
							"abort",
							() => reject(ctx.signal.reason),
							{ once: true },
						);
					}),
			},
		],
	});

	const unavailable = await routes.fetch(
		new Request("https://app.test/failure/typed"),
	);
	expect(unavailable!.status).toBe(503);
	expect(await unavailable!.json()).toEqual({
		error: { code: "RUNTIME_UNAVAILABLE", retryable: true },
	});
	await expect(
		routes.direct("route:failure.typed", {
			request: new Request("https://app.test/failure/typed"),
			execution: { principal: principal.anonymous() },
		}),
	).rejects.toMatchObject({
		code: "RUNTIME_UNAVAILABLE",
		retryable: true,
	});

	const controller = new AbortController();
	const cancelled = routes.fetch(
		new Request("https://app.test/failure/cancelled", {
			signal: controller.signal,
		}),
	);
	controller.abort(new DOMException("client disconnected", "AbortError"));
	await expect(cancelled).rejects.toMatchObject({
		name: "AbortError",
		message: "client disconnected",
	});
	await runtime.close();
});

test("projects decoded Route params and enforces body and duration limits", async () => {
	let releaseLateHandler!: () => void;
	let releaseStreamPull!: () => void;
	const context = defineContext({
		name: "route.limit-context",
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
		project: ({ signal }) => ({ signal }),
		bindings: [
			{
				identity: "route:limits.params",
				method: "POST",
				path: "/accounts/:accountId/*rest",
				credentials: "none",
				admission: "public",
				limits: { bodyBytes: 4, durationMs: 1_000 },
				execute: async ({ request, ctx }) =>
					Response.json({ body: await request.text(), params: ctx.params }),
			},
			{
				identity: "route:limits.deadline",
				method: "GET",
				path: "/deadline",
				credentials: "none",
				admission: "public",
				limits: { bodyBytes: 0, durationMs: 1 },
				execute: ({ ctx }) => {
					void new Promise<void>((resolve) => {
						expect(ctx.deadline).toBeGreaterThan(Date.now() - 10);
						ctx.signal.addEventListener("abort", () => resolve(), {
							once: true,
						});
					});
					return new Promise<Response>((resolve) => {
						releaseLateHandler = () => resolve(new Response("too late"));
					});
				},
			},
			{
				identity: "route:limits.exact",
				method: "GET",
				path: "/assets",
				credentials: "none",
				admission: "public",
				execute: () => new Response("exact"),
			},
			{
				identity: "route:limits.wildcard",
				method: "GET",
				path: "/assets/*rest",
				credentials: "none",
				admission: "public",
				execute: ({ ctx }) => new Response(`wildcard:${ctx.params.rest}`),
			},
			{
				identity: "route:limits.stream",
				method: "GET",
				path: "/stream-deadline",
				credentials: "none",
				admission: "public",
				limits: { bodyBytes: 0, durationMs: 1 },
				execute: () =>
					new Response(
						new ReadableStream({
							pull: (controller) =>
								new Promise<void>((resolve) => {
									releaseStreamPull = () => {
										void controller;
										resolve();
									};
								}),
						}),
					),
			},
			{
				identity: "route:limits.ignored-body",
				method: "POST",
				path: "/ignored-body",
				credentials: "none",
				admission: "public",
				limits: { bodyBytes: 4, durationMs: 1_000 },
				execute: () => new Response(null, { status: 204 }),
			},
		],
	});

	const accepted = await routes.fetch(
		new Request("https://app.test/accounts/a%20b/nested/path", {
			method: "POST",
			body: "four",
		}),
	);
	expect(await accepted!.json()).toEqual({
		body: "four",
		params: { accountId: "a b", rest: "nested/path" },
	});
	const tooLarge = await routes.fetch(
		new Request("https://app.test/accounts/a/path", {
			method: "POST",
			body: "large",
		}),
	);
	expect(tooLarge!.status).toBe(413);
	expect(await tooLarge!.json()).toEqual({
		error: { code: "RESOURCE_LIMIT", retryable: false },
	});
	const ignoredBody = await routes.fetch(
		new Request("https://app.test/ignored-body", {
			method: "POST",
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("large"));
					controller.close();
				},
			}),
			duplex: "half",
		} as RequestInit),
	);
	expect(ignoredBody!.status).toBe(413);
	const expired = await routes.fetch(new Request("https://app.test/deadline"));
	expect(expired!.status).toBe(429);
	expect(await expired!.json()).toEqual({
		error: { code: "RESOURCE_LIMIT", retryable: true },
	});
	releaseLateHandler();
	expect(
		await (await routes.fetch(new Request("https://app.test/assets")))!.text(),
	).toBe("exact");
	expect(
		await (await routes.fetch(
			new Request("https://app.test/assets/icons/logo"),
		))!.text(),
	).toBe("wildcard:icons/logo");
	const streamed = await routes.fetch(
		new Request("https://app.test/stream-deadline"),
	);
	await expect(streamed!.text()).rejects.toMatchObject({
		name: "RouteResourceLimitError",
	});
	releaseStreamPull();
	await expect(
		routes.direct("route:limits.exact", {
			request: new Request("https://app.test/assets", { method: "POST" }),
			execution: { principal: principal.anonymous() },
		}),
	).rejects.toThrow("method does not match");
	await runtime.close();
});

test("maps Route admission before projection or handler execution", async () => {
	let routeProjections = 0;
	let handlerCalls = 0;
	const context = defineContext({
		name: "route.admission-context",
		input: codec.object({ companyId: codec.uuid() }),
		resolve: ({ input }) => ({ tenant: { id: input.companyId }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	const denied = () => {
		handlerCalls += 1;
		return new Response(null, { status: 204 });
	};
	const routes = createRuntimeRouteExecutor({
		runtime,
		project: () => {
			routeProjections += 1;
			return {};
		},
		bindings: [
			{
				identity: "route:admission.authenticated",
				method: "GET",
				path: "/admission/authenticated",
				credentials: "application",
				admission: "authenticated",
				execute: denied,
			},
			{
				identity: "route:admission.system",
				method: "GET",
				path: "/admission/system",
				credentials: "none",
				admission: "system",
				execute: denied,
			},
		],
	});

	const unauthenticated = await routes.fetch(
		new Request("https://app.test/admission/authenticated"),
	);
	expect(unauthenticated!.status).toBe(401);
	expect(await unauthenticated!.json()).toEqual({
		error: { code: "UNAUTHENTICATED", retryable: false },
	});
	const forbidden = await routes.direct("route:admission.system", {
		request: new Request("https://app.test/admission/system"),
		execution: { principal: principal.user({ id: "ordinary" }) },
	});
	expect(forbidden.status).toBe(403);
	expect(await forbidden.json()).toEqual({
		error: { code: "FORBIDDEN", retryable: false },
	});
	expect({ handlerCalls, routeProjections }).toEqual({
		handlerCalls: 0,
		routeProjections: 0,
	});
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
