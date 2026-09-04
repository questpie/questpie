import { expect, test } from "bun:test";

import { codec, defineContext, defineService, principal } from "questpie";
import { createOfficialQuestpieObservability } from "questpie/internal/observability";

import {
	createApplicationRuntime,
	createRuntimeRouteExecutor,
} from "../../packages/runtime/src";
import {
	beginApplicationExecution,
	createApplicationObservation,
	observeApplicationRoute,
	observeApplicationUnmatchedFetch,
} from "../../packages/runtime/src/application/observation";
import {
	type ExecutionEventV2,
	type ObservationAdapterV1,
} from "../../packages/runtime/src/observation";

const createObservationHandle = (adapter: ObservationAdapterV1) =>
	createOfficialQuestpieObservability(() => adapter);

test("owns one matched Route through credential work, nested Execution, and response EOF", async () => {
	const events: ExecutionEventV2[] = [];
	const entries: string[] = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin(input) {
			entries.push(input.kind);
			return {
				context: null,
				run: async (use) => await use(),
				event: () => undefined,
				end: () => undefined,
			};
		},
	};
	const observation = createApplicationObservation({
		applicationIdentity: "application:routes",
		runtimeBuildDigest: "d".repeat(64),
		questpieVersion: "4.0.0-beta.2",
		signalProjectionDigest: "e".repeat(64),
		observability: createObservationHandle(adapter),
		events: (event) => events.push(event),
	});
	if (!observation) throw new Error("expected observation kernel");
	let credentialChecks = 0;
	const request = new Request("https://app.test/hooks/created", {
		method: "POST",
	});
	const response = await observeApplicationRoute(
		observation,
		request,
		"/hooks/:kind",
		async () => {
			credentialChecks += 1;
			const execution = beginApplicationExecution(observation, "fetch", "user");
			await execution?.scope.run(async () => undefined);
			execution?.scope.end({ kind: "execution", outcome: "ok" });
			return {
				outcome: "ok",
				response: new Response("accepted", { status: 202 }),
				signal: request.signal,
				finalize: () => undefined,
				retainControl: true,
			};
		},
	);

	expect(credentialChecks).toBe(1);
	expect(entries).toEqual(["route", "execution"]);
	expect(
		events
			.filter((event) => event.kind === "scope.ended")
			.map((event) => [event.scopeKind, event.end.outcome]),
	).toEqual([["execution", "ok"]]);
	expect(await response.text()).toBe("accepted");
	expect(
		events
			.filter((event) => event.kind === "scope.ended")
			.map((event) => [
				event.scopeKind,
				event.end.outcome,
				"httpResponseStatusCode" in event.end
					? event.end.httpResponseStatusCode
					: undefined,
			]),
	).toEqual([
		["execution", "ok", undefined],
		["route", "ok", 202],
	]);
});

test("starts the generated Route owner before credentials and invokes the handler once", async () => {
	const order: string[] = [];
	const events: ExecutionEventV2[] = [];
	const observation = createApplicationObservation({
		applicationIdentity: "application:routes",
		runtimeBuildDigest: "e".repeat(64),
		events: (event) => events.push(event),
	});
	if (!observation) throw new Error("expected observation kernel");
	const auth = defineService({
		name: "route.observed-auth",
		lifetime: "application",
		effect: "external",
		create: () => ({ ready: true }),
	});
	const context = defineContext({
		name: "route.observed-context",
		input: codec.object({}),
		resolve: () => ({ tenant: { id: "tenant:routes" }, values: {} }),
	});
	const runtime = createApplicationRuntime({
		services: [auth],
		context,
		bootstrap: () => ({ get: async () => null }),
		project: ({ facts }) => facts,
	});
	let handlerCalls = 0;
	const routes = createRuntimeRouteExecutor({
		runtime: {
			...runtime,
			observeRoute: (request, routeTemplate, use) => {
				order.push("route");
				return observeApplicationRoute(
					observation,
					request,
					routeTemplate,
					use,
				);
			},
			observeUnmatchedFetch: (request, use) =>
				observeApplicationUnmatchedFetch(observation, request, use),
		},
		credentials: {
			service: auth,
			resolve: ({ service }) => {
				expect(service.ready).toBe(true);
				order.push("credentials");
				return {
					kind: "resolved",
					principal: principal.user({ id: "user:1" }),
				};
			},
		},
		project: () => ({}),
		bindings: [
			{
				identity: "route:hooks.created",
				method: "POST",
				path: "/hooks/:kind",
				credentials: "application",
				admission: "authenticated",
				execute: () => {
					handlerCalls += 1;
					order.push("handler");
					return new Response("accepted", { status: 202 });
				},
			},
		],
	});
	const response = await routes.fetch(
		new Request("https://app.test/hooks/created", { method: "POST" }),
	);
	expect(response).not.toBeNull();
	expect(order).toEqual(["route", "credentials", "handler"]);
	expect(handlerCalls).toBe(1);
	expect(await response!.text()).toBe("accepted");
	expect(
		events
			.filter((event) => event.kind === "scope.ended")
			.map((event) => [event.scopeKind, event.end.outcome]),
	).toEqual([["route", "ok"]]);

	events.length = 0;
	const methodMismatch = await routes.fetch(
		new Request("https://app.test/hooks/created", { method: "GET" }),
	);
	expect(methodMismatch?.status).toBe(405);
	expect(
		events
			.filter((event) => event.kind === "scope.ended")
			.map((event) => [event.scopeKind, event.end.outcome]),
	).toEqual([["fetch", "ok"]]);

	events.length = 0;
	const direct = await routes.direct("route:hooks.created", {
		request: new Request("https://app.test/hooks/created", { method: "POST" }),
		execution: { principal: principal.user({ id: "user:1" }) },
	});
	expect(await direct.text()).toBe("accepted");
	expect(events).toEqual([]);

	const failingRoutes = createRuntimeRouteExecutor({
		runtime: {
			...runtime,
			observeRoute: (request, routeTemplate, use) =>
				observeApplicationRoute(observation, request, routeTemplate, use),
			observeUnmatchedFetch: (request, use) =>
				observeApplicationUnmatchedFetch(observation, request, use),
		},
		credentials: {
			service: auth,
			resolve: () => {
				throw new Error("credential backend failed");
			},
		},
		project: () => ({}),
		bindings: [
			{
				identity: "route:credentials.failure",
				method: "GET",
				path: "/credentials",
				credentials: "application",
				admission: "authenticated",
				execute: () => new Response("unreachable"),
			},
			{
				identity: "route:deadline",
				method: "GET",
				path: "/deadline",
				credentials: "none",
				admission: "public",
				limits: { bodyBytes: 1, durationMs: 0 },
				execute: () => new Response("unreachable"),
			},
		],
	});
	for (const [path, status, outcome] of [
		["/credentials", 500, "framework_error"],
		["/deadline", 429, "deadline"],
	] as const) {
		events.length = 0;
		const failure = await failingRoutes.fetch(
			new Request(`https://app.test${path}`),
		);
		expect(failure?.status).toBe(status);
		await failure?.text();
		expect(
			events
				.filter((event) => event.kind === "scope.ended")
				.map((event) => [
					event.scopeKind,
					event.end.outcome,
					"httpResponseStatusCode" in event.end
						? event.end.httpResponseStatusCode
						: undefined,
				]),
		).toEqual([["route", outcome, status]]);
	}
	await runtime.close();
});
