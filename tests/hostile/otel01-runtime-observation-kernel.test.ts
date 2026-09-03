import { describe, expect, test } from "bun:test";

import {
	createObservationKernel,
	retainScopeThroughResponse,
	type NeutralTraceContextV1,
	type ObservationAdapterV1,
	type ObservationEndV1,
	type ObservationScopeAdapterV1,
	type ObservationStartV1,
} from "../../packages/runtime/src/observation";

const INSTANCE = "01234567-89ab-4def-8123-456789abcdef";
const TRACE: NeutralTraceContextV1 = {
	flags: 1,
	format: "questpie.trace-context",
	spanId: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
	traceId: Uint8Array.from([
		1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
	]),
	version: 1,
};
const EXECUTION_START = {
	entry: "direct",
	kind: "execution",
	principalKind: "user",
	trace: { kind: "root" },
} as const;

function adapterWith(
	run: ObservationScopeAdapterV1["run"],
): ObservationAdapterV1 {
	return {
		begin: () => ({
			context: TRACE,
			end: () => undefined,
			event: () => undefined,
			run,
		}),
		extract: () => null,
		format: "questpie.runtime-observability",
		version: 1,
	};
}
function kernel(adapter?: ObservationAdapterV1, diagnostics: string[] = []) {
	return createObservationKernel({
		adapter,
		applicationIdentity: "supportDesk",
		createRuntimeInstanceId: () => INSTANCE,
		onDiagnostic: (code) => diagnostics.push(code),
		runtimeBuildDigest: "a".repeat(64),
		wallClock: () => new Date("2026-08-31T12:00:00.000Z"),
	});
}

describe("OTEL-01 hostile Runtime observation kernel", () => {
	test("admits exactly the closed fourteen semantic scope starts", () => {
		const observation = kernel();
		const rootless = [
			{ kind: "runtime", principalKind: "service", trace: { kind: "root" } },
			{
				kind: "fetch",
				method: "POST",
				principalKind: null,
				requestKind: "generated_operation",
				scheme: "https",
				suppressHttp: true,
				trace: { kind: "root" },
			},
			{
				kind: "route",
				method: "GET",
				principalKind: null,
				routeTemplate: "/health",
				scheme: "https",
				suppressHttp: true,
				trace: { kind: "root" },
			},
		] as const;
		for (const start of rootless)
			expect(observation.beginScope(null, start).context).toBeNull();
		const execution = observation.beginExecution(EXECUTION_START);
		if (execution === null) throw new Error("expected Execution");
		const uuid = "12345678-9abc-4def-8123-456789abcdef";
		const nested = [
			{
				entry: "direct",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "tickets.detail",
				trace: { kind: "active-parent" },
			},
			{
				entry: "direct",
				kind: "mutation",
				principalKind: "user",
				resourceIdentity: "tickets.close",
				trace: { kind: "active-parent" },
			},
			{
				entry: "direct",
				kind: "action",
				principalKind: "user",
				resourceIdentity: "notify.send",
				trace: { kind: "active-parent" },
			},
			{
				kind: "transaction",
				principalKind: "user",
				trace: { kind: "active-parent" },
				transactionId: "42",
			},
			{
				databaseOperation: "SELECT",
				kind: "postgresql",
				principalKind: "user",
				statementIdentity: "tickets.detail.byId",
				suppressPostgres: true,
				trace: { kind: "active-parent" },
			},
			{
				dispatchId: uuid,
				kind: "job.accept",
				principalKind: "user",
				resourceIdentity: "notify.ticket",
				runId: uuid,
				trace: { kind: "active-parent" },
			},
			{
				dispatchId: uuid,
				kind: "reaction.accept",
				principalKind: "user",
				resourceIdentity: "ticket.changed",
				runId: uuid,
				trace: { kind: "active-parent" },
			},
			{
				attemptId: uuid,
				attemptNumber: 1,
				dispatchId: uuid,
				kind: "job.attempt",
				principalKind: "service",
				queueDelayMilliseconds: 0,
				resourceIdentity: "notify.ticket",
				runId: uuid,
				trace: { kind: "root" },
			},
			{
				attemptId: uuid,
				attemptNumber: 1,
				dispatchId: uuid,
				kind: "reaction.attempt",
				principalKind: "service",
				resourceIdentity: "ticket.changed",
				runId: uuid,
				trace: { kind: "root" },
			},
			{
				effectId: uuid,
				kind: "action.effect",
				principalKind: "user",
				resourceIdentity: "notify.send",
				trace: { kind: "active-parent" },
			},
		] as const;
		for (const start of nested)
			expect(execution.observation.begin(start).context).toBeNull();
		expect(() => execution.observation.begin(rootless[0] as never)).toThrow(
			"invalid Execution identity owner",
		);
	});

	test("rejects foreign identities, extra keys, invalid events, and invalid outcomes", () => {
		const observation = kernel();
		const execution = observation.beginExecution(EXECUTION_START);
		if (execution === null) throw new Error("expected Execution");
		expect(() =>
			observation.beginScope(
				{ ...execution.identity },
				{
					entry: "direct",
					kind: "query",
					principalKind: "user",
					resourceIdentity: "tickets.detail",
					trace: { kind: "active-parent" },
				},
			),
		).toThrow("local Execution identity");
		expect(() =>
			observation.beginScope(execution.identity, {
				entry: "direct",
				extra: "caller",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "tickets.detail",
				trace: { kind: "active-parent" },
			} as unknown as ObservationStartV1),
		).toThrow("shape");
		const query = observation.beginScope(execution.identity, {
			entry: "direct",
			kind: "query",
			principalKind: "user",
			resourceIdentity: "tickets.detail",
			trace: { kind: "active-parent" },
		});
		expect(() => query.event({ kind: "receipt.replayed" })).toThrow(
			"invalid for its scope",
		);
		expect(() =>
			query.end({ kind: "query", outcome: "ambiguous" } as never),
		).toThrow("invalid for its scope");
		query.end({ kind: "query", outcome: "ok" });
		query.end({ kind: "query", outcome: "framework_error" });
		execution.scope.end({ kind: "execution", outcome: "ok" });
		expect(
			observation.beginScope(execution.identity, {
				entry: "direct",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "tickets.detail",
				trace: { kind: "active-parent" },
			}).context,
		).toBeNull();
	});

	test("accepts only exact ingress trace plans and defensively copies their bytes", () => {
		const diagnostics: string[] = [];
		const invalid = { ...TRACE, traceId: new Uint8Array(16) };
		const observation = kernel(
			{
				...adapterWith(async (use) => await use()),
				extract: () => ({
					extracted: { context: invalid, tracestate: null },
					kind: "remote-parent",
				}),
			},
			diagnostics,
		);
		expect(
			observation.extract({ traceparent: null, tracestate: null }),
		).toBeNull();
		expect(diagnostics).toEqual(["adapter_context_invalid"]);
		for (const tracestate of ["vendor=bad\nvalue", "x".repeat(513)]) {
			const invalidTracestate = kernel({
				...adapterWith(async (use) => await use()),
				extract: () => ({
					extracted: { context: TRACE, tracestate },
					kind: "remote-parent",
				}),
			});
			expect(
				invalidTracestate.extract({ traceparent: null, tracestate: null }),
			).toBeNull();
		}

		const source = Uint8Array.from(TRACE.traceId);
		const valid = kernel({
			...adapterWith(async (use) => await use()),
			extract: () => ({
				extracted: {
					context: { ...TRACE, traceId: source },
					tracestate: "vendor=value",
				},
				kind: "remote-parent",
			}),
		});
		const extracted = valid.extract({
			traceparent: "ignored-by-kernel",
			tracestate: null,
		});
		expect(extracted?.kind).toBe("remote-parent");
		if (extracted?.kind !== "remote-parent")
			throw new Error("expected remote-parent plan");
		expect(extracted.extracted.context.traceId).toEqual(TRACE.traceId);
		source[0] = 99;
		expect(extracted.extracted.context.traceId[0]).toBe(1);
		expect(Object.isFrozen(extracted)).toBe(true);
		expect(Object.isFrozen(extracted.extracted)).toBe(true);

		const linkSource = Uint8Array.from(TRACE.spanId);
		const restarted = kernel({
			...adapterWith(async (use) => await use()),
			extract: () => ({
				kind: "root-with-links",
				links: [{ ...TRACE, spanId: linkSource }],
			}),
		}).extract({ traceparent: null, tracestate: null });
		expect(restarted?.kind).toBe("root-with-links");
		if (restarted?.kind !== "root-with-links")
			throw new Error("expected restart plan");
		linkSource[0] = 99;
		expect(restarted.links[0]?.spanId[0]).toBe(1);
		expect(Object.isFrozen(restarted.links)).toBe(true);
	});

	test("rejects malformed, open, and forbidden ingress trace plans", () => {
		const malformed = [
			{ kind: "active-parent" },
			{ kind: "root" },
			{ kind: "root-with-links", links: [] },
			{ kind: "root-with-links", links: [TRACE, TRACE] },
			{ kind: "root-with-links", links: [TRACE], tracestate: "forbidden" },
			{ extracted: { context: TRACE }, kind: "remote-parent" },
			{
				extracted: { context: TRACE, extra: true, tracestate: null },
				kind: "remote-parent",
			},
			{
				extracted: { context: TRACE, tracestate: null },
				extra: true,
				kind: "remote-parent",
			},
			{
				extracted: {
					context: { ...TRACE, flags: 256 },
					tracestate: null,
				},
				kind: "remote-parent",
			},
		] as const;
		for (const plan of malformed) {
			const diagnostics: string[] = [];
			const observation = kernel(
				{
					...adapterWith(async (use) => await use()),
					extract: () => plan as never,
				},
				diagnostics,
			);
			expect(
				observation.extract({ traceparent: null, tracestate: null }),
			).toBeNull();
			expect(diagnostics).toEqual(["adapter_context_invalid"]);
		}
	});

	test("admits exact response-present boundaries and response-absent terminals", () => {
		const fetchStart = {
			kind: "fetch",
			method: "GET",
			principalKind: null,
			requestKind: "generated_operation",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		} as const;
		for (const status of [100, 599]) {
			kernel().beginScope(null, fetchStart).end({
				httpResponseStatusCode: status,
				kind: "fetch",
				outcome: "ok",
			});
		}
		for (const outcome of [
			"framework_error",
			"cancelled",
			"deadline",
		] as const) {
			kernel()
				.beginScope(null, fetchStart)
				.end({ httpResponseStatusCode: null, kind: "fetch", outcome });
		}
		for (const end of [
			{ httpResponseStatusCode: 99, kind: "fetch", outcome: "ok" },
			{ httpResponseStatusCode: 600, kind: "fetch", outcome: "ok" },
			{ httpResponseStatusCode: null, kind: "fetch", outcome: "ok" },
			{
				httpResponseStatusCode: null,
				kind: "fetch",
				outcome: "declared_error",
			},
		] as const) {
			expect(() =>
				kernel()
					.beginScope(null, fetchStart)
					.end(end as never),
			).toThrow();
		}
	});

	test("contains adapter pre-entry faults and runs application work exactly once with null context", async () => {
		const diagnostics: string[] = [];
		const observation = kernel(
			adapterWith(async () => {
				throw new Error("adapter failed");
			}),
			diagnostics,
		);
		const execution = observation.beginExecution(EXECUTION_START);
		if (execution === null) throw new Error("expected Execution");
		let calls = 0;
		const result = await execution.scope.run(async () => {
			calls += 1;
			expect(observation.current()?.context).toBeNull();
			return "authoritative";
		});
		expect(result).toBe("authoritative");
		expect(calls).toBe(1);
		expect(diagnostics).toEqual(["adapter_pre_entry_fault"]);
	});

	test("preserves the first result when an adapter re-enters or throws after entry", async () => {
		for (const mode of ["reenter", "throw"] as const) {
			const diagnostics: string[] = [];
			const observation = kernel(
				adapterWith(async (use) => {
					const result = await use();
					if (mode === "reenter") {
						try {
							await use();
						} catch {
							/* contained */
						}
					} else throw new Error("post-entry failure");
					return result;
				}),
				diagnostics,
			);
			const execution = observation.beginExecution(EXECUTION_START);
			if (execution === null) throw new Error("expected Execution");
			let calls = 0;
			expect(await execution.scope.run(() => ++calls)).toBe(1);
			expect(calls).toBe(1);
			expect(diagnostics).toContain(
				mode === "reenter" ? "adapter_reentry" : "adapter_post_entry_fault",
			);
		}
	});

	test("bounds counters and Envelope materialization without changing work", async () => {
		const diagnostics: string[] = [];
		let delivered = 0;
		const observation = createObservationKernel({
			applicationIdentity: "supportDesk",
			createRuntimeInstanceId: () => INSTANCE,
			events: () => {
				delivered += 1;
			},
			maximumEnvelopeEventsPerExecution: 1,
			maximumSequence: 3n,
			onDiagnostic: (code) => diagnostics.push(code),
			runtimeBuildDigest: "a".repeat(64),
		});
		const first = observation.beginExecution(EXECUTION_START);
		if (first === null) throw new Error("expected first Execution");
		expect(await first.scope.run(() => "work")).toBe("work");
		first.scope.event({ kind: "context.completed" });
		first.scope.end({ kind: "execution", outcome: "ok" });
		expect(delivered).toBe(1);
		expect(
			diagnostics.filter((code) => code === "envelope_limit"),
		).toHaveLength(2);

		const second = observation.beginExecution(EXECUTION_START);
		expect(second).not.toBeNull();
		expect(observation.disabled).toBe(true);
		expect(observation.beginExecution(EXECUTION_START)).toBeNull();
		expect(
			diagnostics.filter((code) => code === "counter_exhausted"),
		).toHaveLength(1);
	});

	test("contains hostile adapter getters and permanently disables a failed Envelope callback", () => {
		const diagnostics: string[] = [];
		let callbacks = 0;
		const hostile: ObservationAdapterV1 = {
			begin: () => ({
				get context(): NeutralTraceContextV1 | null {
					throw new Error("getter");
				},
				end: () => undefined,
				event: () => undefined,
				run: async (use) => await use(),
			}),
			extract: () => null,
			format: "questpie.runtime-observability",
			version: 1,
		};
		const observation = createObservationKernel({
			adapter: hostile,
			applicationIdentity: "supportDesk",
			createRuntimeInstanceId: () => INSTANCE,
			events: () => {
				callbacks += 1;
				throw new Error("sink");
			},
			onDiagnostic: (code) => diagnostics.push(code),
			runtimeBuildDigest: "a".repeat(64),
		});
		const execution = observation.beginExecution(EXECUTION_START);
		if (execution === null) throw new Error("expected Execution");
		execution.scope.event({ kind: "context.completed" });
		execution.scope.end({ kind: "execution", outcome: "ok" });
		expect(callbacks).toBe(1);
		expect(diagnostics).toEqual([
			"adapter_context_invalid",
			"event_callback_fault",
		]);
	});

	test("ends a streamed HTTP scope once across EOF, source error, consumer cancel, and host abort", async () => {
		const run = async (mode: "eof" | "error" | "cancel" | "abort") => {
			const ends: ObservationEndV1[] = [];
			const scope = {
				context: null,
				end: (end: ObservationEndV1) => ends.push(end),
				event: () => undefined,
				run: async <Result>(use: () => Result | Promise<Result>) => await use(),
			};
			let source!: ReadableStreamDefaultController<Uint8Array>;
			const body = new ReadableStream<Uint8Array>({
				start: (controller) => {
					source = controller;
				},
			});
			const abort = new AbortController();
			const response = retainScopeThroughResponse(
				scope,
				new Response(body, { status: 206 }),
				"fetch",
				abort.signal,
			);
			const reader = response.body?.getReader();
			if (reader === undefined || source === undefined)
				throw new Error("expected body");
			if (mode === "eof") {
				source.close();
				await reader.read();
			}
			if (mode === "error") {
				source.error(new Error("source"));
				await expect(reader.read()).rejects.toThrow("source");
			}
			if (mode === "cancel") await reader.cancel("consumer");
			if (mode === "abort") {
				abort.abort(
					new DOMException("The connection was closed.", "AbortError"),
				);
				await expect(reader.read()).resolves.toEqual({
					done: true,
					value: undefined,
				});
			}
			try {
				source.close();
			} catch {
				/* source may already be terminal */
			}
			abort.abort("late");
			await Promise.resolve();
			return ends;
		};
		expect(await run("eof")).toEqual([
			{ httpResponseStatusCode: 206, kind: "fetch", outcome: "ok" },
		]);
		expect(await run("error")).toEqual([
			{
				httpResponseStatusCode: 206,
				kind: "fetch",
				outcome: "framework_error",
			},
		]);
		expect(await run("cancel")).toEqual([
			{ httpResponseStatusCode: 206, kind: "fetch", outcome: "cancelled" },
		]);
		expect(await run("abort")).toEqual([
			{ httpResponseStatusCode: 206, kind: "fetch", outcome: "cancelled" },
		]);
	});
});
