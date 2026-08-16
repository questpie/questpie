import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { backendPid } from "../../../packages/compiler/src/postgres-session";
import { projectRealtimeWireContract } from "../../../packages/compiler/src/runtime";
import { ensureInternalProtocolV3 } from "../../../packages/compiler/src/schema";
import {
	createPostgresLiveQueryCoordinator,
	createRealtimeCarrier,
	decodeRealtimeWireContract,
} from "../../../packages/runtime/src/application/realtime";
import {
	canonicalJsonLine,
	sha256Digest,
} from "../../../packages/runtime/src/canonical-json";
import type { PostgresWakeTickSource } from "../../../packages/runtime/src/live-query";
import { createPostgresRealtimeScopeStore } from "../../../packages/runtime/src/live-query/postgres-realtime-scope";

const databases = process.env.PGHOST
	? [new SQL({ max: 1 }), new SQL({ max: 1 }), new SQL({ max: 1 })]
	: [];
const postgresTest = process.env.PGHOST ? test : test.skip;
const control = { lockTimeoutMs: 1_000, statementTimeoutMs: 10_000 } as const;
const application = "application:collaboration";
const applicationName = "collaboration";
const deploymentDigest = "a".repeat(64);
const user = principal.user({ id: "user:one" });
const otherUser = principal.user({ id: "user:two" });
const context = { companyId: "company:one" };
const queryInput = { after: null, channelId: "channel:one", first: 20 };

const projected = projectRealtimeWireContract({
	application,
	clientContractDigest: "1".repeat(64),
	operationWireDigest: "2".repeat(64),
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

const planWithoutDigest = Object.freeze({
	format: "questpie.observed-live-query-plan" as const,
	version: 1 as const,
	query: "query:messages.page",
	tokens: Object.freeze([]),
});
const observedPlan = Object.freeze({
	...planWithoutDigest,
	digest: sha256Digest(
		Buffer.concat([
			Buffer.from("questpie-observed-live-query-plan-v1\0"),
			canonicalJsonLine(planWithoutDigest),
		]),
	),
});

function ticks() {
	let tick: (() => void) | undefined;
	const source: PostgresWakeTickSource = {
		armInterval(_milliseconds, callback) {
			tick = callback;
			return () => {};
		},
		armDeadline() {
			return () => {};
		},
	};
	return { source, tick: () => tick?.() };
}

function request(
	method: "GET" | "POST",
	body?: unknown,
	scopeId = "scope:one",
	principalId = user.id,
): Request {
	return new Request("http://runtime.test/_questpie/realtime", {
		method,
		headers:
			method === "GET"
				? {
						accept: projected.streamMediaType,
						"x-questpie-realtime-scope": scopeId,
					}
				: {
						"content-type": projected.commandMediaType,
						"x-test-principal": principalId,
					},
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
		clientContractDigest: projected.clientContractDigest,
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
	if (kind === "ack") return { ...base, resumeToken: "invalid", ...overrides };
	return { ...base, ...overrides };
}

async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
	const part = await reader.read();
	if (part.done) return null;
	return JSON.parse(
		new TextDecoder().decode(part.value).slice("data: ".length).trim(),
	) as Readonly<Record<string, unknown>>;
}

async function ensure(sql: SQL): Promise<void> {
	const [current] = await sql<{ name: string }[]>`
		select current_database() as name
	`;
	await ensureInternalProtocolV3(
		sql,
		current!.name,
		await backendPid(sql),
		control,
	);
}

beforeEach(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	if (databases[0]) await ensure(databases[0]);
});

afterAll(async () => {
	await databases[0]?.unsafe("DROP SCHEMA IF EXISTS questpie_internal CASCADE");
	await Promise.all(
		databases.map((database) => database.close({ timeout: 0 })),
	);
});

describe.skipIf(databases.length === 0)(
	"BETA-07 no-affinity PostgreSQL carrier",
	() => {
		postgresTest(
			"attaches on A, opens on B, frames from A, acknowledges on C, and closes on B",
			async () => {
				const tickSources = [ticks(), ticks(), ticks()] as const;
				const coordinators = databases.map((sql, index) =>
					createPostgresLiveQueryCoordinator({
						program: {} as never,
						sql,
						hmacKey: new Uint8Array(32).fill(7),
						applicationName,
						consumer: "ignored-process-local-consumer",
						deploymentDigest,
						wireVersion: 1,
						tickSource: tickSources[index]!.source,
					}),
				);
				for (const coordinator of coordinators) await coordinator.start();
				const wrongDeployment = createPostgresLiveQueryCoordinator({
					program: {} as never,
					sql: databases[1]!,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					consumer: "ignored-process-local-consumer",
					deploymentDigest: "b".repeat(64),
					wireVersion: 1,
					tickSource: ticks().source,
				});
				await wrongDeployment.start();
				let evaluations = 0;
				let evaluationFails = false;
				const makeCarrier = (coordinator: (typeof coordinators)[number]) =>
					createRealtimeCarrier({
						contract: decodeRealtimeWireContract(projected),
						durableCoordinator: coordinator.durable,
						resolvePrincipal: (request) =>
							request.headers.get("x-test-principal") === otherUser.id
								? otherUser
								: user,
						decodeContext(value) {
							if (
								!value ||
								typeof value !== "object" ||
								typeof (value as { companyId?: unknown }).companyId !== "string"
							)
								throw new TypeError("Context is invalid");
							return value as typeof context;
						},
						evaluate: async ({
							principal: evaluatedPrincipal,
							context: value,
						}) => {
							evaluations += 1;
							if (evaluationFails) throw new Error("retry later");
							expect(evaluatedPrincipal).toEqual(user);
							expect(value).toEqual(context);
							return {
								result: { nodes: [{ body: "durable result" }] },
								observedPlan,
							};
						},
					});
				const carriers = coordinators.map(makeCarrier);
				const wrongDeploymentCarrier = makeCarrier(wrongDeployment);

				const stream = await carriers[0]!.fetch(request("GET"));
				const reader = stream?.body?.getReader();
				if (!reader) throw new Error("missing realtime stream");
				expect((await nextFrame(reader))?.kind).toBe("ready");
				await coordinators[0]!.reconcile();

				expect(
					(
						await carriers[1]!.fetch(
							request("POST", command("open", "binding:one")),
						)
					)?.status,
				).toBe(202);
				expect(evaluations).toBe(0);
				await coordinators[1]!.reconcile();
				expect(
					(
						await carriers[1]!.fetch(
							request(
								"POST",
								command("open", "binding:wrong-context", {
									context: { companyId: "company:two" },
								}),
							),
						)
					)?.status,
				).toBe(404);
				expect(
					(
						await carriers[1]!.fetch(
							request(
								"POST",
								command("open", "binding:wrong-principal"),
								"scope:one",
								otherUser.id,
							),
						)
					)?.status,
				).toBe(404);
				expect(
					(
						await wrongDeploymentCarrier.fetch(
							request("POST", command("open", "binding:wrong-deployment")),
						)
					)?.status,
				).toBe(404);
				expect(evaluations).toBe(0);
				await coordinators[1]!.reconcile();
				await wrongDeployment.reconcile();

				tickSources[0].tick();
				await coordinators[0]!.reconcile();
				const delivery = await nextFrame(reader);
				expect(delivery).toMatchObject({
					kind: "delivery",
					bindingId: "binding:one",
					delivery: "initial",
					resetReason: null,
					payload: { nodes: [{ body: "durable result" }] },
				});
				expect(evaluations).toBe(1);
				const store = createPostgresRealtimeScopeStore({ sql: databases[1]! });
				const authority = {
					applicationName,
					scopeIdentity: "scope:one",
					deploymentDigest,
					principal: user,
				} as const;
				expect(
					await store.invalidateWatch({
						...authority,
						bindingIdentity: "binding:one",
					}),
				).toBe(2n);
				tickSources[0].tick();
				await coordinators[0]!.reconcile();
				const update = await nextFrame(reader);
				expect(update).toMatchObject({
					kind: "delivery",
					delivery: "update",
					resetReason: null,
				});
				expect(evaluations).toBe(2);

				evaluationFails = true;
				expect(
					await store.invalidateWatch({
						...authority,
						bindingIdentity: "binding:one",
					}),
				).toBe(3n);
				tickSources[0].tick();
				await coordinators[0]!.reconcile();
				const [dirty] = await databases[0]!<
					{
						evaluated: string;
						generation: string;
						invalidation: string;
					}[]
				>`
					select watch.invalidation_generation as invalidation,
					       watch.evaluated_invalidation_generation as evaluated,
					       generation.generation
					from questpie_internal.realtime_watch_bindings watch
					join questpie_internal.realtime_binding_generations generation
					  on generation.application_name = watch.application_name
					 and generation.scope_identity = watch.scope_identity
					 and generation.binding_identity = watch.binding_identity
					 and generation.latest_slot = 1
					where watch.application_name = ${applicationName}
					  and watch.scope_identity = 'scope:one'
					  and watch.binding_identity = 'binding:one'
				`;
				expect(dirty).toEqual({
					evaluated: "2",
					generation: "2",
					invalidation: "3",
				});
				expect(evaluations).toBeGreaterThan(2);

				expect(
					(
						await carriers[2]!.fetch(
							request(
								"POST",
								command("ack", "binding:one", {
									resumeToken: update?.resumeToken,
								}),
							),
						)
					)?.status,
				).toBe(202);
				const [acknowledged] = await databases[2]!<{ acknowledged: boolean }[]>`
					select ack_slot = 1 as acknowledged
					from questpie_internal.realtime_binding_generations
					where application_name = ${applicationName}
					  and scope_identity = 'scope:one'
					  and binding_identity = 'binding:one'
					  and latest_slot = 1
				`;
				expect(acknowledged).toEqual({ acknowledged: true });

				evaluationFails = false;
				const resumedStream = await carriers[0]!.fetch(
					request("GET", undefined, "scope:resume"),
				);
				const resumedReader = resumedStream?.body?.getReader();
				if (!resumedReader) throw new Error("missing resumed realtime stream");
				expect((await nextFrame(resumedReader))?.kind).toBe("ready");
				await coordinators[0]!.reconcile();
				const beforeResume = evaluations;
				expect(
					(
						await carriers[1]!.fetch(
							request(
								"POST",
								command("open", "binding:resume", {
									resumeToken: update?.resumeToken,
									scopeId: "scope:resume",
								}),
							),
						)
					)?.status,
				).toBe(202);
				await coordinators[1]!.reconcile();
				expect(
					await store.readOpenWatch({
						...authority,
						scopeIdentity: "scope:resume",
						bindingIdentity: "binding:resume",
					}),
				).toBeDefined();
				tickSources[0].tick();
				await coordinators[0]!.reconcile();
				const resumedWatch = await store.readOpenWatch({
					...authority,
					scopeIdentity: "scope:resume",
					bindingIdentity: "binding:resume",
				});
				expect(resumedWatch?.latest).not.toBeNull();
				expect(evaluations).toBe(beforeResume);
				expect(await nextFrame(resumedReader)).toMatchObject({
					kind: "delivery",
					delivery: "initial",
					resetReason: null,
					resumeToken: update?.resumeToken,
				});

				const resetStream = await carriers[0]!.fetch(
					request("GET", undefined, "scope:reset"),
				);
				const resetReader = resetStream?.body?.getReader();
				if (!resetReader) throw new Error("missing reset realtime stream");
				expect((await nextFrame(resetReader))?.kind).toBe("ready");
				await coordinators[0]!.reconcile();
				evaluationFails = false;
				expect(
					(
						await carriers[1]!.fetch(
							request(
								"POST",
								command("open", "binding:reset", {
									resumeToken: "invalid-resume-token",
									scopeId: "scope:reset",
								}),
							),
						)
					)?.status,
				).toBe(202);
				await coordinators[1]!.reconcile();
				tickSources[0].tick();
				await coordinators[0]!.reconcile();
				expect(await nextFrame(resetReader)).toMatchObject({
					kind: "delivery",
					delivery: "reset",
					resetReason: "resume-unavailable",
				});
				expect(evaluations).toBe(beforeResume + 1);
				expect(
					(
						await carriers[1]!.fetch(
							request("POST", command("close", "binding:one")),
						)
					)?.status,
				).toBe(202);
				const [closed] = await databases[1]!<
					{ activeSlot: number | null; state: string }[]
				>`
					select active_slot as "activeSlot", state
					from questpie_internal.realtime_watch_bindings
					where application_name = ${applicationName}
					  and scope_identity = 'scope:one'
					  and binding_identity = 'binding:one'
				`;
				expect(closed).toEqual({ activeSlot: null, state: "withdrawn" });

				await Promise.all(carriers.map((carrier) => carrier.drain()));
				await wrongDeploymentCarrier.drain();
				await Promise.all(
					coordinators.map((coordinator) => coordinator.drain()),
				);
				await wrongDeployment.drain();
			},
			20_000,
		);
	},
);
