import { expect, test } from "bun:test";

import {
	ActionOutcomeAmbiguous,
	canonicalContextHeader,
	canonicalCallHeaders,
	canonicalOperationPath,
	canonicalPostBody,
	canonicalQueryString,
	createCandidateAdapter,
	decodeCanonicalQueryString,
	decodeCanonicalContextHeader,
	generatedCompatibilityHeaders,
	openApiSelected,
	projectCanonicalInventory,
	QUERY_RESPONSE_HEADERS,
} from "./candidate-adapter";

test("derives disjoint canonical paths from kind and Resource name", () => {
	expect(canonicalOperationPath("query", "tickets.detail")).toBe(
		"/_questpie/query/tickets.detail",
	);
	expect(canonicalOperationPath("mutation", "tickets.detail")).toBe(
		"/_questpie/mutation/tickets.detail",
	);
	expect(canonicalOperationPath("action", "tickets.detail")).toBe(
		"/_questpie/action/tickets.detail",
	);
	expect(() => canonicalOperationPath("query", "tickets/detail")).toThrow();
});

test("selector, grouping, collision, wildcard, and explain inventory share one owner", () => {
	expect(openApiSelected({ projections: { openapi: true } })).toBe(true);
	expect(openApiSelected({})).toBe(false);
	expect(() => openApiSelected({ projections: { openapi: false } })).toThrow();
	const inventory = projectCanonicalInventory("support", [
		{ kind: "query", name: "tickets.detail", origin: "query.ts" },
		{ kind: "mutation", name: "close", origin: "close.ts" },
	]);
	expect(
		inventory.included.map(({ method, operationId, path, tag }) => ({
			method,
			operationId,
			path,
			tag,
		})),
	).toEqual([
		{
			method: "POST",
			operationId: "close",
			path: "/_questpie/mutation/close",
			tag: "support",
		},
		{
			method: "GET",
			operationId: "tickets.detail",
			path: "/_questpie/query/tickets.detail",
			tag: "tickets",
		},
	]);
	expect(() =>
		projectCanonicalInventory("support", [
			{ kind: "query", name: "tickets.detail", origin: "q.ts" },
			{ kind: "mutation", name: "tickets.detail", origin: "m.ts" },
		]),
	).toThrow("openApiOperationIdCollision:m.ts:q.ts");
	const rawRoutes = [
		{
			identity: "route:external.callback",
			method: "POST",
			origin: "callback.ts",
			path: "/callbacks/:provider",
		},
	] as const;
	expect(projectCanonicalInventory("support", [], rawRoutes).omitted).toEqual([
		{
			identity: "route:external.callback",
			origin: "callback.ts",
			reason: "rawRouteUnsupported",
		},
	]);
	expect(() =>
		projectCanonicalInventory(
			"support",
			[{ kind: "query", name: "tickets.detail", origin: "query.ts" }],
			[
				{
					identity: "route:shadow.exact",
					method: "GET",
					origin: "exact.ts",
					path: "/_questpie/query/tickets.detail",
				},
			],
		),
	).toThrow("exactPathCollision:query.ts:exact.ts");
	expect(() =>
		projectCanonicalInventory(
			"support",
			[{ kind: "query", name: "tickets.detail", origin: "query.ts" }],
			[
				{
					identity: "route:shadow.parameter",
					method: "GET",
					origin: "parameter.ts",
					path: "/_questpie/query/:operation",
				},
			],
		),
	).toThrow("ambiguousParameterCollision:query.ts:parameter.ts");
	expect(() =>
		projectCanonicalInventory(
			"support",
			[{ kind: "query", name: "tickets.detail", origin: "query.ts" }],
			[
				{
					identity: "route:shadow.wildcard",
					method: "GET",
					origin: "wildcard.ts",
					path: "/_questpie/query/*rest",
				},
			],
		),
	).toThrow("rawWildcardIntersection:query.ts:wildcard.ts");
});

test("uses readable scalar and one structured encoding per codec-owned member", () => {
	const codec = {
		kind: "object",
		properties: {
			filter: {
				kind: "object",
				properties: {
					labels: {
						kind: "array",
						maximum: 3,
						items: { kind: "text", maxLength: 20 },
					},
				},
			},
			search: { kind: "text", maxLength: 100 },
		},
	} as const;
	expect(
		canonicalQueryString(codec, {
			search: "null value",
			filter: { labels: ["urgent", "customer"] },
		}),
	).toBe(
		"filter=~json%3A%7B%22labels%22%3A%5B%22urgent%22%2C%22customer%22%5D%7D&search=null%20value",
	);
	expect(() =>
		canonicalQueryString(
			{
				kind: "object",
				properties: { search: { kind: "text" } },
			},
			{ search: "unbounded" },
		),
	).toThrow("queryHttpEncodingUnsupported");
	expect(
		decodeCanonicalQueryString(
			codec,
			"filter=~json%3A%7B%22labels%22%3A%5B%22urgent%22%5D%7D&search=hello%20world",
		),
	).toEqual({ filter: { labels: ["urgent"] }, search: "hello world" });
	expect(() =>
		decodeCanonicalQueryString(codec, "search=one&search=two"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(codec, "search=hello+world"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(codec, "search=%7ejson%3A%7B%7D"),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(
			codec,
			"filter=~json%3A%7B%22labels%22%3A%5B%22x%22%5D%2C%22labels%22%3A%5B%5D%7D",
		),
	).toThrow();
	expect(() =>
		decodeCanonicalQueryString(
			codec,
			"search=hello&filter=~json%3A%7B%22labels%22%3A%5B%5D%7D",
		),
	).toThrow();
	expect(() => decodeCanonicalQueryString(codec, "search=hello")).toThrow();
});

test("preserves safe CallOptions and disables Query cache reuse", () => {
	expect(
		canonicalCallHeaders({ callId: "caller-1", timeoutMilliseconds: 5000 }),
	).toEqual({
		"Questpie-Call-Id": "caller-1",
		"Questpie-Timeout-Milliseconds": "5000",
	});
	expect(() => canonicalCallHeaders({ timeoutMilliseconds: 0 })).toThrow();
	expect(canonicalCallHeaders({ callId: "výzva,1" })).toEqual({
		"Questpie-Call-Id": "v%C3%BDzva%2C1",
	});
	expect(
		generatedCompatibilityHeaders({
			application: "application:support",
			clientContractDigest: "a".repeat(64),
			wireDigest: "b".repeat(64),
		}),
	).toEqual({
		"Questpie-Application": "application:support",
		"Questpie-Client-Contract": "a".repeat(64),
		"Questpie-Wire-Digest": "b".repeat(64),
	});
	expect(QUERY_RESPONSE_HEADERS).toEqual({
		"Cache-Control": "private, no-store",
	});
});

test("keeps typed Context disjoint from Query input and credential Principal", () => {
	const context = {
		membershipId: "018f3b7a-cd17-7b11-9f22-3f43af873efe",
		organizationId: "018f3b79-b78e-7f08-936d-81e995fd2251",
	};
	const contextCodec = {
		kind: "object",
		properties: {
			membershipId: { kind: "uuid" },
			organizationId: { kind: "uuid" },
		},
	} as const;
	const header = canonicalContextHeader(contextCodec, context);
	expect(header).not.toContain("=");
	expect(decodeCanonicalContextHeader(contextCodec, header)).toEqual(context);
	expect(
		canonicalQueryString(
			{
				kind: "object",
				properties: { search: { kind: "text", maxLength: 100 } },
			},
			{ search: "printer" },
		),
	).toBe("search=printer");
	expect(
		canonicalPostBody(
			{
				kind: "object",
				properties: { ticketId: { kind: "text", maxLength: 20 } },
			},
			contextCodec,
			{ ticketId: "ticket-1" },
			context,
		),
	).toBe(
		'{"context":{"membershipId":"018f3b7a-cd17-7b11-9f22-3f43af873efe","organizationId":"018f3b79-b78e-7f08-936d-81e995fd2251"},"input":{"ticketId":"ticket-1"}}',
	);
});

const application = "application:support";
const clientContractDigest = "a".repeat(64);
const wireDigest = "b".repeat(64);
const contextCodec = {
	kind: "object",
	properties: {
		membershipId: { kind: "uuid" },
		organizationId: { kind: "uuid" },
	},
} as const;
const contextA = {
	membershipId: "018f3b7a-cd17-7b11-9f22-3f43af873efe",
	organizationId: "018f3b79-b78e-7f08-936d-81e995fd2251",
};
const contextB = {
	membershipId: "018f3b7a-cd17-7b11-9f22-3f43af873eff",
	organizationId: "018f3b79-b78e-7f08-936d-81e995fd2252",
};
const allScalarsCodec = {
	kind: "object",
	properties: {
		big: { kind: "bigint" },
		count: { kind: "integer" },
		cursor: { kind: "cursor" },
		day: { kind: "date" },
		filter: {
			kind: "object",
			properties: {
				enabled: { kind: "boolean" },
				labels: {
					kind: "array",
					maximum: 2,
					items: { kind: "text", maxLength: 8 },
				},
			},
		},
		id: { kind: "uuid" },
		money: { kind: "numeric", precision: 8, scale: 2 },
		nullable: { kind: "nullable", codec: { kind: "text", maxLength: 8 } },
		optional: { kind: "optional", codec: { kind: "text", maxLength: 8 } },
		search: { kind: "text", maxLength: 20 },
		when: { kind: "timestamp", withTimezone: true },
	},
} as const;
const allScalarsInput = {
	big: "9223372036854775807",
	count: 9007199254740991,
	cursor: "opaque-cursor",
	day: "2026-09-01",
	filter: { enabled: true, labels: ["urgent", "vip"] },
	id: "018f3b79-b78e-7f08-936d-81e995fd2251",
	money: "123456.78",
	nullable: null,
	search: "~literal",
	when: new Date("2026-09-01T10:11:12.345Z"),
};

test("one composed generated client and adapter carry canonical Query input and Context", async () => {
	const executions: unknown[] = [];
	const requests: Request[] = [];
	let adapter: ReturnType<typeof createCandidateAdapter>;
	adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		wireDigest,
		definitions: [
			{
				context: contextCodec,
				execute: async (scope) => {
					executions.push(scope);
					return { kind: "result", value: scope.input };
				},
				input: allScalarsCodec,
				kind: "query",
				name: "codec.all",
				output: allScalarsCodec,
			},
		],
		resolvePrincipal: (request) =>
			request.headers.get("Authorization") ?? "anonymous",
		transport: async (request) => {
			requests.push(request.clone());
			return adapter.fetch(request);
		},
	});
	const frame = await adapter.client.withContext(contextA).queries[
		"codec.all"
	]!(allScalarsInput, {
		callId: "query-call",
		timeoutMilliseconds: 2500,
	});
	expect(frame).toMatchObject({
		callId: "query-call",
		result: allScalarsInput,
	});
	expect(executions).toEqual([
		expect.objectContaining({
			callId: "query-call",
			context: contextA,
			input: allScalarsInput,
			principal: "anonymous",
			timeoutMilliseconds: 2500,
		}),
	]);
	expect(requests).toHaveLength(1);
	const request = requests[0]!;
	expect(request.method).toBe("GET");
	expect(request.url).toStartWith(
		"https://candidate.test/_questpie/query/codec.all?",
	);
	expect(request.url).not.toContain("/_questpie/operation");
	expect(request.headers.get("Questpie-Context")).toBe(
		canonicalContextHeader(contextCodec, contextA),
	);
	expect(request.headers.get("Questpie-Call-Id")).toBe("query-call");
	expect(request.headers.get("Questpie-Timeout-Milliseconds")).toBe("2500");
	expect(request.headers.get("Questpie-Application")).toBe(application);
	expect(request.headers.get("Questpie-Client-Contract")).toBe(
		clientContractDigest,
	);
	expect(request.headers.get("Questpie-Wire-Digest")).toBe(wireDigest);
	expect(request.headers.get("Idempotency-Key")).toBeNull();
	expect(request.headers.get("Effect-Key")).toBeNull();
	const stale = await adapter.fetch(
		new Request(request.url, {
			headers: {
				"Questpie-Application": application,
				"Questpie-Context": canonicalContextHeader(contextCodec, contextA),
			},
		}),
	);
	expect(stale.status).toBe(400);
	expect(stale.headers.get("Cache-Control")).toBe("private, no-store");
	expect(executions).toHaveLength(1);
	const scalarQuery =
		adapter.client.withContext(contextA).queries["codec.all"]!;
	await expect(scalarQuery({ ...allScalarsInput, count: -0 })).rejects.toThrow(
		"must be a safe integer",
	);
	await expect(
		scalarQuery({ ...allScalarsInput, big: "9223372036854775808" }),
	).rejects.toThrow("must be within PostgreSQL bigint");
	await expect(
		scalarQuery({ ...allScalarsInput, money: "1234567.89" }),
	).rejects.toThrow("canonical numeric(8, 2)");
});

test("composed POST carriers preserve Mutation identity and Action ambiguity semantics", async () => {
	const requests: Request[] = [];
	let adapter: ReturnType<typeof createCandidateAdapter>;
	adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		wireDigest,
		definitions: [
			{
				context: contextCodec,
				execute: async () => ({ kind: "result", value: { changed: true } }),
				input: { kind: "object", properties: { id: { kind: "uuid" } } },
				kind: "mutation",
				name: "tickets.assign",
				output: {
					kind: "object",
					properties: { changed: { kind: "boolean" } },
				},
			},
			{
				context: contextCodec,
				execute: async () => ({ kind: "postHandlerResourceLimit" }),
				input: { kind: "object", properties: { id: { kind: "uuid" } } },
				kind: "action",
				name: "reports.export",
				output: { kind: "object", properties: {} },
			},
		],
		resolvePrincipal: () => "principal",
		transport: async (request) => {
			requests.push(request.clone());
			return adapter.fetch(request);
		},
	});
	const operationInput = { id: allScalarsInput.id };
	const generated = adapter.client.withContext(contextA);
	expect(
		await generated.mutations["tickets.assign"]!(operationInput, {
			callId: "mutation-call",
			timeoutMilliseconds: 5000,
		}),
	).toEqual({ callId: "mutation-call", result: { changed: true } });
	expect(
		await generated.actions["reports.export"]!(operationInput, {
			callId: "action-call",
			effectKey: "provider-export-1",
			timeoutMilliseconds: 7000,
		}),
	).toEqual({
		callId: "action-call",
		error: { code: "RESOURCE_LIMIT", retryable: false },
	});
	const mutation = requests[0]!;
	expect(mutation.method).toBe("POST");
	expect(mutation.url).toBe(
		"https://candidate.test/_questpie/mutation/tickets.assign",
	);
	expect(mutation.headers.get("Idempotency-Key")).toBe("mutation-call");
	expect(mutation.headers.get("Questpie-Call-Id")).toBeNull();
	expect(await mutation.json()).toEqual({
		context: contextA,
		input: operationInput,
	});
	const action = requests[1]!;
	expect(action.url).toBe(
		"https://candidate.test/_questpie/action/reports.export",
	);
	expect(action.headers.get("Questpie-Call-Id")).toBe("action-call");
	expect(action.headers.get("Effect-Key")).toBe("provider-export-1");
	expect(action.headers.get("Idempotency-Key")).toBeNull();
	const duplicateBody = await adapter.fetch(
		new Request("https://candidate.test/_questpie/mutation/tickets.assign", {
			body: `{"context":${JSON.stringify(contextA)},"input":{"id":"${allScalarsInput.id}","\\u0069d":"${allScalarsInput.id}"}}`,
			headers: {
				"Content-Type": "application/json",
				"Idempotency-Key": "duplicate-body-call",
			},
			method: "POST",
		}),
	);
	expect(duplicateBody.status).toBe(400);
	expect(await duplicateBody.json()).toEqual({
		callId: "duplicate-body-call",
		error: { code: "PROTOCOL_UNSUPPORTED", retryable: false },
	});

	const unavailable = createCandidateAdapter({
		application,
		clientContractDigest,
		wireDigest,
		definitions: [
			{
				context: contextCodec,
				execute: async () => ({ kind: "result", value: null }),
				input: { kind: "object", properties: {} },
				kind: "action",
				name: "reports.export",
				output: { kind: "nullable", codec: { kind: "text" } },
			},
		],
		resolvePrincipal: () => "principal",
		transport: async () => new Response("truncated", { status: 200 }),
	});
	await expect(
		unavailable.client.withContext(contextA).actions["reports.export"]!(
			{},
			{
				callId: "ambiguous-call",
				effectKey: "provider-export-2",
			},
		),
	).rejects.toEqual(new ActionOutcomeAmbiguous("ambiguous-call"));
	const malformedFrame = createCandidateAdapter({
		application,
		clientContractDigest,
		wireDigest,
		definitions: [
			{
				context: contextCodec,
				execute: async () => ({ kind: "result", value: null }),
				input: { kind: "object", properties: {} },
				kind: "action",
				name: "reports.export",
				output: { kind: "nullable", codec: { kind: "text" } },
			},
		],
		resolvePrincipal: () => "principal",
		transport: async () =>
			new Response(JSON.stringify({ error: { code: 42 } }), {
				headers: { "Content-Type": "application/json; charset=utf-8" },
				status: 500,
			}),
	});
	await expect(
		malformedFrame.client.withContext(contextA).actions["reports.export"]!(
			{},
			{
				callId: "malformed-call",
				effectKey: "provider-export-3",
			},
		),
	).rejects.toEqual(new ActionOutcomeAmbiguous("malformed-call"));
});

test("Query outcomes are private/no-store and never reused across Principal or Context", async () => {
	let executions = 0;
	const adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		wireDigest,
		definitions: [
			{
				context: contextCodec,
				execute: async ({ context, principal }) => {
					executions += 1;
					return { kind: "result", value: { context, principal } };
				},
				input: { kind: "object", properties: { id: { kind: "uuid" } } },
				kind: "query",
				name: "tickets.detail",
				output: {
					kind: "object",
					properties: {
						context: contextCodec,
						principal: { kind: "text", maxLength: 100 },
					},
				},
			},
		],
		resolvePrincipal: (request) =>
			request.headers.get("Authorization") ?? "anonymous",
	});
	const url = `https://candidate.test/_questpie/query/tickets.detail?id=${allScalarsInput.id}`;
	const invoke = (authorization: string, context: typeof contextA) =>
		adapter.fetch(
			new Request(url, {
				headers: {
					Authorization: authorization,
					"Questpie-Call-Id": "query-call",
					"Questpie-Context": canonicalContextHeader(contextCodec, context),
				},
			}),
		);
	const first = await invoke("Bearer principal-a", contextA);
	const second = await invoke("Bearer principal-b", contextB);
	expect(first.headers.get("Cache-Control")).toBe("private, no-store");
	expect(second.headers.get("Cache-Control")).toBe("private, no-store");
	expect(await first.json()).not.toEqual(await second.json());
	expect(executions).toBe(2);
	const malformed = await adapter.fetch(
		new Request(url, {
			headers: {
				"Questpie-Call-Id": "one, two",
				"Questpie-Context": canonicalContextHeader(contextCodec, contextA),
			},
		}),
	);
	expect(malformed.status).toBe(400);
	expect(malformed.headers.get("Cache-Control")).toBe("private, no-store");
	const missing = await adapter.fetch(
		new Request("https://candidate.test/_questpie/query/missing"),
	);
	expect(missing.status).toBe(404);
	expect(missing.headers.get("Cache-Control")).toBe("private, no-store");
	expect(
		await adapter.fetch(
			new Request("https://candidate.test/_questpie/operation", {
				method: "POST",
			}),
		),
	).toMatchObject({ status: 404 });
});

test("server cancellation and deadline precede credentials and stop every later phase", async () => {
	let credentials = 0;
	let executions = 0;
	const definition = {
		context: contextCodec,
		execute: async () => {
			executions += 1;
			return { kind: "result" as const, value: { accepted: true } };
		},
		input: { kind: "object", properties: {} },
		kind: "query" as const,
		name: "deadline.probe",
		output: {
			kind: "object",
			properties: { accepted: { kind: "boolean" } },
		},
	};
	const adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		definitions: [definition],
		resolvePrincipal: () => {
			credentials += 1;
			return "principal";
		},
		wireDigest,
	});
	const alreadyAborted = new AbortController();
	alreadyAborted.abort("caller-cancelled");
	const cancelled = await adapter.fetch(
		new Request("https://candidate.test/_questpie/query/deadline.probe", {
			headers: {
				"Questpie-Context": canonicalContextHeader(contextCodec, contextA),
			},
			signal: alreadyAborted.signal,
		}),
	);
	expect(cancelled.status).toBe(408);
	expect(await cancelled.json()).toEqual({
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(credentials).toBe(0);
	expect(executions).toBe(0);

	const instants = [0, 10];
	const expired = createCandidateAdapter({
		application,
		clientContractDigest,
		clock: {
			nowMilliseconds: () => instants.shift() ?? 10,
			schedule: () => () => {},
		},
		definitions: [definition],
		resolvePrincipal: () => {
			credentials += 1;
			return "principal";
		},
		wireDigest,
	});
	const expiredResponse = await expired.fetch(
		new Request("https://candidate.test/_questpie/query/deadline.probe", {
			headers: {
				"Questpie-Call-Id": "expired-call",
				"Questpie-Timeout-Milliseconds": "5",
			},
		}),
	);
	expect(expiredResponse.status).toBe(408);
	expect(await expiredResponse.json()).toEqual({
		callId: "expired-call",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(credentials).toBe(0);
	expect(executions).toBe(0);

	const unavailable = createCandidateAdapter({
		application,
		clientContractDigest,
		definitions: [definition],
		resolvePrincipal: () => {
			throw new Error("credential unavailable");
		},
		wireDigest,
	});
	const credentialFirst = await unavailable.fetch(
		new Request("https://candidate.test/_questpie/query/deadline.probe"),
	);
	expect(credentialFirst.status).toBe(503);
	expect(await credentialFirst.json()).toEqual({
		callId: expect.any(String),
		error: { code: "RUNTIME_UNAVAILABLE", retryable: true },
	});
	expect(executions).toBe(0);
});

test("network cancellation reaches the bounded execution signal and wins before encoding", async () => {
	let entered!: () => void;
	const executing = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let observedDeadline: number | null | undefined;
	let observedSignal: AbortSignal | undefined;
	let adapter: ReturnType<typeof createCandidateAdapter>;
	adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		definitions: [
			{
				context: { kind: "object", properties: {} },
				execute: async ({ deadlineMilliseconds, signal }) => {
					observedDeadline = deadlineMilliseconds;
					observedSignal = signal;
					entered();
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
					return { kind: "result", value: { invalidAfterAbort: true } };
				},
				input: { kind: "object", properties: {} },
				kind: "query",
				name: "deadline.network",
				output: { kind: "object", properties: {} },
			},
		],
		resolvePrincipal: () => "principal",
		transport: (request) => adapter.fetch(request),
		wireDigest,
	});
	const controller = new AbortController();
	const pending = adapter.client.withContext({}).queries["deadline.network"]!(
		{},
		{
			callId: "cancelled-network-call",
			signal: controller.signal,
			timeoutMilliseconds: 5_000,
		},
	);
	await executing;
	controller.abort("caller-cancelled");
	expect(await pending).toEqual({
		callId: "cancelled-network-call",
		error: { code: "DEADLINE_EXCEEDED", retryable: true },
	});
	expect(observedSignal?.aborted).toBe(true);
	expect(observedDeadline).toBeNumber();
});

test("missing Query Context is admitted exactly when its codec accepts the empty object", async () => {
	const contexts: unknown[] = [];
	const adapter = createCandidateAdapter({
		application,
		clientContractDigest,
		definitions: [
			{
				context: { kind: "object", properties: {} },
				execute: async ({ context }) => {
					contexts.push(context);
					return { kind: "result", value: {} };
				},
				input: { kind: "object", properties: {} },
				kind: "query",
				name: "context.empty",
				output: { kind: "object", properties: {} },
			},
			{
				context: contextCodec,
				execute: async ({ context }) => {
					contexts.push(context);
					return { kind: "result", value: {} };
				},
				input: { kind: "object", properties: {} },
				kind: "query",
				name: "context.required",
				output: { kind: "object", properties: {} },
			},
		],
		resolvePrincipal: () => "principal",
		wireDigest,
	});
	const empty = await adapter.fetch(
		new Request("https://candidate.test/_questpie/query/context.empty", {
			headers: { "Questpie-Call-Id": "empty-context-call" },
		}),
	);
	expect(empty.status).toBe(200);
	expect(await empty.json()).toEqual({
		callId: "empty-context-call",
		result: {},
	});
	expect(contexts).toEqual([{}]);
	const required = await adapter.fetch(
		new Request("https://candidate.test/_questpie/query/context.required", {
			headers: { "Questpie-Call-Id": "required-context-call" },
		}),
	);
	expect(required.status).toBe(400);
	expect(await required.json()).toEqual({
		callId: "required-context-call",
		error: { code: "PROTOCOL_UNSUPPORTED", retryable: false },
	});
	expect(contexts).toEqual([{}]);
});
