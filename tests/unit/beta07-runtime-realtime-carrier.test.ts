import { expect, test } from "bun:test";

import { principal } from "questpie";

import { projectRealtimeWireContract } from "../../packages/compiler/src/runtime";
import {
	createRealtimeCarrier,
	decodeRealtimeWireContract,
} from "../../packages/runtime/src/application/realtime";
import { LiveQueryEvaluationFailure } from "../../packages/runtime/src/application/realtime/coordinator";
import type {
	DurableRealtimeAttachment,
	DurableRealtimeCoordinator,
} from "../../packages/runtime/src/application/realtime/durable";
import type { PostgresRealtimeWatch } from "../../packages/runtime/src/live-query";

const application = "application:collaboration";
const clientContractDigest = "1".repeat(64);
const operationWireDigest = "2".repeat(64);
const context = { companyId: "company:one" };
const queryInput = { after: null, channelId: "channel:one", first: 20 };
const observedPlan = Object.freeze({
	format: "questpie.observed-live-query-plan" as const,
	version: 1 as const,
	query: "query:messages.page",
	tokens: Object.freeze([]),
	digest: "3".repeat(64),
});

const projected = projectRealtimeWireContract({
	application,
	clientContractDigest,
	operationWireDigest,
	resources: [
		{
			identity: "query:messages.page",
			kind: "query",
			name: "messages.page",
			contract: {
				exposure: "network",
				input: {
					kind: "object",
					properties: {
						after: { kind: "nullable", codec: { kind: "text" } },
						channelId: { kind: "text" },
						first: { kind: "integer" },
					},
				},
				output: {
					kind: "object",
					properties: {
						nodes: {
							kind: "array",
							items: {
								kind: "object",
								properties: { body: { kind: "text" } },
							},
						},
					},
				},
				declaredErrors: {},
			},
			contributions: [],
			origin: {
				logicalPath: "src/message-page.ts",
				exportName: "messagePage",
				packageId: null,
				span: null,
				memberSpans: {},
			},
			value: {},
		},
	],
	watchableQueries: ["query:messages.page"],
});

const user = principal.user({ id: "user:one" });

test("decodes only the exact compiler-owned realtime artifact", () => {
	expect(() =>
		decodeRealtimeWireContract({ ...projected, provider: "redis" }),
	).toThrow("realtime wire has invalid keys");
	expect(() =>
		decodeRealtimeWireContract({
			...projected,
			limits: { ...projected.limits, activeWatchesPerPrincipal: 65 },
		}),
	).toThrow("realtime limit activeWatchesPerPrincipal is invalid");
});

function request(
	method: "GET" | "POST",
	body?: unknown,
	scopeId = "scope:one",
): Request {
	return new Request("http://runtime.test/_questpie/realtime", {
		method,
		headers:
			method === "GET"
				? {
						accept: projected.streamMediaType,
						"x-questpie-realtime-scope": scopeId,
					}
				: { "content-type": projected.commandMediaType },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

function command(
	kind: "ack" | "close" | "open",
	bindingId: string,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	const base = {
		protocol: projected.protocol,
		application,
		clientContractDigest,
		realtimeWireDigest: projected.digest,
		scopeId: "scope:one",
		bindingId,
		command: kind,
	};
	if (kind === "open")
		return {
			...base,
			context,
			input: queryInput,
			query: "query:messages.page",
			resumeToken: null,
			...overrides,
		};
	if (kind === "ack")
		return { ...base, resumeToken: "token:one", ...overrides };
	return { ...base, ...overrides };
}

async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const part = await reader.read();
	if (part.done) return null;
	const text = new TextDecoder().decode(part.value);
	const data = text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n");
	return JSON.parse(data) as Readonly<Record<string, unknown>>;
}

function harness(
	evaluate: () => Promise<unknown> = async () => ({
		nodes: [{ body: "complete result" }],
	}),
) {
	let contextDecodes = 0;
	let principalResolutions = 0;
	let evaluationFailures = 0;
	const observedPlans: unknown[] = [];
	let attachment: DurableRealtimeAttachment | undefined;
	const watches = new Map<
		string,
		Readonly<{ watch: PostgresRealtimeWatch; token: string }>
	>();
	const durableCoordinator: DurableRealtimeCoordinator = {
		async attach(candidate) {
			attachment = candidate;
			return true;
		},
		async detach(candidate) {
			if (attachment === candidate) attachment = undefined;
		},
		async open(opened) {
			const holder = attachment;
			if (
				!holder ||
				holder.scopeId !== opened.scopeId ||
				holder.principal.kind !== opened.principal.kind ||
				holder.principal.id !== opened.principal.id
			)
				return "unavailable";
			if (watches.has(opened.bindingId)) return "unavailable";
			if (watches.size >= projected.limits.activeWatchesPerPrincipal)
				return "limit";
			const watch: PostgresRealtimeWatch = Object.freeze({
				bindingIdentity: opened.bindingId,
				authorityPartitionDigest: opened.authorityPartitionDigest,
				queryIdentity: opened.queryIdentity,
				queryBytes: opened.queryBytes,
				inputBytes: opened.inputBytes,
				inputDigest: opened.inputDigest,
				contextInputBytes: opened.contextInputBytes,
				wireVersion: 1,
				resumeRequested: opened.resumeRequested,
				requestedResumeToken: opened.requestedResumeToken,
				activeSlot: watches.size + 1,
				invalidationGeneration: 1n,
				evaluatedInvalidationGeneration: 0n,
				latest: null,
			});
			const token = `token:${opened.bindingId}`;
			watches.set(opened.bindingId, Object.freeze({ watch, token }));
			void Promise.resolve().then(async () => {
				const prepared = await holder.prepare(
					watch,
					new AbortController().signal,
				);
				if (
					!prepared ||
					prepared.authorityPartitionDigest !== watch.authorityPartitionDigest
				)
					return;
				try {
					const completed = await prepared.evaluate();
					await holder.publish(watch, {
						...completed,
						delivery: opened.resumeRequested ? "reset" : "initial",
						resetReason: opened.resumeRequested ? "resume-unavailable" : null,
						resumeToken: token,
					});
				} catch (error) {
					evaluationFailures += 1;
					if (error instanceof LiveQueryEvaluationFailure)
						await holder.publishFailure(watch, error.code);
				}
			});
			return "opened";
		},
		async acknowledge(_scopeId, bindingId, _principal, resumeToken) {
			return watches.get(bindingId)?.token === resumeToken;
		},
		async close(_scopeId, bindingId) {
			const closed = watches.delete(bindingId);
			attachment?.synchronize(new Set(watches.keys()));
			return closed;
		},
		async requestScan() {},
	};
	const carrier = createRealtimeCarrier({
		contract: decodeRealtimeWireContract(projected),
		durableCoordinator,
		decodeContext(value) {
			contextDecodes += 1;
			return value as typeof context;
		},
		resolvePrincipal() {
			principalResolutions += 1;
			return user;
		},
		evaluate: async () =>
			Object.freeze({ result: await evaluate(), observedPlan }),
		onObservedPlan(value) {
			observedPlans.push(value);
		},
	});
	return {
		carrier,
		contextDecodes: () => contextDecodes,
		principalResolutions: () => principalResolutions,
		observedPlans,
		evaluationFailures: () => evaluationFailures,
	};
}

test("rejects malformed commands before Context or command Principal work", async () => {
	const value = harness();
	const stream = await value.carrier.fetch(request("GET"));
	expect(stream?.status).toBe(200);
	const before = value.principalResolutions();

	const malformed = await value.carrier.fetch(
		request("POST", command("open", "binding:one", { authority: "system" })),
	);
	expect(malformed?.status).toBe(400);
	expect(value.contextDecodes()).toBe(0);
	expect(value.principalResolutions()).toBe(before);
	await value.carrier.drain({ deadlineAt: Date.now() + 2_000 });
});

test("serves ready, complete delivery, acknowledgement, and close frames", async () => {
	const value = harness();
	const response = await value.carrier.fetch(request("GET"));
	expect(response?.headers.get("content-type")).toBe(projected.streamMediaType);
	const reader = response?.body?.getReader();
	if (!reader) throw new Error("missing realtime stream");
	expect(await nextFrame(reader)).toEqual({
		protocol: projected.protocol,
		kind: "ready",
		scopeId: "scope:one",
	});

	expect(
		(await value.carrier.fetch(request("POST", command("open", "binding:one"))))
			?.status,
	).toBe(202);
	const delivery = await nextFrame(reader);
	expect(value.observedPlans).toEqual([
		{
			scopeId: "scope:one",
			bindingId: "binding:one",
			query: "query:messages.page",
			plan: observedPlan,
		},
	]);
	expect(delivery).toEqual({
		protocol: projected.protocol,
		kind: "delivery",
		bindingId: "binding:one",
		query: "query:messages.page",
		delivery: "initial",
		resetReason: null,
		payload: { nodes: [{ body: "complete result" }] },
		resumeToken: expect.any(String),
	});
	const token = delivery?.resumeToken;
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("ack", "binding:one", { resumeToken: token })),
			)
		)?.status,
	).toBe(202);
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("close", "binding:one")),
			)
		)?.status,
	).toBe(202);
	await value.carrier.drain({ deadlineAt: Date.now() + 2_000 });
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("open", "binding:after-drain")),
			)
		)?.status,
	).toBe(503);
	expect(await nextFrame(reader)).toEqual({
		protocol: projected.protocol,
		kind: "closed",
		reason: "runtime-draining",
		retryable: true,
		scopeId: "scope:one",
	});
	expect((await reader.read()).done).toBe(true);
});

test("frames an invalid complete result as an exact failure", async () => {
	const value = harness(async () => ({ nodes: [{ body: 42 }] }));
	const response = await value.carrier.fetch(request("GET"));
	const reader = response?.body?.getReader();
	if (!reader) throw new Error("missing realtime stream");
	await nextFrame(reader);
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("open", "binding:invalid-output")),
			)
		)?.status,
	).toBe(202);
	expect(await nextFrame(reader)).toEqual({
		protocol: projected.protocol,
		kind: "failure",
		bindingId: "binding:invalid-output",
		query: "query:messages.page",
		error: { code: "OUTPUT_INVALID" },
	});
	expect(value.observedPlans).toEqual([]);
	expect(value.evaluationFailures()).toBe(1);
	await value.carrier.drain({ deadlineAt: Date.now() + 2_000 });
});

test("resets unavailable private resume state and enforces 64 watches", async () => {
	let evaluations = 0;
	const value = harness(async () => {
		evaluations += 1;
		return { nodes: [] };
	});
	const response = await value.carrier.fetch(request("GET"));
	const reader = response?.body?.getReader();
	if (!reader) throw new Error("missing realtime stream");
	await nextFrame(reader);
	for (let index = 0; index < 64; index += 1)
		expect(
			(
				await value.carrier.fetch(
					request(
						"POST",
						command("open", `binding:${index}`, {
							resumeToken: index === 0 ? "unavailable-token" : null,
						}),
					),
				)
			)?.status,
		).toBe(202);
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("open", "binding:overflow")),
			)
		)?.status,
	).toBe(429);
	const reset = await nextFrame(reader);
	expect(reset).toEqual(
		expect.objectContaining({
			bindingId: "binding:0",
			delivery: "reset",
			resetReason: "resume-unavailable",
		}),
	);
	await Bun.sleep(0);
	expect(evaluations).toBe(64);
	expect(
		(await value.carrier.fetch(request("POST", command("close", "binding:1"))))
			?.status,
	).toBe(202);
	const replacement = await value.carrier.fetch(request("GET"));
	const replacementReader = replacement?.body?.getReader();
	if (!replacementReader) throw new Error("missing replacement stream");
	await nextFrame(replacementReader);
	expect(
		(
			await value.carrier.fetch(
				request("POST", command("open", "binding:replacement")),
			)
		)?.status,
	).toBe(202);
	await value.carrier.drain({ deadlineAt: Date.now() + 2_000 });
});

test("disconnects a slow client before its exact byte buffer can grow", async () => {
	const large = "x".repeat(900_000);
	const value = harness(async () => ({ nodes: [{ body: large }] }));
	const response = await value.carrier.fetch(request("GET"));
	const reader = response?.body?.getReader();
	if (!reader) throw new Error("missing realtime stream");
	await nextFrame(reader);
	for (let index = 0; index < 4; index += 1)
		expect(
			(
				await value.carrier.fetch(
					request("POST", command("open", `binding:large:${index}`)),
				)
			)?.status,
		).toBe(202);
	await Bun.sleep(0);
	const frames = [];
	for (;;) {
		const frame = await nextFrame(reader);
		if (frame === null) break;
		frames.push(frame);
	}
	expect(frames).toContainEqual(
		expect.objectContaining({
			kind: "closed",
			reason: "buffer-limit",
			retryable: true,
		}),
	);
});
