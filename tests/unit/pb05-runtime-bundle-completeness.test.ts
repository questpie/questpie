import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";

import { principal } from "questpie";

import type {
	PostgresParameter,
	PostgresStatement,
	PostgresTransactionRunner,
} from "@questpie/runtime/bundle-core";

let poolConstructions = 0;
let clientConstructions = 0;
const poolHostile = process.env.QUESTPIE_PB05_POOL_HOSTILE === "1";
if (poolHostile)
	mock.module("pg", () => ({
		Pool: function Pool() {
			poolConstructions += 1;
		},
		Client: function Client() {
			clientConstructions += 1;
		},
	}));

const core = await import("@questpie/runtime/bundle-core");
const realtime = await import("@questpie/runtime/bundle-realtime");

const application = "application:collaboration";
const realtimeApplication = "collaboration";
const deploymentDigest = "a".repeat(64);
const runId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6200";
const commandId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6201";
const principalId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6202";
const tenantId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b6203";
const operationTime = new Date("2026-08-24T00:00:00.000Z");

type Observed = {
	identities: unknown[];
	modes: unknown[];
	statements: Array<Readonly<{ transaction: number; name: string }>>;
};

function successfulDatabase(observed: Observed): PostgresTransactionRunner {
	let transactionIdentity = 0;
	const database: PostgresTransactionRunner = {
		async transaction(input) {
			observed.identities.push(this);
			observed.modes.push(input.mode);
			const transaction = ++transactionIdentity;
			return input.use({
				async execute(statement: PostgresStatement<unknown, unknown>) {
					observed.statements.push({ transaction, name: statement.name });
					switch (statement.name) {
						case "readiness.protocol.v6":
							return { version: 6, checksum: "b".repeat(64) } as never;
						case "readiness.application-binding":
							return [
								{ application, postgresSchema: realtimeApplication },
							] as never;
						case "readiness.migration-receipts":
							return [
								{
									identity: "000001_initial",
									sequence: 1,
									parent: null,
									checksum: "c".repeat(64),
								},
							] as never;
						case "context.bundle-completeness":
							return { tenantId } as never;
						case "query.bundle-completeness":
							return [{ id: "message:one" }] as never;
						case "mutation.receipt.claim":
							return [{ transactionId: "101", operationTime }] as never;
						case "durable.admission.select":
						case "durable.effect.read":
							return [] as never;
						case "durable.maintenance.run-state.read":
							return "running" as never;
						case "live-query.reconciliation-horizon-read":
							return { priorHorizon: "100", nextHorizon: "102" } as never;
						case "live-query.change-ledger-facts-read":
							return [
								{
									factIdentity: "00000000-0000-4000-a000-000000000007",
									factId: "7",
									transactionId: "101",
									collection: "collection:messages",
									kind: "insert",
									oldKey: null,
									newKey: { id: "message:one" },
									conservative: false,
									capturedAt: operationTime,
								},
							] as never;
						case "live-query.observed-plans-read-for-invalidation":
							return [] as never;
						case "live-query.realtime-scopes-expire":
							return { scopes: 0, watches: 0 } as never;
						case "live-query.retention-expired-delete":
						case "live-query.retention-ledger-delete":
							return 0 as never;
						default:
							return undefined as never;
					}
				},
			} as never);
		},
	};
	return database;
}

function statement(name: string, parameterCount = 0) {
	return core.definePostgresStatement({
		name,
		text: "SELECT 1",
		parameterCount,
		parameters: (input: readonly PostgresParameter[] | undefined) =>
			input ?? [],
		decode: () => undefined,
	});
}

function mutationStatements() {
	const identities = [
		"mutation.dispatch.event.insert",
		"mutation.dispatch.intent.accept",
		"mutation.dispatch.intent.insert",
		"mutation.dispatch.kernel.mark",
		"mutation.dispatch.run.insert",
		"mutation.receipt.claim",
		"mutation.receipt.commit",
		"mutation.receipt.read",
	] as const;
	const statements = identities.map((identity) =>
		Object.freeze({ identity, statement: statement(identity) }),
	);
	const byIdentity = new Map<string, (typeof statements)[number]>(
		statements.map((member) => [member.identity, member]),
	);
	return Object.freeze({
		statements,
		get: (identity: string) => byIdentity.get(identity),
	});
}

test("private Runtime bundles expose only the required PB database subset", () => {
	const requiredCore = [
		"createDurableReactionWorker",
		"createLinkedPostgresContextBootstrapFactory",
		"createPostgresDatabaseDurableEffectLedger",
		"createPostgresDatabaseDurableKernel",
		"createPostgresDatabaseDurablePrincipalMaintenance",
		"createPostgresDatabaseMutationInvoker",
		"createRuntimePostgres",
		"definePostgresStatement",
		"durablePrincipal",
		"executeLinkedPostgresContextBootstrap",
		"executeLinkedPostgresQueryPlan",
		"linkCollectionMutationPrograms",
		"linkPostgresCollectionOperationPlans",
		"linkPostgresContextBootstrapPlans",
		"linkPostgresMutationTransactionStatements",
		"linkPostgresQueryPlans",
		"linkReactionProjection",
		"verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction",
	] as const;
	const requiredRealtime = [
		"createPostgresLiveQueryCoordinator",
		"createRuntimeRealtime",
		"linkLiveQueryProgram",
	] as const;
	for (const name of requiredCore) expect(core[name]).toBeFunction();
	for (const name of requiredRealtime) expect(realtime[name]).toBeFunction();

	const legacyBunFacades = [
		"createPostgresContextBootstrap",
		"executePostgresQuery",
		"createPostgresMutationInvoker",
		"createPostgresDurableEffectLedger",
		"createPostgresDurableKernel",
		"createPostgresDurableMaintenance",
	];
	const requiredCoreNames = new Set<string>(requiredCore);
	for (const legacy of legacyBunFacades)
		expect(requiredCoreNames.has(legacy)).toBe(false);
	for (const forbidden of [
		"SQL",
		"Pool",
		"Client",
		"createPostgresDatabase",
		"createBunDurablePostgresTransactionRunner",
		"createPostgresDatabaseDurableClaim",
		"createPostgresDatabaseDurableHeartbeat",
		"createPostgresDatabaseDurableMaintenance",
		"createPostgresRealtimeScopeDatabaseStore",
		"createPostgresLiveQueryRetention",
		"createPostgresLiveQueryInvalidationEffect",
		"reconcilePostgresChangeLedger",
	]) {
		expect(Object.hasOwn(core, forbidden)).toBe(false);
		expect(Object.hasOwn(realtime, forbidden)).toBe(false);
	}
});

test("one injected runner reaches every database-mode bundle arm without a Pool", async () => {
	const observed: Observed = { identities: [], modes: [], statements: [] };
	const database = successfulDatabase(observed);
	await database.transaction({
		mode: { isolation: "repeatableRead", access: "readOnly" },
		use: (transaction) =>
			core.verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction({
				transaction,
				protocol: { version: 6, checksum: "b".repeat(64) },
				application,
				postgresSchema: realtimeApplication,
				migrationHead: "000001_initial",
				committedMigrations: [
					{
						identity: "000001_initial",
						sequence: 1,
						parent: null,
						checksum: "c".repeat(64),
					},
				],
			}),
	});

	const contextStatement = statement("context.bundle-completeness", 1);
	await expect(
		core.executeLinkedPostgresContextBootstrap(
			database,
			{ statement: contextStatement } as never,
			{ key: { id: tenantId }, select: {} },
		),
	).resolves.toEqual({ tenantId });
	const queryStatement = statement("query.bundle-completeness", 1);
	await expect(
		core.executeLinkedPostgresQueryPlan(
			database,
			{ statement: queryStatement } as never,
			[tenantId],
		),
	).resolves.toEqual([{ id: "message:one" }]);

	const facts = {
		principal: principal.user({ id: principalId }),
		authority: { kind: "ordinary" as const },
		tenant: { id: tenantId },
		values: {},
		contextInput: {},
		liveQueryObservation: null,
		signal: new AbortController().signal,
		deadline: null,
	};
	const invoke = core.createPostgresDatabaseMutationInvoker({
		database,
		application,
		transactionStatements: mutationStatements() as never,
		collectionPlans: { plans: [], byIdentity: new Map() } as never,
		reactions: { members: new Map(), byIdentity: new Map() } as never,
		contextInputCodec: { kind: "object", properties: {} },
		runtimeBuildDigest: "d".repeat(64),
		facts,
	});
	await expect(
		invoke(
			{
				admission: "authenticated",
				binding: {
					identity: "mutation:messages.publish",
					kind: "mutation",
					definition: { errors: {} },
					execute: async () => ({}),
				},
				inputCodec: { kind: "object", properties: {} },
				output: { kind: "object", properties: {} },
				input: {},
			} as never,
			"bundle-completeness-call",
		),
	).resolves.toEqual({ committed: true, value: {} });

	const kernel = core.createPostgresDatabaseDurableKernel({
		database,
		application,
		reactions: { byIdentity: new Map() } as never,
	});
	const effects = core.createPostgresDatabaseDurableEffectLedger({
		database,
		application,
	});
	const maintenance = core.createPostgresDatabaseDurablePrincipalMaintenance({
		database,
		application,
		authorize: () => false,
		randomUUID: () => commandId,
	});
	await expect(kernel.admit(1)).resolves.toEqual([]);
	await expect(effects.read(runId)).resolves.toEqual([]);
	await expect(
		maintenance.cancelRun({
			runId,
			reason: "operator request",
			actor: principal.user({ id: "operator:one" }),
		}),
	).resolves.toMatchObject({
		commandId,
		outcome: "rejected",
		rejectionCode: "AUTHORITY_DENIED",
	});

	let listenerReconcile:
		| ((input: Readonly<Record<string, unknown>>) => Promise<void>)
		| undefined;
	const postgres = Object.freeze({
		transaction: database.transaction,
		async listen(input: Readonly<Record<string, unknown>>) {
			listenerReconcile = input.reconcile as typeof listenerReconcile;
			return Object.freeze({
				facts: () => ({ state: "ready" }),
				requestReconcile: () => Promise.resolve(),
				close: () => Promise.resolve(),
			});
		},
	});
	const coordinator = realtime.createPostgresLiveQueryCoordinator({
		postgres: postgres as never,
		program: {
			format: "questpie.live-query-program",
			version: 1,
			queries: new Map(),
			limits: { fanoutPerBatch: 16 },
		} as never,
		hmacKey: new Uint8Array(32).fill(7),
		applicationName: realtimeApplication,
		deploymentDigest,
		wireVersion: 2,
	});
	await coordinator.start!();
	await listenerReconcile!({
		admission: "active",
		reason: "requested",
		database,
		signal: new AbortController().signal,
	});
	await coordinator.drain!({ deadlineAt: Date.now() + 1_000 });

	expect(observed.identities.every((identity) => identity === database)).toBe(
		true,
	);
	expect(observed.modes).toEqual([
		{ isolation: "repeatableRead", access: "readOnly" },
		{ isolation: "repeatableRead", access: "readOnly" },
		{ isolation: "repeatableRead", access: "readOnly" },
		{ isolation: "readCommitted", access: "readWrite" },
		{ isolation: "readCommitted", access: "readOnly" },
		{ isolation: "readCommitted", access: "readOnly" },
		{ isolation: "readCommitted", access: "readWrite" },
		{ isolation: "repeatableRead", access: "readWrite" },
		{ isolation: "readCommitted", access: "readWrite" },
		{ isolation: "readCommitted", access: "readWrite" },
	]);
	const reconciliation = observed.statements.find(
		({ name }) => name === "live-query.reconciliation-horizon-read",
	)!;
	const apply = observed.statements.find(
		({ name }) => name === "live-query.observed-plans-read-for-invalidation",
	)!;
	const retention = observed.statements.find(
		({ name }) => name === "live-query.retention-expired-delete",
	)!;
	expect(apply.transaction).toBe(reconciliation.transaction);
	expect(retention.transaction).not.toBe(reconciliation.transaction);
});

test("bundle database arms preserve exact errors and cancellation", async () => {
	const primary = new Error("bundle database failed");
	const cancellation = new DOMException(
		"bundle database cancelled",
		"AbortError",
	);
	const failing = (failure: unknown): PostgresTransactionRunner => ({
		transaction: () => Promise.reject(failure),
	});
	const linked = { statement: statement("query.bundle-failure") } as never;
	await expect(
		core.executeLinkedPostgresQueryPlan(failing(primary), linked, []),
	).rejects.toBe(primary);
	await expect(
		core.executeLinkedPostgresContextBootstrap(failing(cancellation), linked, {
			key: { id: tenantId },
			select: {},
		}),
	).rejects.toBe(cancellation);
});

test("bundle-only composition never constructs an implicit Pool or Client", () => {
	if (poolHostile) {
		expect(poolConstructions).toBe(0);
		expect(clientConstructions).toBe(0);
		return;
	}
	const result = Bun.spawnSync(
		["bun", "test", "tests/unit/pb05-runtime-bundle-completeness.test.ts"],
		{
			cwd: resolve(import.meta.dir, "../.."),
			env: { ...process.env, QUESTPIE_PB05_POOL_HOSTILE: "1" },
			stderr: "pipe",
			stdout: "pipe",
		},
	);
	expect(
		result.exitCode,
		`${result.stdout.toString()}${result.stderr.toString()}`,
	).toBe(0);
});
