import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { SQL } from "bun";
import { Client } from "pg";
import { context as contextHelpers, principal } from "questpie";

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
import {
	createRuntimePostgres,
	type PostgresDatabase,
	type PostgresListener,
	type RuntimePostgres,
} from "../../../packages/runtime/src/postgres";

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
const reconnectRole = "questpie_pb04_reconnect";
const reconnectPassword = "questpie-pb04-reconnect";

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

function postgresUrl(
	credentials?: Readonly<{ username: string; password: string }>,
): string {
	const url = new URL("postgres://localhost/postgres");
	if (process.env.PGHOST) url.hostname = process.env.PGHOST;
	if (process.env.PGPORT) url.port = process.env.PGPORT;
	if (credentials) {
		url.username = credentials.username;
		url.password = credentials.password;
	} else {
		if (process.env.PGUSER) url.username = process.env.PGUSER;
		if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	}
	if (process.env.PGDATABASE) url.pathname = `/${process.env.PGDATABASE}`;
	return url.href;
}

function runtimePostgres(
	credentials?: Readonly<{ username: string; password: string }>,
) {
	return createRuntimePostgres(runtimePostgresConfiguration(credentials));
}

function runtimePostgresConfiguration(
	credentials?: Readonly<{ username: string; password: string }>,
) {
	const connectionUrl = postgresUrl(credentials);
	return {
		connectionUrl,
		directConnectionUrl: connectionUrl,
		pool: {
			max: 3,
			connectTimeoutMs: 1_000,
			checkoutTimeoutMs: 1_000,
			idleTimeoutMs: 1_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 10_000,
			lockMs: 1_000,
			idleInTransactionMs: 10_000,
		},
	} as const;
}

async function dropReconnectRole(sql: SQL): Promise<void> {
	await sql`
		select coalesce(
			pg_catalog.bool_or(pg_catalog.pg_terminate_backend(pid)),
			false
		)
		from pg_catalog.pg_stat_activity
		where usename = ${reconnectRole}
		  and pid <> pg_catalog.pg_backend_pid()
	`;
	await sql.unsafe("DROP OWNED BY questpie_pb04_reconnect").catch(() => {});
	await sql.unsafe("DROP ROLE IF EXISTS questpie_pb04_reconnect");
}

async function nextFrameBefore(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	deadlineMs: number,
) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			nextFrame(reader),
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error("realtime frame deadline exceeded")),
					deadlineMs,
				);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function waitUntil(
	condition: () => boolean,
	description: string,
	deadlineMs = 1_000,
): Promise<void> {
	const deadlineAt = Date.now() + deadlineMs;
	while (!condition()) {
		if (Date.now() >= deadlineAt) throw new Error(description);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
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

test("a concurrent drain owns a coordinator listener still starting", async () => {
	let releaseListen!: () => void;
	const listenHeld = new Promise<void>((resolve) => {
		releaseListen = resolve;
	});
	let closes = 0;
	const listener = {
		facts: () => ({
			state: "healthy" as const,
			generation: 1,
			reconnects: 0,
			lastReconciledAt: Date.now(),
		}),
		requestReconcile: () => Promise.resolve(),
		close: async () => {
			closes += 1;
		},
	} satisfies PostgresListener;
	const postgres = {
		transaction: () => Promise.reject(new Error("unexpected transaction")),
		listen: async () => {
			await listenHeld;
			return listener;
		},
	} as unknown as Pick<RuntimePostgres, "transaction" | "listen">;
	const coordinator = createPostgresLiveQueryCoordinator({
		program: liveQueryProgram,
		postgres,
		hmacKey: new Uint8Array(32).fill(7),
		applicationName,
		deploymentDigest,
		wireVersion: 1,
	});

	const starting = coordinator.start();
	const draining = coordinator.drain({ deadlineAt: Date.now() + 2_000 });
	releaseListen();
	await expect(starting).rejects.toThrow("stopped during startup");
	await draining;
	expect(closes).toBe(1);
	await expect(coordinator.durable!.requestScan()).rejects.toThrow("not ready");
});

test("a startup reconciliation consumes the first drain cancellation and cannot resume", async () => {
	let releaseListen!: () => void;
	const listenHeld = new Promise<void>((resolve) => {
		releaseListen = resolve;
	});
	let reconciliationEntered!: () => void;
	const entered = new Promise<void>((resolve) => {
		reconciliationEntered = resolve;
	});
	let closes = 0;
	const closeDeadlines: number[] = [];
	let transactionCalls = 0;
	let transactionUses = 0;
	let reconciliationSignal: AbortSignal | undefined;
	const listener = {
		facts: () => ({
			state: "healthy" as const,
			generation: 1,
			reconnects: 0,
			lastReconciledAt: Date.now(),
		}),
		requestReconcile: () => Promise.resolve(),
		close: async (input) => {
			closes += 1;
			closeDeadlines.push(input.deadlineAt);
		},
	} satisfies PostgresListener;
	const database = {
		async transaction(
			transactionInput: Readonly<{
				control?: Readonly<{ signal?: AbortSignal }>;
				use(transaction: never): Promise<unknown>;
			}>,
		): Promise<unknown> {
			transactionCalls += 1;
			reconciliationSignal = transactionInput.control?.signal;
			reconciliationEntered();
			const signal = reconciliationSignal;
			if (!signal) throw new Error("missing reconciliation signal");
			await new Promise<never>((_resolve, reject) => {
				const aborted = () => reject(signal.reason);
				signal.addEventListener("abort", aborted, { once: true });
				if (signal.aborted) aborted();
			});
			transactionUses += 1;
			return transactionInput.use(undefined as never);
		},
	} as unknown as PostgresDatabase;
	let reconcileAfterDrain!: () => Promise<void>;
	const postgres = {
		transaction: database.transaction.bind(database),
		listen: async (input: Parameters<RuntimePostgres["listen"]>[0]) => {
			reconcileAfterDrain = () =>
				input.reconcile({
					admission: "candidate",
					reason: "notification",
					database,
					signal: new AbortController().signal,
				});
			await input
				.reconcile({
					admission: "candidate",
					reason: "startup",
					database,
					signal: new AbortController().signal,
				})
				.catch(() => {});
			await listenHeld;
			return listener;
		},
	} as unknown as Pick<RuntimePostgres, "transaction" | "listen">;
	const coordinator = createPostgresLiveQueryCoordinator({
		program: liveQueryProgram,
		postgres,
		hmacKey: new Uint8Array(32).fill(7),
		applicationName,
		deploymentDigest,
		wireVersion: 1,
	});

	const starting = coordinator.start();
	await entered;
	const firstDeadlineAt = Date.now() + 25;
	const mutableShutdown = { deadlineAt: firstDeadlineAt };
	const draining = coordinator.drain(mutableShutdown);
	mutableShutdown.deadlineAt += 30_000;
	expect(reconciliationSignal?.aborted).toBe(true);
	await draining;
	expect({ transactionCalls, transactionUses }).toEqual({
		transactionCalls: 1,
		transactionUses: 0,
	});
	await expect(
		Promise.resolve().then(reconcileAfterDrain),
	).rejects.toMatchObject({
		name: "AbortError",
	});
	expect(transactionCalls).toBe(1);

	releaseListen();
	await expect(starting).rejects.toThrow("stopped during startup");
	expect(closes).toBe(1);
	expect(closeDeadlines).toEqual([firstDeadlineAt]);
	expect({ transactionCalls, transactionUses }).toEqual({
		transactionCalls: 1,
		transactionUses: 0,
	});
	await expect(coordinator.durable!.requestScan()).rejects.toThrow("not ready");
});

test("the owner signal drains the database-mode coordinator listener", async () => {
	const controller = new AbortController();
	let closeListener!: () => void;
	const listenerClosed = new Promise<void>((resolve) => {
		closeListener = resolve;
	});
	let closes = 0;
	const listener = {
		facts: () => ({
			state: "healthy" as const,
			generation: 1,
			reconnects: 0,
			lastReconciledAt: Date.now(),
		}),
		requestReconcile: () => Promise.resolve(),
		close: async () => {
			closes += 1;
			closeListener();
		},
	} satisfies PostgresListener;
	const postgres = {
		transaction: () => Promise.reject(new Error("unexpected transaction")),
		listen: () => Promise.resolve(listener),
	} as unknown as Pick<RuntimePostgres, "transaction" | "listen">;
	const coordinator = createPostgresLiveQueryCoordinator({
		program: liveQueryProgram,
		postgres,
		hmacKey: new Uint8Array(32).fill(7),
		applicationName,
		deploymentDigest,
		wireVersion: 1,
		signal: controller.signal,
	});

	await coordinator.start();
	controller.abort();
	await listenerClosed;
	expect(closes).toBe(1);
	await expect(coordinator.durable!.requestScan()).rejects.toThrow("not ready");
});

test("database mode owns one listener fallback and never arms the legacy wake", async () => {
	const tickCalls = { start: 0, request: 0, drain: 0 };
	const hostileTickSource: PostgresWakeTickSource = Object.freeze({
		armInterval() {
			tickCalls.start += 1;
			return () => {
				tickCalls.drain += 1;
			};
		},
		armDeadline() {
			tickCalls.request += 1;
			return () => {};
		},
	});
	const listenerCalls = {
		close: 0,
		fallbackIntervals: [] as number[],
		request: 0,
		start: 0,
	};
	const listener = {
		facts: () => ({
			state: "healthy" as const,
			generation: 1,
			reconnects: 0,
			lastReconciledAt: Date.now(),
		}),
		requestReconcile: () => {
			listenerCalls.request += 1;
			return Promise.resolve();
		},
		close: async () => {
			listenerCalls.close += 1;
		},
	} satisfies PostgresListener;
	const postgres: Pick<RuntimePostgres, "transaction" | "listen"> = {
		transaction: () => Promise.reject(new Error("unexpected transaction")),
		listen(input) {
			listenerCalls.start += 1;
			listenerCalls.fallbackIntervals.push(input.fallbackIntervalMs);
			return Promise.resolve(listener);
		},
	};
	// Deliberately forge the statically disjoint selection at the runtime
	// boundary. Database mode must ignore the legacy tick source completely.
	const coordinator = createPostgresLiveQueryCoordinator({
		program: liveQueryProgram,
		postgres,
		tickSource: hostileTickSource,
		hmacKey: new Uint8Array(32).fill(7),
		applicationName,
		deploymentDigest,
		wireVersion: 1,
	} as unknown as Parameters<typeof createPostgresLiveQueryCoordinator>[0]);

	await coordinator.start();
	expect(listenerCalls).toEqual({
		close: 0,
		fallbackIntervals: [10_000],
		request: 0,
		start: 1,
	});
	expect(tickCalls).toEqual({ start: 0, request: 0, drain: 0 });

	await coordinator.durable!.requestScan();
	expect(listenerCalls.request).toBe(1);
	expect(tickCalls).toEqual({ start: 0, request: 0, drain: 0 });

	await Promise.all([
		coordinator.drain({ deadlineAt: Date.now() + 2_000 }),
		coordinator.drain({ deadlineAt: Date.now() + 2_000 }),
	]);
	expect(listenerCalls).toEqual({
		close: 1,
		fallbackIntervals: [10_000],
		request: 1,
		start: 1,
	});
	expect(tickCalls).toEqual({ start: 0, request: 0, drain: 0 });
	await expect(coordinator.durable!.requestScan()).rejects.toThrow("not ready");
});

describe.skipIf(databases.length === 0)(
	"BETA-07 no-affinity PostgreSQL carrier",
	() => {
		postgresTest(
			"delivers a committed arbitrary-writer change through LISTEN before fallback",
			async () => {
				const postgres = runtimePostgres();
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before notification";
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => ({
						result: { nodes: [{ body }] },
						observedPlan,
					}),
				});
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:listener"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:listener", {
										scopeId: "scope:listener",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before notification" }] },
					});
					// Drain attach/open-triggered work before the writer commits. A later
					// delivery therefore cannot be credited to a queued synthetic scan.
					await coordinator.durable!.requestScan();

					body = "after notification";
					const startedAt = performance.now();
					await databases[2]!.begin(async (writer) => {
						await writer`
							insert into questpie_internal.change_ledger
							(application_name, transaction_id, collection_identity,
							 change_kind, conservative)
							values (${applicationName}, pg_catalog.pg_current_xact_id(),
							        'collection:messages', 'collection', true)
						`;
						await writer`select pg_catalog.pg_notify('questpie_change', '')`;
					});
					expect(await nextFrameBefore(reader, 3_000)).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after notification" }] },
					});
					expect(performance.now() - startedAt).toBeLessThan(10_000);
					await reader.cancel();
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });

					const postDrainAttachment = {
						scopeId: "scope:after-drain",
						principal: user,
						prepare: () => null,
						publish: () => false,
						publishFailure: () => false,
						synchronize() {},
					} as const;
					expect(
						await coordinator.durable!.attach(postDrainAttachment),
					).toBeFalse();
					const postDrainInputBytes = canonicalJsonLine(queryInput);
					expect(
						await coordinator.durable!.open({
							scopeId: "scope:after-drain",
							bindingId: "binding:after-drain",
							principal: user,
							authorityPartitionDigest: "b".repeat(64),
							queryIdentity: "messages.page",
							queryBytes: canonicalJsonLine({
								identity: "query:messages.page",
							}),
							inputBytes: postDrainInputBytes,
							inputDigest: sha256Digest(postDrainInputBytes),
							contextInputBytes: canonicalJsonLine(context),
							resumeRequested: false,
							requestedResumeToken: null,
						}),
					).toBe("unavailable");
					await expect(coordinator.durable!.requestScan()).rejects.toThrow(
						"not ready",
					);
					const [postDrainRows] = await databases[0]!<{ count: number }[]>`
						select count(*)::integer as count
						from questpie_internal.realtime_scope_attachments
						where application_name = ${applicationName}
						  and scope_identity = 'scope:after-drain'
					`;
					expect(postDrainRows?.count).toBe(0);
				} finally {
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await postgres.close({ deadlineAt: Date.now() + 2_000 });
				}
			},
			20_000,
		);

		postgresTest(
			"does not reconcile a rolled-back Change Ledger fact or notification",
			async () => {
				const postgres = runtimePostgres();
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before rollback";
				let evaluations = 0;
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						return { result: { nodes: [{ body }] }, observedPlan };
					},
				});
				const readState = async () => {
					const [state] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							horizon: string;
							invalidation: string;
							latest: string;
							ledger: number;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon,
						       (select count(*)::integer
						          from questpie_internal.change_ledger ledger
						         where ledger.application_name = watch.application_name) as ledger
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:rollback'
						  and watch.binding_identity = 'binding:rollback'
					`;
					if (!state) throw new Error("missing rollback binding state");
					return state;
				};
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:rollback"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:rollback", {
										scopeId: "scope:rollback",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before rollback" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					const before = await readState();

					body = "after rollback";
					await expect(
						databases[2]!.begin(async (writer) => {
							await writer`
								insert into questpie_internal.change_ledger
								(application_name, transaction_id, collection_identity,
								 change_kind, conservative)
								values (${applicationName}, pg_catalog.pg_current_xact_id(),
								        'collection:messages', 'collection', true)
							`;
							await writer`select pg_catalog.pg_notify('questpie_change', '')`;
							throw new Error("deliberate rollback");
						}),
					).rejects.toThrow("deliberate rollback");

					const rolledBackFrame = nextFrame(reader);
					expect(
						await Promise.race([
							rolledBackFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 200),
							),
						]),
					).toEqual({ frame: "none" });
					expect(await readState()).toEqual(before);
					expect(evaluations).toBe(1);

					// Positive control: commit the same ledger insert and NOTIFY through the
					// same writer and listener path. The already-pending read must receive
					// exactly this update, proving the rollback zero is not a dead instrument.
					body = "after commit";
					await databases[2]!.begin(async (writer) => {
						await writer`
							insert into questpie_internal.change_ledger
							(application_name, transaction_id, collection_identity,
							 change_kind, conservative)
							values (${applicationName}, pg_catalog.pg_current_xact_id(),
							        'collection:messages', 'collection', true)
						`;
						await writer`select pg_catalog.pg_notify('questpie_change', '')`;
					});
					expect(await rolledBackFrame).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after commit" }] },
					});
					expect(evaluations).toBe(2);
					const after = await readState();
					expect(after.ledger).toBe(before.ledger + 1);
					expect(BigInt(after.invalidation)).toBe(
						BigInt(before.invalidation) + 1n,
					);
					expect(after.evaluated).toBe(after.invalidation);
					expect(after.generations).toBe(before.generations);
					expect(BigInt(after.latest)).toBe(BigInt(before.latest) + 1n);
					expect(BigInt(after.horizon)).toBeGreaterThan(BigInt(before.horizon));

					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(2);
					const afterIdempotentScan = await readState();
					expect(afterIdempotentScan).toMatchObject({
						evaluated: after.evaluated,
						generations: after.generations,
						invalidation: after.invalidation,
						latest: after.latest,
						ledger: 0,
					});
					expect(BigInt(afterIdempotentScan.horizon)).toBeGreaterThanOrEqual(
						BigInt(after.horizon),
					);
					const duplicateFrame = nextFrame(reader);
					expect(
						await Promise.race([
							duplicateFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					await reader.cancel();
				} finally {
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await postgres.close({ deadlineAt: Date.now() + 2_000 });
				}
			},
			20_000,
		);

		postgresTest(
			"does not publish or resurrect a scope when drain wins during evaluation",
			async () => {
				const runtime = runtimePostgres();
				let listener: PostgresListener | undefined;
				const postgres: Pick<RuntimePostgres, "transaction" | "listen"> =
					Object.freeze({
						transaction: runtime.transaction,
						async listen(input) {
							listener = await runtime.listen(input);
							return listener;
						},
					});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before drain";
				let evaluations = 0;
				let evaluationEntered!: () => void;
				const evaluationEntry = new Promise<void>((resolve) => {
					evaluationEntered = resolve;
				});
				let releaseEvaluation!: () => void;
				const evaluationHeld = new Promise<void>((resolve) => {
					releaseEvaluation = resolve;
				});
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						if (evaluations === 2) {
							evaluationEntered();
							await evaluationHeld;
						}
						return { result: { nodes: [{ body }] }, observedPlan };
					},
				});
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:drain-in-flight"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:drain-in-flight", {
										scopeId: "scope:drain-in-flight",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before drain" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					const [beforeDrain] = await databases[0]!<
						{ generations: number; latest: string }[]
					>`
						select generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:drain-in-flight'
						  and watch.binding_identity = 'binding:drain-in-flight'
					`;
					expect(beforeDrain).toEqual({ generations: 1, latest: "1" });

					body = "must not publish";
					await databases[2]!.begin(async (writer) => {
						await writer`
							insert into questpie_internal.change_ledger
							(application_name, transaction_id, collection_identity,
							 change_kind, conservative)
							values (${applicationName}, pg_catalog.pg_current_xact_id(),
							        'collection:messages', 'collection', true)
						`;
						await writer`select pg_catalog.pg_notify('questpie_change', '')`;
					});
					await Promise.race([
						evaluationEntry,
						new Promise<never>((_resolve, reject) =>
							setTimeout(
								() => reject(new Error("draining evaluation did not start")),
								2_000,
							),
						),
					]);
					const pendingFrame = nextFrame(reader);
					const draining = coordinator.drain({
						deadlineAt: Date.now() + 2_000,
					});
					expect(
						await Promise.race([
							draining.then(() => "resolved" as const),
							new Promise<"pending">((resolve) =>
								setTimeout(() => resolve("pending"), 100),
							),
						]),
					).toBe("pending");
					releaseEvaluation();
					await draining;
					expect(evaluations).toBe(2);
					expect(listener?.facts()).toMatchObject({ state: "closed" });
					expect(runtime.facts().listener).toBe("disabled");
					await expect(coordinator.durable!.requestScan()).rejects.toThrow(
						"not ready",
					);

					const [durable] = await databases[0]!<
						{
							generations: number;
							scopes: number;
							state: string | null;
							watches: number;
						}[]
					>`
						select
						  (select count(*)::integer
						     from questpie_internal.realtime_scope_attachments scope
						    where scope.application_name = ${applicationName}
						      and scope.scope_identity = 'scope:drain-in-flight') as scopes,
						  (select scope.state
						     from questpie_internal.realtime_scope_attachments scope
						    where scope.application_name = ${applicationName}
						      and scope.scope_identity = 'scope:drain-in-flight') as state,
						  (select count(*)::integer
						     from questpie_internal.realtime_watch_bindings watch
						    where watch.application_name = ${applicationName}
						      and watch.scope_identity = 'scope:drain-in-flight') as watches,
						  (select count(*)::integer
						     from questpie_internal.realtime_binding_generations generation
						    where generation.application_name = ${applicationName}
						      and generation.scope_identity = 'scope:drain-in-flight') as generations
					`;
					expect(durable).toEqual({
						generations: 0,
						scopes: 1,
						state: "withdrawn",
						watches: 0,
					});
					expect(
						await Promise.race([
							pendingFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					await reader.cancel();
				} finally {
					releaseEvaluation();
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await runtime.close({ deadlineAt: Date.now() + 2_000 });
				}
			},
			20_000,
		);

		postgresTest(
			"admits coordinator evaluation only after a Runtime generation swap",
			async () => {
				const postgres = runtimePostgres();
				let candidateReconciled!: () => void;
				const candidateReconciliation = new Promise<void>((resolve) => {
					candidateReconciled = resolve;
				});
				let releaseCandidate!: () => void;
				const candidateHeld = new Promise<void>((resolve) => {
					releaseCandidate = resolve;
				});
				const coordinatorPostgres = Object.freeze({
					transaction: postgres.transaction,
					listen: (input: Parameters<typeof postgres.listen>[0]) =>
						postgres.listen({
							...input,
							reconcile: async (reconciliation) => {
								await input.reconcile(reconciliation);
								if (reconciliation.admission === "candidate") {
									candidateReconciled();
									await candidateHeld;
								}
							},
						}),
				});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres: coordinatorPostgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before rotation";
				let evaluations = 0;
				const evaluationGenerations: number[] = [];
				let evaluationEntered!: () => void;
				const evaluationEntry = new Promise<void>((resolve) => {
					evaluationEntered = resolve;
				});
				let releaseEvaluation!: () => void;
				const evaluationHeld = new Promise<void>((resolve) => {
					releaseEvaluation = resolve;
				});
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						evaluationGenerations.push(postgres.facts().generation);
						if (evaluations === 2) {
							evaluationEntered();
							await evaluationHeld;
						}
						return { result: { nodes: [{ body }] }, observedPlan };
					},
				});
				const readBinding = async () => {
					const [state] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:rotation'
						  and watch.binding_identity = 'binding:rotation'
					`;
					if (!state) throw new Error("missing rotation binding state");
					return state;
				};
				let releaseVerification!: () => void;
				const verificationHeld = new Promise<void>((resolve) => {
					releaseVerification = resolve;
				});
				let verificationEntered!: () => void;
				const verificationEntry = new Promise<void>((resolve) => {
					verificationEntered = resolve;
				});
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:rotation"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:rotation", {
										scopeId: "scope:rotation",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before rotation" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					expect(evaluationGenerations).toEqual([1]);
					const before = await readBinding();
					const pendingFrame = nextFrame(reader);

					const rotating = postgres.rotate({
						configuration: runtimePostgresConfiguration(),
						deadlineAt: Date.now() + 3_000,
						verify: async () => {
							verificationEntered();
							await verificationHeld;
						},
					});
					await verificationEntry;
					body = "after successful rotation";
					await captureMessageChange(databases[2]!);
					expect(postgres.facts()).toMatchObject({
						state: "rotating",
						generation: 1,
					});
					expect(evaluations).toBe(1);
					expect(
						await Promise.race([
							pendingFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });

					releaseVerification();
					await Promise.race([
						candidateReconciliation,
						new Promise<never>((_resolve, reject) =>
							setTimeout(
								() =>
									reject(new Error("candidate reconciliation did not finish")),
								2_000,
							),
						),
					]);
					expect(postgres.facts()).toMatchObject({
						state: "rotating",
						generation: 1,
					});
					expect(evaluations).toBe(1);
					expect(evaluationGenerations).toEqual([1]);
					const candidateResult = await readBinding();
					expect(BigInt(candidateResult.invalidation)).toBe(
						BigInt(before.invalidation) + 1n,
					);
					expect(candidateResult.evaluated).toBe(before.evaluated);
					expect(candidateResult.latest).toBe(before.latest);
					expect(candidateResult.generations).toBe(before.generations);
					expect(
						await Promise.race([
							pendingFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });

					releaseCandidate();
					await Promise.race([
						evaluationEntry,
						new Promise<never>((_resolve, reject) =>
							setTimeout(
								() => reject(new Error("post-swap evaluation did not start")),
								2_000,
							),
						),
					]);
					expect(postgres.facts()).toMatchObject({ generation: 2 });
					expect(evaluationGenerations).toEqual([1, 2]);

					releaseEvaluation();
					await rotating;
					expect(await pendingFrame).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after successful rotation" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(2);
					const afterSuccess = await readBinding();
					expect(afterSuccess.evaluated).toBe(afterSuccess.invalidation);
					expect(BigInt(afterSuccess.latest)).toBe(BigInt(before.latest) + 1n);

					const unreachable = new URL(postgresUrl());
					unreachable.port = "1";
					const retainedWinnerFrame = nextFrame(reader);
					await expect(
						postgres.rotate({
							configuration: {
								...runtimePostgresConfiguration(),
								directConnectionUrl: unreachable.href,
							},
							deadlineAt: Date.now() + 2_000,
							verify: () => Promise.resolve(),
						}),
					).rejects.toMatchObject({ phase: "connect" });
					expect(postgres.facts()).toMatchObject({
						state: "ready",
						generation: 2,
						counters: { rotations: 1 },
					});
					expect(
						await Promise.race([
							retainedWinnerFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });

					body = "after failed rotation";
					await databases[2]!.begin(async (writer) => {
						await captureMessageChange(writer);
						await writer`select pg_catalog.pg_notify('questpie_change', '')`;
					});
					expect(await retainedWinnerFrame).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after failed rotation" }] },
					});
					expect(evaluations).toBe(3);
					expect(evaluationGenerations).toEqual([1, 2, 2]);
					expect(postgres.facts()).toMatchObject({
						generation: 2,
						counters: { rotations: 1 },
					});
					await reader.cancel();
				} finally {
					releaseVerification();
					releaseCandidate();
					releaseEvaluation();
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await postgres.close({ deadlineAt: Date.now() + 2_000 });
				}
			},
			20_000,
		);

		postgresTest(
			"normalizes coordinator storage and callback failures and recovers",
			async () => {
				await dropReconnectRole(databases[2]!);
				await databases[2]!.unsafe(
					`CREATE ROLE ${reconnectRole} LOGIN PASSWORD '${reconnectPassword}'`,
				);
				await databases[2]!.unsafe(
					`GRANT USAGE ON SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				await databases[2]!.unsafe(
					`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				await databases[2]!.unsafe(
					`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				const postgres = runtimePostgres({
					username: reconnectRole,
					password: reconnectPassword,
				});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before reconciliation failures";
				let evaluations = 0;
				let failObservedPlan = false;
				const callbackDetail = "qp-sensitive-coordinator-callback-detail";
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						return { result: { nodes: [{ body }] }, observedPlan };
					},
					onObservedPlan: () => {
						if (failObservedPlan) throw new Error(callbackDetail);
					},
				});
				const readBinding = async () => {
					const [state] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:reconcile-failure'
						  and watch.binding_identity = 'binding:reconcile-failure'
					`;
					if (!state) throw new Error("missing reconciliation failure state");
					return state;
				};
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:reconcile-failure"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:reconcile-failure", {
										scopeId: "scope:reconcile-failure",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before reconciliation failures" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					const baseline = await readBinding();

					body = "after storage recovery";
					await captureMessageChange(databases[2]!);
					await databases[2]!.unsafe(
						`REVOKE SELECT ON questpie_internal.change_ledger FROM ${reconnectRole}`,
					);
					const storageFailure = await coordinator
						.durable!.requestScan()
						.catch((error: unknown) => error);
					expect(JSON.parse(JSON.stringify(storageFailure))).toEqual({
						name: "QuestpiePostgresError",
						code: "queryFailed",
						phase: "reconcile",
						statementName: "live-query.change-ledger-facts-read",
						sqlState: "42501",
						retry: "never",
					});
					expect(JSON.stringify(storageFailure)).not.toContain(
						reconnectPassword,
					);
					expect(String(storageFailure)).not.toContain(reconnectRole);
					expect(String(storageFailure)).not.toContain(reconnectPassword);
					expect(await readBinding()).toEqual(baseline);
					expect(evaluations).toBe(1);
					expect(postgres.facts().listener).toMatchObject({
						state: "healthy",
						generation: 1,
						reconnects: 0,
					});

					await databases[2]!.unsafe(
						`GRANT SELECT ON questpie_internal.change_ledger TO ${reconnectRole}`,
					);
					const storageRecoveryFrame = nextFrame(reader);
					await databases[2]!`
						select pg_catalog.pg_notify('questpie_change', 'storage-recovery')
					`;
					expect(await storageRecoveryFrame).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after storage recovery" }] },
					});
					await coordinator.durable!.requestScan();
					const afterStorageRecovery = await readBinding();
					expect(BigInt(afterStorageRecovery.invalidation)).toBe(
						BigInt(baseline.invalidation) + 1n,
					);
					expect(afterStorageRecovery.evaluated).toBe(
						afterStorageRecovery.invalidation,
					);
					expect(BigInt(afterStorageRecovery.latest)).toBe(
						BigInt(baseline.latest) + 1n,
					);
					expect(evaluations).toBe(2);

					body = "after callback recovery";
					await captureMessageChange(databases[2]!);
					failObservedPlan = true;
					const callbackFrame = nextFrame(reader);
					const callbackFailure = await coordinator
						.durable!.requestScan()
						.catch((error: unknown) => error);
					expect(JSON.parse(JSON.stringify(callbackFailure))).toEqual({
						name: "QuestpiePostgresError",
						code: "queryFailed",
						phase: "reconcile",
						retry: "never",
					});
					expect(JSON.stringify(callbackFailure)).not.toContain(callbackDetail);
					expect(String(callbackFailure)).not.toContain(callbackDetail);
					expect(
						await Promise.race([
							callbackFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					const afterCallbackFailure = await readBinding();
					expect(BigInt(afterCallbackFailure.invalidation)).toBe(
						BigInt(afterStorageRecovery.invalidation) + 1n,
					);
					expect(afterCallbackFailure.evaluated).toBe(
						afterCallbackFailure.invalidation,
					);
					expect(BigInt(afterCallbackFailure.latest)).toBe(
						BigInt(afterStorageRecovery.latest) + 1n,
					);
					expect(evaluations).toBe(3);

					failObservedPlan = false;
					await databases[2]!`
						select pg_catalog.pg_notify('questpie_change', 'callback-recovery')
					`;
					expect(await callbackFrame).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after callback recovery" }] },
					});
					const noDuplicateFrame = nextFrame(reader);
					await coordinator.durable!.requestScan();
					expect(await readBinding()).toEqual(afterCallbackFailure);
					expect(evaluations).toBe(4);
					expect(
						await Promise.race([
							noDuplicateFrame.then((frame) => ({ frame })),
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					expect(postgres.facts().listener).toMatchObject({
						state: "healthy",
						generation: 1,
						reconnects: 0,
					});
					await reader.cancel();
				} finally {
					await databases[2]!
						.unsafe(
							`GRANT SELECT ON questpie_internal.change_ledger TO ${reconnectRole}`,
						)
						.catch(() => {});
					try {
						await carrier.drain({ deadlineAt: Date.now() + 2_000 });
						await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
						await postgres.close({ deadlineAt: Date.now() + 2_000 });
					} finally {
						await postgres
							.close({ deadlineAt: Date.now() + 2_000 })
							.catch(() => {});
						await dropReconnectRole(databases[2]!);
					}
				}
			},
			20_000,
		);

		postgresTest(
			"reconciles a committed Change Ledger fact after the listener loses its wake",
			async () => {
				await dropReconnectRole(databases[2]!);
				await databases[2]!.unsafe(
					`CREATE ROLE ${reconnectRole} LOGIN PASSWORD '${reconnectPassword}'`,
				);
				await databases[2]!.unsafe(
					`GRANT USAGE ON SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				await databases[2]!.unsafe(
					`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				await databases[2]!.unsafe(
					`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA questpie_internal TO ${reconnectRole}`,
				);
				const postgres = runtimePostgres({
					username: reconnectRole,
					password: reconnectPassword,
				});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before disconnect";
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => ({
						result: { nodes: [{ body }] },
						observedPlan,
					}),
				});
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:lost-wake"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:lost-wake", {
										scopeId: "scope:lost-wake",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before disconnect" }] },
					});
					await coordinator.durable!.requestScan();

					body = "after lost wake";
					const startedAt = performance.now();
					await databases[2]!.unsafe(`ALTER ROLE ${reconnectRole} NOLOGIN`);
					await databases[2]!.begin(async (writer) => {
						const [terminated] = await writer<{ terminated: boolean }[]>`
							select coalesce(
								pg_catalog.bool_or(pg_catalog.pg_terminate_backend(pid)),
								false
							) as terminated
							from pg_catalog.pg_stat_activity
							where application_name = 'questpie-realtime-listener'
							  and usename = ${reconnectRole}
							  and datname = pg_catalog.current_database()
							  and pid <> pg_catalog.pg_backend_pid()
						`;
						expect(terminated?.terminated).toBeTrue();
						await writer`
							insert into questpie_internal.change_ledger
							(application_name, transaction_id, collection_identity,
							 change_kind, conservative)
							values (${applicationName}, pg_catalog.pg_current_xact_id(),
							        'collection:messages', 'collection', true)
						`;
					});
					await databases[2]!.unsafe(`ALTER ROLE ${reconnectRole} LOGIN`);

					// There is deliberately no NOTIFY and the fallback interval is 10 s.
					// Delivery inside this deadline therefore comes from the real listener's
					// reconnect reconciliation through the coordinator Change Ledger path.
					expect(await nextFrameBefore(reader, 3_000)).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after lost wake" }] },
					});
					expect(performance.now() - startedAt).toBeLessThan(10_000);
					await waitUntil(
						() =>
							postgres.facts().listener !== "disabled" &&
							postgres.facts().listener.state === "healthy",
						"listener did not become healthy after reconnect reconciliation",
					);
					expect(postgres.facts().listener).toMatchObject({
						state: "healthy",
						generation: 2,
						reconnects: 1,
					});
					await reader.cancel();
				} finally {
					await databases[2]!
						.unsafe(`ALTER ROLE ${reconnectRole} LOGIN`)
						.catch(() => {});
					try {
						await carrier.drain({ deadlineAt: Date.now() + 2_000 });
						await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
						await postgres.close({ deadlineAt: Date.now() + 2_000 });
					} finally {
						await postgres
							.close({ deadlineAt: Date.now() + 2_000 })
							.catch(() => {});
						await dropReconnectRole(databases[2]!);
					}
				}
			},
			20_000,
		);

		postgresTest(
			"reconciles an absent wake through the healthy listener periodic fallback",
			async () => {
				const runtime = runtimePostgres();
				const reconciliationReasons: string[] = [];
				const postgres: Pick<RuntimePostgres, "transaction" | "listen"> =
					Object.freeze({
						transaction: runtime.transaction,
						listen(input) {
							return runtime.listen({
								...input,
								async reconcile(reconciliation) {
									reconciliationReasons.push(reconciliation.reason);
									await input.reconcile(reconciliation);
								},
							});
						},
					});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before periodic fallback";
				let evaluations = 0;
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						return { result: { nodes: [{ body }] }, observedPlan };
					},
				});
				try {
					await coordinator.start();
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:periodic-fallback"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:periodic-fallback", {
										scopeId: "scope:periodic-fallback",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before periodic fallback" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					expect(runtime.facts().listener).toMatchObject({
						state: "healthy",
						generation: 1,
						reconnects: 0,
					});
					const reasonBoundary = reconciliationReasons.length;
					const [before] = await databases[0]!<
						{
							evaluated: string;
							horizon: string;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:periodic-fallback'
						  and watch.binding_identity = 'binding:periodic-fallback'
					`;
					if (!before) throw new Error("missing periodic-fallback binding");

					body = "after periodic fallback";
					const committedAt = performance.now();
					await databases[2]!`
						insert into questpie_internal.change_ledger
						(application_name, transaction_id, collection_identity,
						 change_kind, conservative)
						values (${applicationName}, pg_catalog.pg_current_xact_id(),
						        'collection:messages', 'collection', true)
					`;
					// Deliberately no NOTIFY and no manual requestScan: the production
					// coordinator configures the healthy listener fallback at 10 seconds.
					expect(await nextFrameBefore(reader, 14_000)).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after periodic fallback" }] },
					});
					const fallbackDelay = performance.now() - committedAt;
					expect(fallbackDelay).toBeGreaterThanOrEqual(8_000);
					expect(fallbackDelay).toBeLessThan(14_000);
					expect(reconciliationReasons.slice(reasonBoundary)).toEqual([
						"periodic",
					]);
					expect(runtime.facts().listener).toMatchObject({
						state: "healthy",
						generation: 1,
						reconnects: 0,
					});
					expect(evaluations).toBe(2);

					const [after] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							horizon: string;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:periodic-fallback'
						  and watch.binding_identity = 'binding:periodic-fallback'
					`;
					if (!after) throw new Error("missing periodic-fallback result");
					expect(BigInt(after.invalidation)).toBe(
						BigInt(before.invalidation) + 1n,
					);
					expect(after.evaluated).toBe(after.invalidation);
					expect(after.generations).toBe(1);
					expect(after.latest).toBe("2");
					expect(BigInt(after.horizon)).toBeGreaterThan(BigInt(before.horizon));

					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(2);
					const [afterIdempotentScan] = await databases[0]!<
						{ evaluated: string; invalidation: string; latest: string }[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:periodic-fallback'
						  and watch.binding_identity = 'binding:periodic-fallback'
					`;
					expect(afterIdempotentScan).toEqual({
						evaluated: after.evaluated,
						invalidation: after.invalidation,
						latest: "2",
					});
					const unexpected = nextFrame(reader).then((frame) => ({ frame }));
					expect(
						await Promise.race([
							unexpected,
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					await reader.cancel();
				} finally {
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await runtime.close({ deadlineAt: Date.now() + 2_000 });
				}
			},
			20_000,
		);

		postgresTest(
			"recovers an unprocessed fact during independent Runtime startup",
			async () => {
				const crashedRuntime = runtimePostgres();
				const crashedCoordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres: crashedRuntime,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let crashedEvaluations = 0;
				const crashedCarrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: crashedCoordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						crashedEvaluations += 1;
						return {
							result: { nodes: [{ body: "before process replacement" }] },
							observedPlan,
						};
					},
				});
				let crashedReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
				let replacementRuntime: ReturnType<typeof runtimePostgres> | undefined;
				let replacementCoordinator:
					| ReturnType<typeof createPostgresLiveQueryCoordinator>
					| undefined;
				let replacementCarrier:
					| ReturnType<typeof createRealtimeCarrier>
					| undefined;
				let replacementReader:
					| ReadableStreamDefaultReader<Uint8Array>
					| undefined;
				try {
					await crashedCoordinator.start();
					const stream = await crashedCarrier.fetch(
						request("GET", undefined, "scope:process-replacement"),
					);
					crashedReader = stream?.body?.getReader();
					if (!crashedReader) throw new Error("missing crashed Runtime stream");
					expect((await nextFrameBefore(crashedReader, 2_000))?.kind).toBe(
						"ready",
					);
					expect(
						(
							await crashedCarrier.fetch(
								request(
									"POST",
									command("open", "binding:process-replacement", {
										scopeId: "scope:process-replacement",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(crashedReader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before process replacement" }] },
					});
					await crashedCoordinator.durable!.requestScan();
					expect(crashedEvaluations).toBe(1);
					const [beforeCrash] = await databases[0]!<
						{
							evaluated: string;
							holderGeneration: string;
							horizon: string;
							invalidation: string;
							latest: string;
							state: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       scope.holder_generation::text as "holderGeneration",
						       scope.state,
						       generation.generation::text as latest,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_scope_attachments scope
						  on scope.application_name = watch.application_name
						 and scope.scope_identity = watch.scope_identity
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:process-replacement'
						  and watch.binding_identity = 'binding:process-replacement'
					`;
					if (!beforeCrash) throw new Error("missing pre-crash binding");
					expect(beforeCrash.state).toBe("open");
					expect(beforeCrash.holderGeneration).toBe("1");
					expect(beforeCrash.evaluated).toBe(beforeCrash.invalidation);
					expect(beforeCrash.latest).toBe("1");

					// This is the crash boundary. It closes all PostgreSQL resources but
					// deliberately does not call either owner drain, so no durable scope or
					// watch withdrawal can run before the replacement takes over.
					await crashedRuntime.close({ deadlineAt: Date.now() + 2_000 });
					expect(crashedRuntime.facts()).toMatchObject({
						state: "closed",
						listener: { state: "closed" },
					});
					const [afterProcessLoss] = await databases[0]!<
						{ holderGeneration: string; state: string }[]
					>`
						select holder_generation::text as "holderGeneration", state
						from questpie_internal.realtime_scope_attachments
						where application_name = ${applicationName}
						  and scope_identity = 'scope:process-replacement'
					`;
					expect(afterProcessLoss).toEqual({
						holderGeneration: "1",
						state: "open",
					});

					const [committed] = await databases[2]!<{ factIdentity: string }[]>`
						insert into questpie_internal.change_ledger
						(application_name, transaction_id, collection_identity,
						 change_kind, conservative)
						values (${applicationName}, pg_catalog.pg_current_xact_id(),
						        'collection:messages', 'collection', true)
						returning fact_identity::text as "factIdentity"
					`;
					if (!committed) throw new Error("missing committed crash fact");
					const [unprocessed] = await databases[0]!<
						{ facts: number; processed: number }[]
					>`
						select
						  (select count(*)::integer
						     from questpie_internal.change_ledger fact
						    where fact.application_name = ${applicationName}
						      and fact.fact_identity = ${committed.factIdentity}) as facts,
						  (select count(*)::integer
						     from questpie_internal.processed_change_facts processed
						    where processed.application_name = ${applicationName}
						      and processed.consumer_id = ${`realtime:deployment:${deploymentDigest}`}
						      and processed.fact_identity = ${committed.factIdentity}) as processed
					`;
					expect(unprocessed).toEqual({ facts: 1, processed: 0 });
					const staleFrame = nextFrame(crashedReader).then((frame) => ({
						frame,
					}));

					replacementRuntime = runtimePostgres();
					const replacementReasons: string[] = [];
					const replacementPostgres: Pick<
						RuntimePostgres,
						"transaction" | "listen"
					> = Object.freeze({
						transaction: replacementRuntime.transaction,
						listen(input) {
							return replacementRuntime!.listen({
								...input,
								async reconcile(reconciliation) {
									replacementReasons.push(reconciliation.reason);
									await input.reconcile(reconciliation);
								},
							});
						},
					});
					replacementCoordinator = createPostgresLiveQueryCoordinator({
						program: liveQueryProgram,
						postgres: replacementPostgres,
						hmacKey: new Uint8Array(32).fill(7),
						applicationName,
						deploymentDigest,
						wireVersion: 1,
					});
					let replacementEvaluations = 0;
					replacementCarrier = createRealtimeCarrier({
						contract: decodeRealtimeWireContract(projected),
						durableCoordinator: replacementCoordinator.durable!,
						resolvePrincipal: () => user,
						decodeContext: (value) => value as typeof context,
						evaluate: async () => {
							replacementEvaluations += 1;
							return {
								result: { nodes: [{ body: "after startup recovery" }] },
								observedPlan,
							};
						},
					});
					await replacementCoordinator.start();
					expect(replacementEvaluations).toBe(0);
					expect(replacementReasons).toEqual(["startup"]);
					expect(replacementRuntime.facts().listener).toMatchObject({
						state: "healthy",
						generation: 1,
						reconnects: 0,
					});
					const [startupRecovered] = await databases[0]!<
						{
							evaluated: string;
							facts: number;
							horizon: string;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.change_ledger fact
						         where fact.application_name = watch.application_name
						           and fact.fact_identity = ${committed.factIdentity}) as facts,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:process-replacement'
						  and watch.binding_identity = 'binding:process-replacement'
					`;
					if (!startupRecovered)
						throw new Error("replacement startup did not recover binding");
					expect(startupRecovered.facts).toBe(0);
					expect(BigInt(startupRecovered.invalidation)).toBe(
						BigInt(beforeCrash.invalidation) + 1n,
					);
					expect(startupRecovered.evaluated).toBe(beforeCrash.evaluated);
					expect(startupRecovered.latest).toBe("1");
					expect(BigInt(startupRecovered.horizon)).toBeGreaterThan(
						BigInt(beforeCrash.horizon),
					);

					const replacementStream = await replacementCarrier.fetch(
						request("GET", undefined, "scope:process-replacement"),
					);
					replacementReader = replacementStream?.body?.getReader();
					if (!replacementReader)
						throw new Error("missing replacement Runtime stream");
					expect((await nextFrameBefore(replacementReader, 2_000))?.kind).toBe(
						"ready",
					);
					expect(await nextFrameBefore(replacementReader, 2_000)).toMatchObject(
						{
							kind: "delivery",
							delivery: "update",
							payload: { nodes: [{ body: "after startup recovery" }] },
						},
					);
					expect(replacementEvaluations).toBe(1);
					await replacementCoordinator.durable!.requestScan();
					expect(replacementEvaluations).toBe(1);
					const [recovered] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							holderGeneration: string;
							invalidation: string;
							latest: string;
							state: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       scope.holder_generation::text as "holderGeneration",
						       scope.state,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_scope_attachments scope
						  on scope.application_name = watch.application_name
						 and scope.scope_identity = watch.scope_identity
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:process-replacement'
						  and watch.binding_identity = 'binding:process-replacement'
					`;
					expect(recovered).toEqual({
						evaluated: startupRecovered.invalidation,
						generations: 1,
						holderGeneration: "2",
						invalidation: startupRecovered.invalidation,
						latest: "2",
						state: "open",
					});

					const duplicate = nextFrame(replacementReader).then((frame) => ({
						frame,
					}));
					expect(
						await Promise.race([
							duplicate,
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					expect(
						await Promise.race([
							staleFrame,
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
				} finally {
					await replacementReader?.cancel().catch(() => {});
					await crashedReader?.cancel().catch(() => {});
					await replacementCarrier
						?.drain({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
					await replacementCoordinator
						?.drain({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
					await replacementRuntime
						?.close({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
					// Cleanup is intentionally after every recovery assertion. Running it
					// earlier would turn the crash boundary into a graceful withdrawal.
					await crashedCarrier
						.drain({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
					await crashedCoordinator
						.drain({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
					await crashedRuntime
						.close({ deadlineAt: Date.now() + 2_000 })
						.catch(() => {});
				}
			},
			20_000,
		);

		postgresTest(
			"coalesces duplicate PostgreSQL wakes into one monotonic Live Query result",
			async () => {
				const runtime = runtimePostgres();
				const reconciliationReasons: string[] = [];
				let listener: PostgresListener | undefined;
				const postgres: Pick<RuntimePostgres, "transaction" | "listen"> =
					Object.freeze({
						transaction: runtime.transaction,
						async listen(input) {
							listener = await runtime.listen({
								...input,
								async reconcile(reconciliation) {
									reconciliationReasons.push(reconciliation.reason);
									await input.reconcile(reconciliation);
								},
							});
							return listener;
						},
					});
				const coordinator = createPostgresLiveQueryCoordinator({
					program: liveQueryProgram,
					postgres,
					hmacKey: new Uint8Array(32).fill(7),
					applicationName,
					deploymentDigest,
					wireVersion: 1,
				});
				let body = "before coalesced wakes";
				let evaluations = 0;
				let updateEntered!: () => void;
				const updateEntry = new Promise<void>((resolve) => {
					updateEntered = resolve;
				});
				let releaseUpdate!: () => void;
				const updateHeld = new Promise<void>((resolve) => {
					releaseUpdate = resolve;
				});
				const notificationControlChannel = "questpie_pb04_notify_control";
				const notificationControl = new Client({
					connectionString: postgresUrl(),
					application_name: "questpie-pb04-notification-control",
				});
				const controlNotifications: string[] = [];
				notificationControl.on("notification", (message) => {
					if (message.channel === notificationControlChannel)
						controlNotifications.push(message.payload ?? "");
				});
				const carrier = createRealtimeCarrier({
					contract: decodeRealtimeWireContract(projected),
					durableCoordinator: coordinator.durable!,
					resolvePrincipal: () => user,
					decodeContext: (value) => value as typeof context,
					evaluate: async () => {
						evaluations += 1;
						if (evaluations === 2) {
							updateEntered();
							await updateHeld;
						}
						return { result: { nodes: [{ body }] }, observedPlan };
					},
				});
				try {
					await notificationControl.connect();
					await notificationControl.query(
						'LISTEN "questpie_pb04_notify_control"',
					);
					await coordinator.start();
					if (!listener) throw new Error("missing PostgreSQL listener");
					const stream = await carrier.fetch(
						request("GET", undefined, "scope:coalesced-wakes"),
					);
					const reader = stream?.body?.getReader();
					if (!reader) throw new Error("missing realtime stream");
					expect((await nextFrameBefore(reader, 2_000))?.kind).toBe("ready");
					expect(
						(
							await carrier.fetch(
								request(
									"POST",
									command("open", "binding:coalesced-wakes", {
										scopeId: "scope:coalesced-wakes",
									}),
								),
							)
						)?.status,
					).toBe(202);
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "initial",
						payload: { nodes: [{ body: "before coalesced wakes" }] },
					});
					await coordinator.durable!.requestScan();
					expect(evaluations).toBe(1);
					const notificationReasonsBefore = reconciliationReasons.filter(
						(reason) => reason === "notification",
					).length;
					const [before] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							horizon: string;
							invalidation: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations generation
						         where generation.application_name = watch.application_name
						           and generation.scope_identity = watch.scope_identity
						           and generation.binding_identity = watch.binding_identity) as generations,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:coalesced-wakes'
						  and watch.binding_identity = 'binding:coalesced-wakes'
					`;
					if (!before) throw new Error("missing coalesced-wake binding");

					body = "after coalesced wakes";
					await databases[2]!.begin(async (writer) => {
						await writer`
							insert into questpie_internal.change_ledger
							(application_name, transaction_id, collection_identity,
							 change_kind, conservative)
							select ${applicationName}, pg_catalog.pg_current_xact_id(),
							       'collection:messages', 'collection', true
							from pg_catalog.generate_series(1, 3)
						`;
						for (let duplicate = 0; duplicate < 5; duplicate += 1)
							await writer`select pg_catalog.pg_notify('questpie_change', 'same')`;
						for (let duplicate = 0; duplicate < 5; duplicate += 1)
							await writer`
								select pg_catalog.pg_notify(${notificationControlChannel}, 'same')
							`;
					});
					await Promise.race([
						updateEntry,
						new Promise<never>((_resolve, reject) =>
							setTimeout(
								() => reject(new Error("coalesced update did not start")),
								2_000,
							),
						),
					]);
					await waitUntil(
						() => controlNotifications.length === 1,
						"PostgreSQL did not coalesce identical notifications",
					);
					expect(controlNotifications).toEqual(["same"]);

					await databases[2]!.begin(async (writer) => {
						for (let distinct = 0; distinct < 5; distinct += 1)
							await writer`
								select pg_catalog.pg_notify(
									${notificationControlChannel},
									${`distinct-${distinct}`}
								)
							`;
					});
					await waitUntil(
						() => controlNotifications.length === 6,
						"PostgreSQL distinct-notification control did not fire",
					);
					expect(controlNotifications).toEqual([
						"same",
						"distinct-0",
						"distinct-1",
						"distinct-2",
						"distinct-3",
						"distinct-4",
					]);
					const queued = Array.from({ length: 5 }, () =>
						listener!.requestReconcile(),
					);
					releaseUpdate();
					expect(await nextFrameBefore(reader, 2_000)).toMatchObject({
						kind: "delivery",
						delivery: "update",
						payload: { nodes: [{ body: "after coalesced wakes" }] },
					});
					await Promise.all(queued);
					expect(
						reconciliationReasons.filter((reason) => reason === "notification")
							.length - notificationReasonsBefore,
					).toBe(2);
					await coordinator.durable!.requestScan();

					const [after] = await databases[0]!<
						{
							evaluated: string;
							generations: number;
							horizon: string;
							invalidation: string;
							latest: string;
						}[]
					>`
						select watch.invalidation_generation::text as invalidation,
						       watch.evaluated_invalidation_generation::text as evaluated,
						       generation.generation::text as latest,
						       (select count(*)::integer
						          from questpie_internal.realtime_binding_generations all_generations
						         where all_generations.application_name = watch.application_name
						           and all_generations.scope_identity = watch.scope_identity
						           and all_generations.binding_identity = watch.binding_identity) as generations,
						       (select consumer.xid_horizon::text
						          from questpie_internal.reconciliation_consumers consumer
						         where consumer.application_name = watch.application_name
						           and consumer.consumer_id = ${`realtime:deployment:${deploymentDigest}`}) as horizon
						from questpie_internal.realtime_watch_bindings watch
						join questpie_internal.realtime_binding_generations generation
						  on generation.application_name = watch.application_name
						 and generation.scope_identity = watch.scope_identity
						 and generation.binding_identity = watch.binding_identity
						 and generation.latest_slot = 1
						where watch.application_name = ${applicationName}
						  and watch.scope_identity = 'scope:coalesced-wakes'
						  and watch.binding_identity = 'binding:coalesced-wakes'
					`;
					if (!after) throw new Error("missing coalesced-wake result");
					expect(BigInt(after.invalidation)).toBe(
						BigInt(before.invalidation) + 3n,
					);
					expect(after.evaluated).toBe(after.invalidation);
					// The unacknowledged initial row is pruned when generation 2 stages.
					// A duplicate recompute would therefore still keep one row but advance
					// `latest` to 3, so both assertions are required.
					expect(after.generations).toBe(before.generations);
					expect(after.latest).toBe("2");
					expect(BigInt(after.horizon)).toBeGreaterThan(BigInt(before.horizon));
					expect(evaluations).toBe(2);

					const unexpected = nextFrame(reader).then((frame) => ({ frame }));
					expect(
						await Promise.race([
							unexpected,
							new Promise<{ frame: "none" }>((resolve) =>
								setTimeout(() => resolve({ frame: "none" }), 100),
							),
						]),
					).toEqual({ frame: "none" });
					await reader.cancel();
				} finally {
					releaseUpdate();
					await carrier.drain({ deadlineAt: Date.now() + 2_000 });
					await coordinator.drain({ deadlineAt: Date.now() + 2_000 });
					await runtime.close({ deadlineAt: Date.now() + 2_000 });
					await notificationControl.end().catch(() => {});
				}
			},
			20_000,
		);

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

				await Promise.all(
					carriers.map((carrier) =>
						carrier.drain({ deadlineAt: Date.now() + 2_000 }),
					),
				);
				await wrongDeploymentCarrier.drain({ deadlineAt: Date.now() + 2_000 });
				await Promise.all(
					coordinators.map((coordinator) =>
						coordinator.drain({ deadlineAt: Date.now() + 2_000 }),
					),
				);
				await wrongDeployment.drain({ deadlineAt: Date.now() + 2_000 });
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
								// The exact value a revoked Membership raises out of executeRoot:
								// context.error builds a frozen plain Error carrying `code`, with
								// no class to test, which is why the mapping is shape-based.
								throw contextHelpers.error.notFound("tenant");
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

					// A refusal never stages, so the binding stays dirty. Without the
					// fence it would be recomputed in full on every tick and re-emit an
					// identical failure forever.
					const afterRefusal = evaluations;
					for (let attempt = 0; attempt < 3; attempt += 1) {
						tickSources[1].tick();
						await coordinators[1]!.durable!.requestScan();
					}
					expect(evaluations).toBe(afterRefusal);

					// A real invalidation lifts the fence: authority is restored and the
					// next frame this connection receives is the freshly authorized
					// result, not a repeat of the refusal.
					authorityRevoked = false;
					await captureMessageChange(databases[1]!);
					tickSources[1].tick();
					await coordinators[1]!.durable!.requestScan();
					expect(await nextFrame(takeoverReader)).toMatchObject({
						kind: "delivery",
						bindingId: "binding:takeover",
						payload: { nodes: [{ body: "durable result" }] },
					});
					await takeoverReader.cancel();
				} finally {
					await Promise.all(
						carriers.map((carrier) =>
							carrier.drain({ deadlineAt: Date.now() + 2_000 }),
						),
					);
					await Promise.all(
						coordinators.map((coordinator) =>
							coordinator.drain({ deadlineAt: Date.now() + 2_000 }),
						),
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
					await Promise.all(
						carriers.map((carrier) =>
							carrier.drain({ deadlineAt: Date.now() + 2_000 }),
						),
					);
					await Promise.all(
						coordinators.map((coordinator) =>
							coordinator.drain({ deadlineAt: Date.now() + 2_000 }),
						),
					);
				}
			},
			20_000,
		);
	},
);
