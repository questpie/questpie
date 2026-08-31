import { describe, expect, test } from "bun:test";

import {
	createObservationKernel,
	retainScopeThroughResponse,
	type NeutralTraceContextV1,
	type ObservationAdapterV1,
	type ObservationKernel,
	type ObservationKernelOptions,
	type ObservationScopeAdapterV1,
	type ObservationStartV1,
} from "./kernel";

const runtimeInstanceId = "123e4567-e89b-42d3-a456-426614174000";
const occurredAt = "2026-08-30T12:34:56.789Z";
const traceContext: NeutralTraceContextV1 = {
	format: "questpie.trace-context",
	version: 1,
	traceId: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
	spanId: Uint8Array.from({ length: 8 }, (_, index) => index + 17),
	flags: 1,
};

type AdapterRun = ObservationScopeAdapterV1["run"];
function makeAdapter(
	override: Readonly<{
		context?: NeutralTraceContextV1 | null;
		run?: AdapterRun;
		event?: ObservationScopeAdapterV1["event"];
		end?: ObservationScopeAdapterV1["end"];
	}> = {},
) {
	const beginInputs: unknown[] = [];
	const events: unknown[] = [];
	const ends: unknown[] = [];
	const adapter: ObservationAdapterV1 = {
		format: "questpie.runtime-observability",
		version: 1,
		extract: () => ({ context: traceContext, tracestate: "vendor=value" }),
		begin(input) {
			beginInputs.push(input);
			return {
				context:
					override.context === undefined ? traceContext : override.context,
				run: override.run ?? (async (use) => await use()),
				event: override.event ?? ((input) => events.push(input)),
				end: override.end ?? ((input) => ends.push(input)),
			};
		},
	};
	return { adapter, beginInputs, events, ends };
}

function createKernel(options: Partial<ObservationKernelOptions> = {}) {
	return createObservationKernel({
		applicationIdentity: "application:support-desk",
		runtimeBuildDigest: "b".repeat(64),
		createRuntimeInstanceId: () => runtimeInstanceId,
		wallClock: () => new Date(occurredAt),
		...options,
	});
}

function execution(kernel: ObservationKernel) {
	const value = kernel.beginExecution({
		entry: "direct",
		kind: "execution",
		principalKind: "user",
		trace: { kind: "root" },
	});
	if (value === null) throw new Error("expected an observation Execution");
	return value;
}

describe("private observation kernel", () => {
	test("carries one closed start shape for every projected span and exact event payloads", () => {
		const fixture = makeAdapter();
		const kernel = createKernel({ adapter: fixture.adapter });
		const root = execution(kernel);
		const starts = [
			{
				kind: "runtime",
				principalKind: "service",
				trace: { kind: "root" },
			},
			{
				kind: "fetch",
				method: "POST",
				principalKind: null,
				requestKind: "generated_operation",
				scheme: "https",
				suppressHttp: true,
				trace: {
					kind: "remote-parent",
					extracted: { context: traceContext, tracestate: "vendor=value" },
				},
			},
			{
				kind: "fetch",
				method: "_OTHER",
				principalKind: null,
				requestKind: "unmatched",
				scheme: "http",
				suppressHttp: true,
				trace: { kind: "root" },
			},
			{
				kind: "route",
				method: "GET",
				principalKind: null,
				routeTemplate: "/tickets/:ticketId",
				scheme: "https",
				suppressHttp: true,
				trace: { kind: "root-with-links", links: [traceContext] },
			},
			...(["query", "mutation", "action"] as const).map((kind) => ({
				entry: "fetch" as const,
				kind,
				principalKind: "user" as const,
				resourceIdentity: `${kind}:tickets.example`,
				trace: { kind: "active-parent" as const },
			})),
			{
				kind: "transaction",
				principalKind: "user",
				trace: { kind: "active-parent" },
				transactionId: "42",
			},
			{
				databaseOperation: "SELECT",
				kind: "postgresql",
				principalKind: "service",
				statementIdentity: "ticket.detail",
				suppressPostgres: true,
				trace: { kind: "active-parent" },
			},
			...(["job.accept", "reaction.accept"] as const).map((kind) => ({
				dispatchId: runtimeInstanceId,
				kind,
				principalKind: "service" as const,
				resourceIdentity: `${kind}:tickets.example`,
				runId: runtimeInstanceId,
				trace: { kind: "active-parent" as const },
			})),
			...(["job.attempt", "reaction.attempt"] as const).map((kind) => ({
				attemptId: runtimeInstanceId,
				attemptNumber: 2,
				dispatchId: runtimeInstanceId,
				kind,
				principalKind: "service" as const,
				resourceIdentity: `${kind}:tickets.example`,
				runId: runtimeInstanceId,
				trace: { kind: "root-with-links" as const, links: [traceContext] },
			})),
			{
				effectId: runtimeInstanceId,
				kind: "action.effect",
				principalKind: "service",
				resourceIdentity: "action:notifications.send",
				trace: { kind: "active-parent" },
			},
		] satisfies readonly ObservationStartV1[];

		for (const start of starts)
			kernel.beginScope(
				start.kind === "runtime" ||
					start.kind === "fetch" ||
					start.kind === "route"
					? null
					: root.identity,
				start,
			);
		expect(fixture.beginInputs).toHaveLength(15);
		expect(fixture.beginInputs).toContainEqual(
			expect.objectContaining({
				databaseOperation: "SELECT",
				statementIdentity: "ticket.detail",
			}),
		);
		const attempt = kernel.beginScope(root.identity, {
			attemptNumber: 2,
			kind: "job.attempt",
			principalKind: "service",
			resourceIdentity: "job:tickets.example",
			trace: { kind: "root-with-links", links: [traceContext] },
		});
		attempt.event({
			attemptNumber: 2,
			kind: "durable.retry_scheduled",
			retryDelayMilliseconds: 1_500,
		});
		expect(fixture.events).toContainEqual({
			attemptNumber: 2,
			kind: "durable.retry_scheduled",
			retryDelayMilliseconds: 1_500,
		});
	});

	test("preserves validated tracestate from extraction to the remote-parent plan", () => {
		const fixture = makeAdapter();
		const kernel = createKernel({ adapter: fixture.adapter });
		const extracted = kernel.extract({
			traceparent: "00-0102030405060708090a0b0c0d0e0f10-1112131415161718-01",
			tracestate: "vendor=value",
		});
		expect(extracted).toEqual({
			context: traceContext,
			tracestate: "vendor=value",
		});
		const root = execution(kernel);
		kernel.beginScope(null, {
			kind: "fetch",
			method: "POST",
			principalKind: null,
			requestKind: "generated_operation",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "remote-parent", extracted: extracted! },
		});
		expect(fixture.beginInputs.at(-1)).toMatchObject({
			trace: {
				extracted: { tracestate: "vendor=value" },
				kind: "remote-parent",
			},
		});
	});

	test("co-emits canonical Envelope v2 and reuses one root Execution identity", () => {
		const lines: string[] = [];
		const fixture = makeAdapter();
		const kernel = createKernel({
			adapter: fixture.adapter,
			emitCanonicalLine: (line) => lines.push(line),
		});
		const root = execution(kernel);
		const nested = kernel.beginScope(root.identity, {
			entry: "fetch",
			kind: "mutation",
			principalKind: "user",
			resourceIdentity: "mutation:tickets.assign",
			trace: { kind: "active-parent" },
		});
		nested.event({ kind: "receipt.replayed" });
		nested.end({ kind: "mutation", outcome: "ok" });
		root.scope.end({ kind: "execution", outcome: "ok" });
		const lifecycle = kernel.beginScope(null, {
			kind: "runtime",
			principalKind: "service",
			trace: { kind: "root" },
		});
		lifecycle.end({ kind: "runtime", outcome: "ok" });

		expect(lines).toHaveLength(7);
		for (const line of lines) {
			expect(line.endsWith("\n")).toBe(true);
			expect(line).not.toMatch(
				/callId|correlationId|tenant|policy|sqlText|errorMessage|secret-value/u,
			);
		}
		const decoded = lines.map((line) => JSON.parse(line));
		expect(decoded.slice(0, 5).map((event) => event.executionId)).toEqual(
			Array.from({ length: 5 }, () => root.identity.executionId),
		);
		expect(decoded.slice(0, 5).map((event) => event.executionSequence)).toEqual(
			Array.from({ length: 5 }, () => "1"),
		);
		expect(decoded[5]).toMatchObject({
			executionId: null,
			executionSequence: null,
			scopeKind: "runtime",
		});
		expect(Object.keys(decoded[0])).toEqual(Object.keys(decoded[0]).sort());
		expect(lines.join("")).not.toContain('"version":1');
	});

	test("keeps one breaking v2 callback and disables only a throwing consumer", () => {
		let callbackCalls = 0;
		const lines: string[] = [];
		const diagnostics: string[] = [];
		const kernel = createKernel({
			events: (event) => {
				callbackCalls += 1;
				expect(event.version).toBe(2);
				throw new Error("host callback fault");
			},
			emitCanonicalLine: (line) => lines.push(line),
			onDiagnostic: (code) => diagnostics.push(code),
		});
		const root = execution(kernel);
		root.scope.event({ kind: "context.completed" });
		root.scope.end({ kind: "execution", outcome: "ok" });
		expect(callbackCalls).toBe(1);
		expect(lines).toHaveLength(3);
		expect(diagnostics).toContain("event_callback_fault");
	});

	test("the built-in no-op owns no context, persistence, or close work", async () => {
		const kernel = createKernel();
		const root = execution(kernel);
		expect(kernel.hasAdapter).toBe(false);
		expect(kernel.hasCloseWork).toBe(false);
		expect(root.scope.context).toBeNull();
		expect(kernel.durableTraceContext(root.scope)).toBeNull();
		expect(await root.scope.run(async () => "result")).toBe("result");
	});

	test("bypasses failed observation entry once under a neutral scope", async () => {
		let calls = 0;
		const diagnostics: string[] = [];
		const fixture = makeAdapter({
			run: async <Result>(): Promise<Result> => {
				throw new Error("adapter failed before entry");
			},
		});
		const kernel = createKernel({
			adapter: fixture.adapter,
			onDiagnostic: (code) => diagnostics.push(code),
		});
		const fetch = kernel.beginScope(null, {
			kind: "fetch",
			method: "GET",
			principalKind: null,
			requestKind: "unmatched",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		});
		const result = await fetch.run(async () => {
			calls += 1;
			expect(kernel.current()).toEqual({
				context: null,
				suppressHttp: true,
				suppressPostgres: false,
			});
			return 42;
		});
		expect(result).toBe(42);
		expect(calls).toBe(1);
		expect(diagnostics).toContain("adapter_pre_entry_fault");
	});

	test("refuses late nested materialization after the root Execution ends", () => {
		const lines: string[] = [];
		const fixture = makeAdapter();
		const kernel = createKernel({
			adapter: fixture.adapter,
			emitCanonicalLine: (line) => lines.push(line),
		});
		const root = execution(kernel);
		root.scope.end({ kind: "execution", outcome: "ok" });
		const adapterBegins = fixture.beginInputs.length;
		const emitted = lines.length;
		const late = kernel.beginScope(root.identity, {
			entry: "fetch",
			kind: "query",
			principalKind: "user",
			resourceIdentity: "query:tickets.late",
			trace: { kind: "active-parent" },
		});
		late.event({ kind: "context.completed" });
		late.end({ kind: "query", outcome: "ok" });
		expect(fixture.beginInputs).toHaveLength(adapterBegins);
		expect(lines).toHaveLength(emitted);
	});

	test("does not recreate Envelope counters from a pre-existing nested scope", () => {
		const lines: string[] = [];
		const fixture = makeAdapter();
		const kernel = createKernel({
			adapter: fixture.adapter,
			emitCanonicalLine: (line) => lines.push(line),
		});
		const root = execution(kernel);
		const nested = kernel.beginScope(root.identity, {
			entry: "fetch",
			kind: "mutation",
			principalKind: "user",
			resourceIdentity: "mutation:tickets.pending",
			trace: { kind: "active-parent" },
		});
		root.scope.end({ kind: "execution", outcome: "ok" });
		const emitted = lines.length;
		nested.event({ kind: "receipt.replayed" });
		nested.end({ kind: "mutation", outcome: "ok" });
		expect(lines).toHaveLength(emitted);
		expect(fixture.events).toContainEqual({ kind: "receipt.replayed" });
		expect(fixture.ends).toContainEqual({ kind: "mutation", outcome: "ok" });
	});

	test("contains adapter re-entry and post-entry faults without replacing the result", async () => {
		const diagnostics: string[] = [];
		const fixture = makeAdapter({
			run: async <Result>(use: () => Result | Promise<Result>) => {
				const first = await use();
				await use();
				return first;
			},
		});
		const root = execution(
			createKernel({
				adapter: fixture.adapter,
				onDiagnostic: (code) => diagnostics.push(code),
			}),
		);
		let calls = 0;
		expect(
			await root.scope.run(async () => {
				calls += 1;
				return "authoritative result";
			}),
		).toBe("authoritative result");
		expect(calls).toBe(1);
		expect(diagnostics).toContain("adapter_reentry");
		expect(diagnostics).toContain("adapter_post_entry_fault");
	});

	test("closes callback entry before a delayed adapter use can run", async () => {
		let delayedUse: (() => unknown) | null = null;
		const diagnostics: string[] = [];
		const fixture = makeAdapter({
			run: async <Result>(use: () => Result | Promise<Result>) => {
				delayedUse = use;
				return undefined as Result;
			},
		});
		const root = execution(
			createKernel({
				adapter: fixture.adapter,
				onDiagnostic: (code) => diagnostics.push(code),
			}),
		);
		let calls = 0;
		expect(
			await root.scope.run(async () => {
				calls += 1;
				return "fallback result";
			}),
		).toBe("fallback result");
		expect(calls).toBe(1);
		expect(() => delayedUse!()).toThrow("entry closed");
		expect(calls).toBe(1);
		expect(diagnostics).toContain("adapter_reentry");
	});

	test("contains a throwing adapter context getter", () => {
		const diagnostics: string[] = [];
		const adapter: ObservationAdapterV1 = {
			format: "questpie.runtime-observability",
			version: 1,
			extract: () => null,
			begin: () =>
				Object.defineProperty(
					{
						run: async <Result>(use: () => Result | Promise<Result>) =>
							await use(),
						event: () => undefined,
						end: () => undefined,
					},
					"context",
					{
						get: () => {
							throw new Error("hostile getter");
						},
					},
				) as unknown as ObservationScopeAdapterV1,
		};
		const root = execution(
			createKernel({
				adapter,
				onDiagnostic: (code) => diagnostics.push(code),
			}),
		);
		expect(root.scope.context).toBeNull();
		expect(diagnostics).toContain("adapter_context_invalid");
	});

	test("preserves the original application failure", async () => {
		const failure = new Error("application failure");
		const diagnostics: string[] = [];
		const fixture = makeAdapter({
			run: async <Result>(use: () => Result | Promise<Result>) => {
				try {
					return await use();
				} catch {
					throw new Error("adapter replacement");
				}
			},
		});
		const root = execution(
			createKernel({
				adapter: fixture.adapter,
				onDiagnostic: (code) => diagnostics.push(code),
			}),
		);
		await expect(
			root.scope.run(async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
		expect(diagnostics).not.toContain("adapter_post_entry_fault");
	});

	test("keeps async context and suppression isolated per kernel and sibling", async () => {
		const first = createKernel({ adapter: makeAdapter().adapter });
		const second = createKernel({
			adapter: makeAdapter({ context: null }).adapter,
			createRuntimeInstanceId: () => "223e4567-e89b-42d3-a456-426614174000",
		});
		const firstRoot = execution(first);
		const postgres = first.beginScope(firstRoot.identity, {
			databaseOperation: "SELECT",
			kind: "postgresql",
			principalKind: "service",
			statementIdentity: "ticket.list",
			suppressPostgres: true,
			trace: { kind: "active-parent" },
		});
		const fetch = second.beginScope(null, {
			kind: "fetch",
			method: "POST",
			principalKind: null,
			requestKind: "generated_operation",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		});
		const [postgresState, fetchState] = await Promise.all([
			postgres.run(async () => {
				await Bun.sleep(2);
				expect(second.current()).toBeNull();
				return first.current();
			}),
			fetch.run(async () => {
				await Bun.sleep(1);
				expect(first.current()).toBeNull();
				return second.current();
			}),
		]);
		expect(postgresState).toMatchObject({ suppressPostgres: true });
		expect(fetchState).toEqual({
			context: null,
			suppressHttp: true,
			suppressPostgres: false,
		});
	});

	test("retains a Fetch scope through response-body EOF", async () => {
		const fixture = makeAdapter();
		const kernel = createKernel({ adapter: fixture.adapter });
		const fetch = kernel.beginScope(null, {
			kind: "fetch",
			method: "POST",
			principalKind: null,
			requestKind: "generated_operation",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		});
		const source = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("first"));
				queueMicrotask(() => controller.close());
			},
		});
		const response = retainScopeThroughResponse(
			fetch,
			new Response(source, { status: 201 }),
		);
		expect(fixture.ends).toHaveLength(0);
		const reader = response.body!.getReader();
		expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
		expect(fixture.ends).toHaveLength(0);
		expect((await reader.read()).done).toBe(true);
		expect(fixture.ends).toEqual([
			{ httpResponseStatusCode: 201, kind: "fetch", outcome: "ok" },
		]);
	});

	test("ends Fetch immediately on host abort without awaiting source cancellation", async () => {
		const fixture = makeAdapter();
		const kernel = createKernel({ adapter: fixture.adapter });
		const fetch = kernel.beginScope(null, {
			kind: "fetch",
			method: "GET",
			principalKind: null,
			requestKind: "unmatched",
			scheme: "https",
			suppressHttp: true,
			trace: { kind: "root" },
		});
		const source = new ReadableStream<Uint8Array>({
			pull: () => new Promise(() => undefined),
			cancel: () => new Promise(() => undefined),
		});
		const abort = new AbortController();
		retainScopeThroughResponse(
			fetch,
			new Response(source, { status: 200 }),
			"fetch",
			abort.signal,
		);
		abort.abort(new Error("host stopped"));
		await Bun.sleep(0);
		expect(fixture.ends).toEqual([
			{ httpResponseStatusCode: 200, kind: "fetch", outcome: "cancelled" },
		]);
	});

	test("isolates adapter event and end faults", () => {
		const diagnostics: string[] = [];
		const fixture = makeAdapter({
			event: () => {
				throw new Error("event fault");
			},
			end: () => {
				throw new Error("end fault");
			},
		});
		const root = execution(
			createKernel({
				adapter: fixture.adapter,
				onDiagnostic: (code) => diagnostics.push(code),
			}),
		);
		expect(() => root.scope.event({ kind: "context.completed" })).not.toThrow();
		expect(() =>
			root.scope.end({ kind: "execution", outcome: "ok" }),
		).not.toThrow();
		expect(diagnostics).toContain("adapter_event_fault");
	});

	test("keeps a committed transaction ok when its Mutation becomes ambiguous", () => {
		const fixture = makeAdapter();
		const kernel = createKernel({ adapter: fixture.adapter });
		const root = execution(kernel);
		const mutation = kernel.beginScope(root.identity, {
			entry: "fetch",
			kind: "mutation",
			principalKind: "user",
			resourceIdentity: "mutation:tickets.close",
			trace: { kind: "active-parent" },
		});
		const transaction = kernel.beginScope(root.identity, {
			kind: "transaction",
			principalKind: "user",
			trace: { kind: "active-parent" },
			transactionId: "42",
		});
		transaction.event({ kind: "transaction.committed", transactionId: "42" });
		transaction.end({ kind: "transaction", outcome: "ok" });
		mutation.event({
			kind: "operation.post_commit_ambiguous",
			transactionId: "42",
		});
		expect(() =>
			mutation.event({
				attemptNumber: 2,
				kind: "durable.retry_scheduled",
				retryDelayMilliseconds: 100,
			}),
		).toThrow("invalid for its scope");
		mutation.end({ kind: "mutation", outcome: "ambiguous" });
		expect(fixture.ends.slice(-2)).toEqual([
			{ kind: "transaction", outcome: "ok" },
			{ kind: "mutation", outcome: "ambiguous" },
		]);
	});

	test("Envelope limits drop only the callback projection while adapter signals continue", () => {
		const lines: string[] = [];
		const diagnostics: string[] = [];
		const fixture = makeAdapter();
		const kernel = createKernel({
			adapter: fixture.adapter,
			emitCanonicalLine: (line) => lines.push(line),
			onDiagnostic: (code) => diagnostics.push(code),
			maximumEnvelopeEventsPerExecution: 2,
		});
		const root = execution(kernel);
		const nested = kernel.beginScope(root.identity, {
			entry: "fetch",
			kind: "mutation",
			principalKind: "user",
			resourceIdentity: "mutation:tickets.assign",
			trace: { kind: "active-parent" },
		});
		nested.event({ kind: "receipt.replayed" });
		nested.end({ kind: "mutation", outcome: "ok" });
		root.scope.end({ kind: "execution", outcome: "ok" });
		expect(lines).toHaveLength(2);
		expect(fixture.events).toEqual([{ kind: "receipt.replayed" }]);
		expect(fixture.ends).toEqual([
			{ kind: "mutation", outcome: "ok" },
			{ kind: "execution", outcome: "ok" },
		]);
		expect(diagnostics).toContain("envelope_limit");
	});

	test("counter exhaustion refuses new materialization but ends an existing adapter scope", () => {
		const fixture = makeAdapter();
		const diagnostics: string[] = [];
		const kernel = createKernel({
			adapter: fixture.adapter,
			maximumSequence: 2n,
			onDiagnostic: (code) => diagnostics.push(code),
		});
		const root = execution(kernel);
		root.scope.event({ kind: "context.completed" });
		root.scope.event({ kind: "execution.cancelled" });
		root.scope.end({ kind: "execution", outcome: "ok" });
		expect(kernel.disabled).toBe(true);
		expect(
			kernel.beginExecution({
				entry: "direct",
				kind: "execution",
				principalKind: "user",
				trace: { kind: "root" },
			}),
		).toBeNull();
		expect(fixture.ends).toEqual([{ kind: "execution", outcome: "ok" }]);
		expect(diagnostics).toContain("counter_exhausted");
	});

	test("rejects incompatible adapters, invalid contexts, and foreign Execution identities", () => {
		expect(() =>
			createKernel({
				adapter: {
					format: "bad",
					version: 1,
				} as unknown as ObservationAdapterV1,
			}),
		).toThrow("incompatible");
		const diagnostics: string[] = [];
		const invalid = makeAdapter({
			context: { ...traceContext, traceId: new Uint8Array(16) },
		});
		const kernel = createKernel({
			adapter: invalid.adapter,
			onDiagnostic: (code) => diagnostics.push(code),
		});
		const root = execution(kernel);
		expect(root.scope.context).toBeNull();
		expect(diagnostics).toContain("adapter_context_invalid");
		expect(() =>
			kernel.beginScope(
				{ executionId: "foreign:execution:1", executionSequence: "1" },
				{
					entry: "direct",
					kind: "query",
					principalKind: "user",
					resourceIdentity: "query:tickets.detail",
					trace: { kind: "active-parent" },
				},
			),
		).toThrow("local Execution identity");
		root.scope.end({ kind: "execution", outcome: "ok" });
		expect(() =>
			kernel.beginScope(
				{ ...root.identity },
				{
					entry: "direct",
					kind: "query",
					principalKind: "user",
					resourceIdentity: "query:tickets.forged",
					trace: { kind: "active-parent" },
				},
			),
		).toThrow("local Execution identity");
		expect(() =>
			kernel.beginExecution({
				entry: "direct",
				kind: "query",
				principalKind: "user",
				resourceIdentity: "query:tickets.root",
				trace: { kind: "active-parent" },
			} as unknown as Parameters<ObservationKernel["beginExecution"]>[0]),
		).toThrow("must be an Execution");
	});
});
