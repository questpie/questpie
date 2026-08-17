import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { projectLiveQueryCompilation } from "../../../packages/compiler/src/live-query";
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
import {
	linkLiveQueryProgram,
	type PostgresWakeTickSource,
} from "../../../packages/runtime/src/live-query";
import { createPostgresRealtimeScopeStore } from "../../../packages/runtime/src/live-query/postgres-realtime-scope";
import { DeclaredOperationError } from "../../../packages/runtime/src/operation";

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
const changedContext = { companyId: "company:two" };
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
	tokens: Object.freeze([
		Object.freeze({
			kind: "collectionRange" as const,
			collection: "collection:messages",
			detail: Object.freeze({}),
		}),
	]),
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

const projectedLiveQuery = projectLiveQueryCompilation({
	resources: [],
	contextProjection: {},
	dataProjection: {},
	policyProjection: {},
	queryProjection: {},
});
const liveQueryProgram = linkLiveQueryProgram({
	watchability: projectedLiveQuery.artifacts["query-watchability.json"],
	dependencyAlgebra:
		projectedLiveQuery.artifacts["live-query-dependency-algebra.json"],
	changeLedger: projectedLiveQuery.artifacts["change-ledger.json"],
	reconciliation: projectedLiveQuery.artifacts["change-reconciliation.json"],
	resume: projectedLiveQuery.artifacts["live-query-resume.json"],
	captureBoundary: projectedLiveQuery.artifacts["change-capture-boundary.json"],
	limits: projectedLiveQuery.artifacts["live-query-limits.json"],
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

async function captureMessageChange(sql: SQL): Promise<void> {
	await sql`
		insert into questpie_internal.change_ledger
		(application_name, transaction_id, collection_identity, change_kind, conservative)
		values (${applicationName}, pg_catalog.pg_current_xact_id(),
		        'collection:messages', 'collection', true)
	`;
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
						program: liveQueryProgram,
						sql,
						hmacKey: new Uint8Array(32).fill(7),
						applicationName,
						deploymentDigest,
						wireVersion: 1,
						tickSource: tickSources[index]!.source,
					}),
				);
				for (const coordinator of coordinators) await coordinator.start();
				const wrongDeployment = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					sql: databases[1]!,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest: "b".repeat(64),
					wireVersion: 1,
					tickSource: ticks().source,
				});
				await wrongDeployment.start();
				let evaluations = 0;
				let evaluationFails = false;
				let completeFailure: "OUTPUT_INVALID" | "RESOURCE_LIMIT" | null = null;
				const makeCarrier = (coordinator: (typeof coordinators)[number]) =>
					createRealtimeCarrier({
						contract: decodeRealtimeWireContract(projected),
						durableCoordinator: coordinator.durable!,
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
							expect(value).toEqual(
								value.companyId === changedContext.companyId
									? changedContext
									: context,
							);
							return {
								result: {
									nodes: [
										{
											body:
												completeFailure === "OUTPUT_INVALID"
													? 42
													: completeFailure === "RESOURCE_LIMIT"
														? "x".repeat(1_048_577)
														: "durable result",
										},
									],
								},
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
				await coordinators[0]!.durable!.requestScan();

				expect(
					(
						await carriers[1]!.fetch(
							request("POST", command("open", "binding:one")),
						)
					)?.status,
				).toBe(202);
				expect(evaluations).toBe(0);
				await coordinators[1]!.durable!.requestScan();
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
				await coordinators[1]!.durable!.requestScan();
				await wrongDeployment.durable!.requestScan();

				tickSources[0].tick();
				await coordinators[0]!.durable!.requestScan();
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
				await captureMessageChange(databases[1]!);
				tickSources[0].tick();
				await coordinators[0]!.durable!.requestScan();
				const update = await nextFrame(reader);
				expect(update).toMatchObject({
					kind: "delivery",
					delivery: "update",
					resetReason: null,
				});
				expect(evaluations).toBe(2);

				for (const [bindingId, code] of [
					["binding:invalid-output", "OUTPUT_INVALID"],
					["binding:oversized-output", "RESOURCE_LIMIT"],
				] as const) {
					completeFailure = code;
					expect(
						(
							await carriers[1]!.fetch(
								request("POST", command("open", bindingId)),
							)
						)?.status,
					).toBe(202);
					await coordinators[1]!.durable!.requestScan();
					await coordinators[0]!.durable!.requestScan();
					expect(await nextFrame(reader)).toEqual({
						protocol: projected.protocol,
						kind: "failure",
						bindingId,
						query: "query:messages.page",
						error: { code },
					});
					const [unstaged] = await databases[0]!<{ count: number }[]>`
						select count(*)::integer as count
						from questpie_internal.realtime_binding_generations
						where application_name = ${applicationName}
						  and scope_identity = 'scope:one'
						  and binding_identity = ${bindingId}
					`;
					expect(unstaged?.count).toBe(0);
					expect(
						(
							await carriers[1]!.fetch(
								request("POST", command("close", bindingId)),
							)
						)?.status,
					).toBe(202);
				}
				completeFailure = null;

				evaluationFails = true;
				await captureMessageChange(databases[1]!);
				tickSources[0].tick();
				await coordinators[0]!.durable!.requestScan();
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
				await coordinators[0]!.durable!.requestScan();
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
				await coordinators[1]!.durable!.requestScan();
				expect(
					await store.readOpenWatch({
						...authority,
						scopeIdentity: "scope:resume",
						bindingIdentity: "binding:resume",
					}),
				).toBeDefined();
				tickSources[0].tick();
				await coordinators[0]!.durable!.requestScan();
				const resumedWatch = await store.readOpenWatch({
					...authority,
					scopeIdentity: "scope:resume",
					bindingIdentity: "binding:resume",
				});
				expect(resumedWatch?.latest).not.toBeNull();
				expect(evaluations).toBe(beforeResume + 1);
				expect(await nextFrame(resumedReader)).toMatchObject({
					kind: "delivery",
					delivery: "initial",
					resetReason: null,
					resumeToken: update?.resumeToken,
				});
				await coordinators[0]!.durable!.requestScan();
				const [resumedGenerations] = await databases[0]!<{ count: number }[]>`
					select count(*)::integer as count
					from questpie_internal.realtime_binding_generations
					where application_name = ${applicationName}
					  and scope_identity = 'scope:resume'
					  and binding_identity = 'binding:resume'
				`;
				// One fresh authority evaluation publishes the retained initial exactly once;
				// a subsequent scan neither re-evaluates nor creates a duplicate generation.
				expect(evaluations).toBe(beforeResume + 1);
				expect(resumedGenerations?.count).toBe(1);

				const resetStream = await carriers[0]!.fetch(
					request("GET", undefined, "scope:reset"),
				);
				const resetReader = resetStream?.body?.getReader();
				if (!resetReader) throw new Error("missing reset realtime stream");
				expect((await nextFrame(resetReader))?.kind).toBe("ready");
				await coordinators[0]!.durable!.requestScan();
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
				await coordinators[1]!.durable!.requestScan();
				tickSources[0].tick();
				await coordinators[0]!.durable!.requestScan();
				expect(await nextFrame(resetReader)).toMatchObject({
					kind: "delivery",
					delivery: "reset",
					resetReason: "resume-unavailable",
				});
				expect(evaluations).toBe(beforeResume + 2);

				const authorityResetStream = await carriers[0]!.fetch(
					request("GET", undefined, "scope:authority-reset"),
				);
				const authorityResetReader = authorityResetStream?.body?.getReader();
				if (!authorityResetReader)
					throw new Error("missing authority reset realtime stream");
				expect((await nextFrame(authorityResetReader))?.kind).toBe("ready");
				expect(
					(
						await carriers[1]!.fetch(
							request(
								"POST",
								command("open", "binding:authority-reset", {
									context: changedContext,
									resumeToken: update?.resumeToken,
									scopeId: "scope:authority-reset",
								}),
							),
						)
					)?.status,
				).toBe(202);
				await coordinators[1]!.durable!.requestScan();
				await coordinators[0]!.durable!.requestScan();
				expect(await nextFrame(authorityResetReader)).toMatchObject({
					kind: "delivery",
					delivery: "reset",
					resetReason: "authority-changed",
				});
				expect(evaluations).toBe(beforeResume + 3);

				const deploymentResetStream = await wrongDeploymentCarrier.fetch(
					request("GET", undefined, "scope:deployment-reset"),
				);
				const deploymentResetReader = deploymentResetStream?.body?.getReader();
				if (!deploymentResetReader)
					throw new Error("missing deployment reset realtime stream");
				expect((await nextFrame(deploymentResetReader))?.kind).toBe("ready");
				expect(
					(
						await wrongDeploymentCarrier.fetch(
							request(
								"POST",
								command("open", "binding:deployment-reset", {
									resumeToken: update?.resumeToken,
									scopeId: "scope:deployment-reset",
								}),
							),
						)
					)?.status,
				).toBe(202);
				await wrongDeployment.durable!.requestScan();
				expect(await nextFrame(deploymentResetReader)).toMatchObject({
					kind: "delivery",
					delivery: "reset",
					resetReason: "deployment-changed",
				});
				expect(evaluations).toBe(beforeResume + 4);
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

		postgresTest(
			"denies a retained generation to a fresh holder when authority is gone",
			async () => {
				// A holder takeover finds a durable binding that is not dirty and has
				// never been framed on this connection. The retained bytes were
				// authorized by the earlier Execution, which is not authority for this
				// disclosure, so the fresh holder must create a new root and let Policy
				// answer before anything is framed.
				const tickSources = [ticks(), ticks()] as const;
				const coordinators = [databases[0]!, databases[1]!].map((sql, index) =>
					createPostgresLiveQueryCoordinator({
						program: liveQueryProgram,
						sql,
						hmacKey: new Uint8Array(32).fill(7),
						applicationName,
						deploymentDigest,
						wireVersion: 1,
						tickSource: tickSources[index]!.source,
					}),
				);
				for (const coordinator of coordinators) await coordinator.start();
				let evaluations = 0;
				let authorityRevoked = false;
				const makeCarrier = (coordinator: (typeof coordinators)[number]) =>
					createRealtimeCarrier({
						contract: decodeRealtimeWireContract(projected),
						durableCoordinator: coordinator.durable!,
						resolvePrincipal: () => user,
						decodeContext: (value) => value as typeof context,
						evaluate: async () => {
							evaluations += 1;
							if (authorityRevoked)
								// Exactly what a revoked Membership raises out of executeRoot:
								// a declared Context refusal, not a coordinator-internal class.
								throw new DeclaredOperationError("tenant.notFound", 404);
							return {
								result: { nodes: [{ body: "durable result" }] },
								observedPlan,
							};
						},
					});
				const carriers = coordinators.map(makeCarrier);
				try {
					const firstStream = await carriers[0]!.fetch(
						request("GET", undefined, "scope:takeover"),
					);
					const firstReader = firstStream?.body?.getReader();
					if (!firstReader) throw new Error("missing realtime stream");
					expect((await nextFrame(firstReader))?.kind).toBe("ready");
					await coordinators[0]!.durable!.requestScan();
					expect(
						(
							await carriers[0]!.fetch(
								request(
									"POST",
									command("open", "binding:takeover", {
										scopeId: "scope:takeover",
									}),
								),
							)
						)?.status,
					).toBe(202);
					tickSources[0].tick();
					await coordinators[0]!.durable!.requestScan();
					expect(await nextFrame(firstReader)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "durable result" }] },
					});
					expect(evaluations).toBe(1);
					// The first holder is never drained or withdrawn. A crashed Runtime
					// leaves its durable binding behind exactly like this.

					// The binding is clean: the retained generation is fully evaluated.
					const [clean] = await databases[0]!<
						{ evaluated: string; invalidation: string }[]
					>`
						select invalidation_generation::text as invalidation,
						       evaluated_invalidation_generation::text as evaluated
						from questpie_internal.realtime_watch_bindings
						where application_name = ${applicationName}
						  and scope_identity = 'scope:takeover'
						  and binding_identity = 'binding:takeover'
					`;
					expect(clean?.evaluated).toBe(clean?.invalidation);

					authorityRevoked = true;
					const takeoverStream = await carriers[1]!.fetch(
						request("GET", undefined, "scope:takeover"),
					);
					const takeoverReader = takeoverStream?.body?.getReader();
					if (!takeoverReader) throw new Error("missing takeover stream");
					expect((await nextFrame(takeoverReader))?.kind).toBe("ready");
					const beforeTakeover = evaluations;
					tickSources[1].tick();
					await coordinators[1]!.durable!.requestScan();

					// Before the repair this framed the retained payload with no
					// evaluation at all. It must now be a denial instead.
					expect(await nextFrame(takeoverReader)).toEqual({
						protocol: projected.protocol,
						kind: "failure",
						bindingId: "binding:takeover",
						query: "query:messages.page",
						error: { code: "AUTHORIZATION_FAILED" },
					});
					expect(evaluations).toBeGreaterThan(beforeTakeover);
					await takeoverReader.cancel();
				} finally {
					await Promise.all(carriers.map((carrier) => carrier.drain()));
					await Promise.all(
						coordinators.map((coordinator) => coordinator.drain()),
					);
				}
			},
			20_000,
		);

		postgresTest(
			"withholds a retained generation whose fresh root does not reproduce it",
			async () => {
				// Every change is supposed to reach a binding through the Change Ledger.
				// A clean binding whose fresh root yields different bytes therefore
				// means a change escaped capture: the retained bytes are not
				// reproducible and a new generation cannot be staged while the binding
				// is clean. Nothing may be disclosed, and the tick must not recompute
				// the same binding forever.
				const tickSources = [ticks(), ticks()] as const;
				const coordinators = [databases[0]!, databases[1]!].map((sql, index) =>
					createPostgresLiveQueryCoordinator({
						program: liveQueryProgram,
						sql,
						hmacKey: new Uint8Array(32).fill(7),
						applicationName,
						deploymentDigest,
						wireVersion: 1,
						tickSource: tickSources[index]!.source,
					}),
				);
				for (const coordinator of coordinators) await coordinator.start();
				let evaluations = 0;
				let body = "durable result";
				const makeCarrier = (coordinator: (typeof coordinators)[number]) =>
					createRealtimeCarrier({
						contract: decodeRealtimeWireContract(projected),
						durableCoordinator: coordinator.durable!,
						resolvePrincipal: () => user,
						decodeContext: (value) => value as typeof context,
						evaluate: async () => {
							evaluations += 1;
							return { result: { nodes: [{ body }] }, observedPlan };
						},
					});
				const carriers = coordinators.map(makeCarrier);
				try {
					const firstStream = await carriers[0]!.fetch(
						request("GET", undefined, "scope:diverge"),
					);
					const firstReader = firstStream?.body?.getReader();
					if (!firstReader) throw new Error("missing realtime stream");
					expect((await nextFrame(firstReader))?.kind).toBe("ready");
					await coordinators[0]!.durable!.requestScan();
					expect(
						(
							await carriers[0]!.fetch(
								request(
									"POST",
									command("open", "binding:diverge", {
										scopeId: "scope:diverge",
									}),
								),
							)
						)?.status,
					).toBe(202);
					tickSources[0].tick();
					await coordinators[0]!.durable!.requestScan();
					expect(await nextFrame(firstReader)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
					});
					expect(evaluations).toBe(1);

					const [generationsBefore] = await databases[0]!<{ count: number }[]>`
						select count(*)::integer as count
						from questpie_internal.realtime_binding_generations
						where application_name = ${applicationName}
						  and scope_identity = 'scope:diverge'
						  and binding_identity = 'binding:diverge'
					`;
					expect(generationsBefore?.count).toBe(1);

					// The fresh root now yields different bytes for the same clean
					// binding. The first holder is left in place, as after a crash.
					body = "diverged result";
					const takeoverStream = await carriers[1]!.fetch(
						request("GET", undefined, "scope:diverge"),
					);
					const takeoverReader = takeoverStream?.body?.getReader();
					if (!takeoverReader) throw new Error("missing takeover stream");
					expect((await nextFrame(takeoverReader))?.kind).toBe("ready");
					tickSources[1].tick();
					await coordinators[1]!.durable!.requestScan();
					const afterFirstScan = evaluations;
					expect(afterFirstScan).toBeGreaterThan(1);

					// The fence holds: further ticks must not recompute the same
					// withheld generation, and nothing may be staged or disclosed.
					for (let attempt = 0; attempt < 3; attempt += 1) {
						tickSources[1].tick();
						await coordinators[1]!.durable!.requestScan();
					}
					expect(evaluations).toBe(afterFirstScan);
					const [generationsAfter] = await databases[0]!<{ count: number }[]>`
						select count(*)::integer as count
						from questpie_internal.realtime_binding_generations
						where application_name = ${applicationName}
						  and scope_identity = 'scope:diverge'
						  and binding_identity = 'binding:diverge'
					`;
					expect(generationsAfter?.count).toBe(1);

					// Freezing evaluations and the generation count does not by itself
					// prove nothing was disclosed: framing the retained bytes would also
					// stop recomputation and stage nothing. Prove non-disclosure by its
					// content. A real invalidation lifts the fence, and the very next
					// frame this connection ever receives must be the freshly authorized
					// result. If the withheld generation had been framed, the first frame
					// here would instead be the stale initial carrying "durable result".
					await captureMessageChange(databases[1]!);
					tickSources[1].tick();
					await coordinators[1]!.durable!.requestScan();
					expect(await nextFrame(takeoverReader)).toMatchObject({
						kind: "delivery",
						bindingId: "binding:diverge",
						payload: { nodes: [{ body: "diverged result" }] },
					});
					const [generationsLifted] = await databases[0]!<
						{ count: number; latest: string }[]
					>`
						select count(*)::integer as count,
						       max(generation)::text as latest
						from questpie_internal.realtime_binding_generations
						where application_name = ${applicationName}
						  and scope_identity = 'scope:diverge'
						  and binding_identity = 'binding:diverge'
					`;
					expect(generationsLifted?.latest).toBe("2");
					await takeoverReader.cancel();
					await firstReader.cancel();
				} finally {
					await Promise.all(carriers.map((carrier) => carrier.drain()));
					await Promise.all(
						coordinators.map((coordinator) => coordinator.drain()),
					);
				}
			},
			20_000,
		);
	},
);
