import { expect, test } from "bun:test";

import {
	beginApplicationExecution,
	observeApplicationFetch,
} from "../../packages/runtime/src/application/observation";
import {
	createObservationKernel,
	retainScopeThroughResponse,
	type ExecutionEventV2,
	type NeutralTraceContextV1,
	type ObservationAdapterV1,
	type ObservationStartV1,
} from "../../packages/runtime/src/observation";
import { OperationFailure } from "../../packages/runtime/src/operation";

const TRACE: NeutralTraceContextV1 = {
	flags: 1,
	format: "questpie.trace-context",
	spanId: new Uint8Array(8).fill(2),
	traceId: new Uint8Array(16).fill(1),
	version: 1,
};

const OPERATIONS = [
	{ identity: "query:messages.page" },
	{ identity: "mutation:messages.publish" },
	{ identity: "action:reports.export" },
] as const;

test("owns exact Fetch propagation and retains its scope through body EOF", async () => {
	const extracted: unknown[] = [];
	const starts: ObservationStartV1[] = [];
	const events: ExecutionEventV2[] = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract(input) {
			extracted.push(input);
			if (input.traceparent === "fault") throw new Error("extractor fault");
			if (input.traceparent === null) return null;
			if (input.traceparent === "restart")
				return { kind: "root-with-links", links: [TRACE] };
			return {
				extracted: { context: TRACE, tracestate: input.tracestate },
				kind: "remote-parent",
			};
		},
		begin(input) {
			starts.push(input);
			return {
				context: null,
				run: async (use) => await use(),
				event: () => undefined,
				end: () => undefined,
			};
		},
	};
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		events: (event) => events.push(event),
		runtimeBuildDigest: "a".repeat(64),
	});
	let bodyController!: ReadableStreamDefaultController<Uint8Array>;
	let work = 0;
	const fetch = observeApplicationFetch(observation, OPERATIONS, async () => {
		work += 1;
		if (work > 1) return new Response("ordinary result", { status: 202 });
		return new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					bodyController = controller;
				},
			}),
			{ status: 201 },
		);
	});
	const response = await fetch(
		new Request("https://runtime.test/_questpie/mutation/messages.publish", {
			method: "POST",
			headers: {
				baggage: "must-not-cross",
				traceparent: "00-01010101010101010101010101010101-0202020202020202-01",
				tracestate: "vendor=value",
			},
		}),
	);
	expect(work).toBe(1);
	expect(extracted).toEqual([
		{
			traceparent: "00-01010101010101010101010101010101-0202020202020202-01",
			tracestate: "vendor=value",
		},
	]);
	expect(starts[0]).toMatchObject({
		kind: "fetch",
		method: "POST",
		principalKind: null,
		requestKind: "generated_operation",
		scheme: "https",
		suppressHttp: true,
		trace: { kind: "remote-parent" },
	});
	expect(events.map((event) => event.kind)).toEqual(["scope.started"]);
	bodyController.enqueue(new TextEncoder().encode("ok"));
	bodyController.close();
	expect(await response.text()).toBe("ok");
	expect(events.map((event) => event.kind)).toEqual([
		"scope.started",
		"scope.ended",
	]);
	expect(events[1]).toMatchObject({
		end: { httpResponseStatusCode: 201, kind: "fetch", outcome: "ok" },
	});
	expect(JSON.stringify(events).includes("must-not-cross")).toBe(false);

	const fault = await fetch(
		new Request("http://runtime.test/_questpie/mutation/messages.publish", {
			headers: { traceparent: "fault" },
			method: "POST",
		}),
	);
	expect(await fault.text()).toBe("ordinary result");
	expect(work).toBe(2);
	expect(starts.at(-1)).toMatchObject({ trace: { kind: "root" } });

	for (const headers of [
		{ tracestate: "orphan=value" },
		{
			traceparent: "00-01010101010101010101010101010101-0202020202020202-01",
			tracestate: "x".repeat(513),
		},
	]) {
		const invalid = await fetch(
			new Request("http://runtime.test/private/customer-id", {
				headers,
				method: "POST",
			}),
		);
		expect(await invalid.text()).toBe("ordinary result");
		expect(starts.at(-1)).toMatchObject({
			requestKind: "unmatched",
			trace: { kind: "root" },
		});
	}
	const restarted = await fetch(
		new Request("https://runtime.test/_questpie/mutation/messages.publish", {
			headers: { traceparent: "restart", tracestate: "must-drop" },
			method: "POST",
		}),
	);
	expect(await restarted.text()).toBe("ordinary result");
	expect(starts.at(-1)).toMatchObject({
		trace: { kind: "root-with-links", links: [TRACE] },
	});
	expect(JSON.stringify(starts.at(-1))).not.toContain("must-drop");
	expect(work).toBe(5);
	const wrongMethod = await fetch(
		new Request("https://runtime.test/_questpie/mutation/messages.publish", {
			method: "GET",
		}),
	);
	expect(await wrongMethod.text()).toBe("ordinary result");
	expect(starts.at(-1)).toMatchObject({
		method: "GET",
		requestKind: "unmatched",
	});
	expect(JSON.stringify(events)).not.toContain("customer-id");
	const startsBeforeUnsupportedScheme = starts.length;
	const unsupportedScheme = await fetch(
		new Request("ftp://runtime.test/private"),
	);
	expect(await unsupportedScheme.text()).toBe("ordinary result");
	expect(starts).toHaveLength(startsBeforeUnsupportedScheme);
});

test("ends pre-Response Fetch failures without inventing an HTTP status", async () => {
	const ends: unknown[] = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin: () => ({
			context: null,
			end: (end) => ends.push(end),
			event: () => undefined,
			run: async (use) => await use(),
		}),
	};
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "a".repeat(64),
	});
	let failure: "deadline" | "framework" = "framework";
	const fetch = observeApplicationFetch(observation, OPERATIONS, async () => {
		if (failure === "deadline")
			throw new OperationFailure("DEADLINE_EXCEEDED", true);
		throw new Error("before response");
	});
	await expect(
		fetch(new Request("https://runtime.test/private")),
	).rejects.toThrow("before response");
	const abort = new AbortController();
	abort.abort("caller");
	await expect(
		fetch(
			new Request("https://runtime.test/private", { signal: abort.signal }),
		),
	).rejects.toThrow("before response");
	failure = "deadline";
	await expect(
		fetch(new Request("https://runtime.test/private")),
	).rejects.toThrow("DEADLINE_EXCEEDED");
	expect(ends).toEqual([
		{
			httpResponseStatusCode: null,
			kind: "fetch",
			outcome: "framework_error",
		},
		{ httpResponseStatusCode: null, kind: "fetch", outcome: "cancelled" },
		{ httpResponseStatusCode: null, kind: "fetch", outcome: "deadline" },
	]);
});

test("keeps the Fetch adapter context active while the child Execution begins", async () => {
	const fetchContext: NeutralTraceContextV1 = {
		...TRACE,
		spanId: new Uint8Array(8).fill(3),
	};
	const executionContext: NeutralTraceContextV1 = {
		...TRACE,
		spanId: new Uint8Array(8).fill(4),
	};
	let active: NeutralTraceContextV1 | null = null;
	const began: Array<{
		active: NeutralTraceContextV1 | null;
		input: ObservationStartV1;
	}> = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => ({
			extracted: { context: TRACE, tracestate: null },
			kind: "remote-parent",
		}),
		begin(input) {
			began.push({ active, input });
			const context = input.kind === "fetch" ? fetchContext : executionContext;
			return {
				context,
				end: () => undefined,
				event: () => undefined,
				async run(use) {
					const previous = active;
					active = context;
					try {
						return await use();
					} finally {
						active = previous;
					}
				},
			};
		},
	};
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "a".repeat(64),
	});
	const fetch = observeApplicationFetch(observation, OPERATIONS, async () => {
		const execution = beginApplicationExecution(observation, "fetch", "user");
		if (execution === null) throw new Error("expected observed Execution");
		execution.scope.end({ kind: "execution", outcome: "ok" });
		return new Response(null, { status: 204 });
	});
	expect(
		await fetch(
			new Request("https://runtime.test/_questpie/query/messages.page"),
		),
	).toMatchObject({ status: 204 });
	expect(began).toHaveLength(2);
	expect(began[0]).toMatchObject({
		active: null,
		input: { kind: "fetch", trace: { kind: "remote-parent" } },
	});
	expect(began[1]).toMatchObject({
		active: fetchContext,
		input: { kind: "execution", trace: { kind: "active-parent" } },
	});
});

test("preserves an already-created response when its request is already aborted", async () => {
	const ends: unknown[] = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => null,
		begin: () => ({
			context: null,
			end: (end) => ends.push(end),
			event: () => undefined,
			run: async (use) => await use(),
		}),
	};
	const observation = createObservationKernel({
		adapter,
		applicationIdentity: "application:collaboration",
		createRuntimeInstanceId: () => "01234567-89ab-4def-8123-456789abcdef",
		runtimeBuildDigest: "a".repeat(64),
	});
	const abort = new AbortController();
	const fetch = observeApplicationFetch(observation, OPERATIONS, async () => {
		abort.abort("caller disconnected");
		return new Response("known result", { status: 202 });
	});
	const response = await fetch(
		new Request("https://runtime.test/_questpie/query/messages.page", {
			signal: abort.signal,
		}),
	);
	expect(response.status).toBe(202);
	expect(await response.text()).toBe("known result");
	expect(ends).toContainEqual({
		httpResponseStatusCode: 202,
		kind: "fetch",
		outcome: "cancelled",
	});
});

test("contains a source cancellation rejection after the response consumer leaves", async () => {
	const ends: unknown[] = [];
	const response = retainScopeThroughResponse(
		{
			end: (end) => ends.push(end),
			event: () => undefined,
			run: async (use) => await use(),
		},
		new Response(
			new ReadableStream<Uint8Array>({
				cancel() {
					throw new DOMException("The connection was closed.", "AbortError");
				},
			}),
			{ status: 200 },
		),
	);

	await expect(response.body!.cancel("Firefox left")).resolves.toBeUndefined();
	expect(ends).toEqual([
		{ httpResponseStatusCode: 200, kind: "fetch", outcome: "cancelled" },
	]);
});

test("closes an observed response when its source reports transport cancellation", async () => {
	const ends: unknown[] = [];
	const response = retainScopeThroughResponse(
		{
			end: (end) => ends.push(end),
			event: () => undefined,
			run: async (use) => await use(),
		},
		new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					throw new DOMException("The connection was closed.", "AbortError");
				},
			}),
			{ status: 200 },
		),
	);

	await expect(response.body!.getReader().read()).resolves.toEqual({
		done: true,
		value: undefined,
	});
	expect(ends).toEqual([
		{ httpResponseStatusCode: 200, kind: "fetch", outcome: "cancelled" },
	]);
});

test("preserves an ordinary observed response source failure", async () => {
	const ends: unknown[] = [];
	const response = retainScopeThroughResponse(
		{
			end: (end) => ends.push(end),
			event: () => undefined,
			run: async (use) => await use(),
		},
		new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					throw new Error("source failed");
				},
			}),
			{ status: 200 },
		),
	);

	await expect(response.body!.getReader().read()).rejects.toThrow(
		"source failed",
	);
	expect(ends).toEqual([
		{ httpResponseStatusCode: 200, kind: "fetch", outcome: "framework_error" },
	]);
});
