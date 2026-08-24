import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { SQL } from "bun";
import { principal } from "questpie";

import { createPostgresDatabaseDurableMaintenance } from "../../packages/runtime/src/durable/postgres-database-maintenance";
import type { ExecutionFacts } from "../../packages/runtime/src/execution";
import {
	createPostgresLiveQueryInvalidationEffect,
	createPostgresLiveQueryRetention,
	reconcilePostgresChangeLedger,
} from "../../packages/runtime/src/live-query";
import { linkReactionProjection } from "../../packages/runtime/src/mutation";
import { createPostgresDatabaseMutationInvoker } from "../../packages/runtime/src/mutation/postgres-database";
import type { PreparedOperation } from "../../packages/runtime/src/operation";
import {
	createRuntimePostgres,
	definePostgresStatement,
	type PostgresTransactionRunner,
} from "../../packages/runtime/src/postgres";
import scenario from "../../quality/performance/pb05-owner-path-measurement.json";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "../integration/postgres/helpers/beta05-runtime";
import { importPb05FileBackedModule } from "../support/pb05-file-backed-module";
import {
	assertPb05OperationalMetrics,
	assertPb05OwnerPathSchemaReset,
	createPb05ContentionOperationOwner,
	createPb05OperationAbortBoundary,
	decodePb05RetentionAntagonistResult,
	derivePb05OwnerPathMeasurements,
	pb05OwnerPathStageAttribution,
	settlePb05OwnedBlocker,
	withPb05ReleasedBlocker,
} from "../support/pb05-operational-load-safety";
import {
	createPb05OperationalMeasurement,
	instrumentPb05OwnerContentionRunner,
	instrumentPb05OwnedTransaction,
	instrumentPb05TransactionRunner,
	observePb05AcceptedCallback,
} from "../support/pb05-operational-measurement";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("PB-05 owner-path measurement requires PostgreSQL");

const application = "application:collaboration";
const applicationName = "collaboration";
let consumer = "";
const warmupSamples = 2;
const measuredCallbackSamples = 16;
const measuredContentionSamples = 8;
const authorityPartitionDigest = "a".repeat(64);
const retentionLockIdentity = `questpie-retained-result-v1:${applicationName}:${authorityPartitionDigest}`;

type View = Readonly<{
	data: Readonly<{
		channels: Readonly<{
			get(input: unknown): Promise<Readonly<Record<string, unknown>> | null>;
		}>;
		spaces: Readonly<{
			get(input: unknown): Promise<Readonly<Record<string, unknown>> | null>;
		}>;
		messages: Readonly<{
			create(input: unknown): Promise<Readonly<Record<string, unknown>>>;
		}>;
		messageEvents: Readonly<{
			create(input: unknown): Promise<Readonly<Record<string, unknown>>>;
		}>;
	}>;
	dispatch: Readonly<{ messagePublished(input: unknown): Promise<void> }>;
}>;

type Owner = "maintenance" | "reconciliation" | "retention";
type Prepared = Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>;
type CompiledPublishMessage = Readonly<{
	name: "message.publish";
	input: unknown;
	output: unknown;
	errors: Readonly<Record<string, unknown>>;
	handler(
		input: Readonly<{ input: unknown; ctx: View; errors: unknown }>,
	): Promise<unknown>;
}>;

function postgresUrl(applicationName: string): string {
	const url = new URL(beta05PostgresUrl());
	url.searchParams.set("application_name", applicationName);
	return url.toString();
}

function database(applicationName: string) {
	const url = postgresUrl(applicationName);
	return createRuntimePostgres({
		connectionUrl: url,
		directConnectionUrl: url,
		pool: {
			max: 2,
			connectTimeoutMs: 2_000,
			checkoutTimeoutMs: 2_000,
			idleTimeoutMs: 5_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 5_000,
			lockMs: 2_000,
			idleInTransactionMs: 5_000,
		},
	});
}

function distribution(values: readonly number[]) {
	if (values.length === 0) throw new Error("cannot summarize zero samples");
	const sorted = values.toSorted((left, right) => left - right);
	const percentile = (value: number) =>
		sorted[Math.ceil(value * sorted.length) - 1]!;
	return Object.freeze({
		count: values.length,
		p50Ms: percentile(0.5),
		p95Ms: percentile(0.95),
		p99Ms: percentile(0.99),
		maxMs: Math.max(...values),
	});
}

async function generatedFiles(prepared: Prepared, names: readonly string[]) {
	return Object.fromEntries(
		await Promise.all(
			names.map(async (name) => [
				name,
				await readFile(resolve(prepared.generated.generatedRoot, name), "utf8"),
			]),
		),
	);
}

async function loadCompiledPublishMessage(
	prepared: Prepared,
): Promise<CompiledPublishMessage> {
	const applicationRoot = resolve(prepared.generated.generatedRoot, "../..");
	const compiled = await Bun.build({
		entrypoints: [resolve(applicationRoot, "src/message-publish.ts")],
		target: "bun",
		format: "esm",
		packages: "bundle",
		plugins: [
			{
				name: "pb05-owner-path-authoring-binding",
				setup(builder) {
					builder.onResolve({ filter: /^#questpie\/app$/u }, () => ({
						path: "authoring-app",
						namespace: "pb05-owner-path",
					}));
					builder.onLoad(
						{ filter: /.*/u, namespace: "pb05-owner-path" },
						() => ({
							contents:
								'export const defineMutation = (definition) => Object.freeze({ ...definition, kind: "mutation", identity: `mutation:${definition.name}`, network: definition.network === true });',
							loader: "js",
						}),
					);
				},
			},
		],
	});
	if (!compiled.success || compiled.outputs.length !== 1)
		throw new TypeError(
			"PB-05 could not compile the collaboration Mutation owner",
		);
	const module = await importPb05FileBackedModule<
		Readonly<{ publishMessage?: CompiledPublishMessage }>
	>({
		ownerRoot: applicationRoot,
		moduleBytes: compiled.outputs[0]!,
	});
	if (
		module.publishMessage?.name !== "message.publish" ||
		typeof module.publishMessage.handler !== "function"
	)
		throw new TypeError(
			"PB-05 compiled collaboration publishMessage owner is invalid",
		);
	return module.publishMessage;
}

function operation(
	body: string,
	definition: CompiledPublishMessage,
	binding: Readonly<{ runtimeGraphDigest: string; bundleExport: string }>,
	measurement: ReturnType<typeof createPb05OperationalMeasurement>,
	record: boolean,
): PreparedOperation<View> {
	return {
		admission: "authenticated",
		binding: {
			identity: "mutation:message.publish",
			kind: "mutation",
			slot: "handler",
			runtimeGraphDigest: binding.runtimeGraphDigest,
			bundleExport: binding.bundleExport,
			execute: (
				input: Readonly<{ input: unknown; ctx: View; errors: unknown }>,
			) =>
				record
					? observePb05AcceptedCallback({
							measurement,
							population: "mutation",
							operation: "fresh",
							phase: "handler",
							use: () => definition.handler(input),
						})
					: definition.handler(input),
			definition,
		},
		inputCodec: definition.input,
		output: definition.output,
		declaredErrors: Object.entries(definition.errors).map(([name, error]) => ({
			name,
			...(error as object),
		})),
		input: { channelId: beta05Ids.channel, body },
	} as unknown as PreparedOperation<View>;
}

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function oneRow(result: StatementResult, name: string): readonly unknown[] {
	if (
		result.command !== "SELECT" ||
		result.rowCount !== 1 ||
		result.rows.length !== 1 ||
		result.rows[0] === undefined
	)
		throw new TypeError(`invalid ${name} result`);
	return result.rows[0];
}

const maintenanceAntagonist = definePostgresStatement({
	name: "pb05.owner-path.maintenance-antagonist",
	text: `SELECT run_id::text
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2::uuid
FOR UPDATE`,
	parameterCount: 2,
	parameters: (value: Readonly<{ application: string; runId: string }>) => [
		value.application,
		value.runId,
	],
	decode(result) {
		const row = oneRow(result, "maintenance antagonist");
		if (row.length !== 1 || typeof row[0] !== "string")
			throw new TypeError("invalid maintenance antagonist result");
	},
});

const reconciliationAntagonist = definePostgresStatement({
	name: "pb05.owner-path.reconciliation-antagonist",
	text: `SELECT xid_horizon::text
FROM questpie_internal.reconciliation_consumers
WHERE application_name = $1 AND consumer_id = $2
FOR UPDATE`,
	parameterCount: 2,
	parameters: (value: Readonly<{ application: string; consumer: string }>) => [
		value.application,
		value.consumer,
	],
	decode(result) {
		const row = oneRow(result, "reconciliation antagonist");
		if (row.length !== 1 || typeof row[0] !== "string")
			throw new TypeError("invalid reconciliation antagonist result");
	},
});

const retentionAntagonist = definePostgresStatement({
	name: "pb05.owner-path.retention-antagonist",
	text: "SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1, 0))",
	parameterCount: 1,
	parameters: (lockIdentity: string) => [lockIdentity],
	decode(result) {
		decodePb05RetentionAntagonistResult(result);
	},
});

const lockWaitProbe = definePostgresStatement({
	name: "pb05.owner-path.lock-wait-probe",
	text: `SELECT EXISTS (
  SELECT 1 FROM pg_catalog.pg_stat_activity
  WHERE application_name = $1 AND wait_event_type = 'Lock'
)`,
	parameterCount: 1,
	parameters: (applicationName: string) => [applicationName],
	decode(result) {
		const row = oneRow(result, "lock wait probe");
		if (row.length !== 1 || typeof row[0] !== "boolean")
			throw new TypeError("invalid lock wait probe result");
		return row[0];
	},
});

async function waitForLock(
	database: PostgresTransactionRunner,
	applicationName: string,
	signal: AbortSignal,
): Promise<void> {
	const deadline = performance.now() + 2_000;
	while (performance.now() < deadline) {
		signal.throwIfAborted();
		const waiting = await database.transaction({
			mode: { isolation: "readCommitted", access: "readOnly" },
			control: { signal },
			use: (transaction) => transaction.execute(lockWaitProbe, applicationName),
		});
		if (waiting) return;
		await Bun.sleep(5);
	}
	throw new Error(`${applicationName} did not expose a PostgreSQL lock waiter`);
}

async function closeDatabase(
	value: ReturnType<typeof createRuntimePostgres> | undefined,
): Promise<void> {
	if (value) await value.close({ deadlineAt: Date.now() + 5_000 });
}

async function withRuntimeDatabase<Value>(
	applicationName: string,
	use: (value: ReturnType<typeof createRuntimePostgres>) => Promise<Value>,
): Promise<Value> {
	const value = database(applicationName);
	let failed = false;
	let primary: unknown;
	let result: Value | undefined;
	try {
		result = await use(value);
	} catch (error) {
		failed = true;
		primary = error;
	}
	try {
		await closeDatabase(value);
	} catch (cleanup) {
		if (!failed) throw cleanup;
		console.error(
			"PB-05 owner-path suppressed database close failure",
			cleanup,
		);
	}
	if (failed) throw primary;
	return result as Value;
}

const admin = new SQL({ url: postgresUrl("pb05-owner-path-admin"), max: 4 });
const measurement = createPb05OperationalMeasurement();
const mutationGaps: number[] = [];
const realtimeGaps: number[] = [];
const ownerWaits: Record<Owner, number[]> = {
	maintenance: [],
	reconciliation: [],
	retention: [],
};
const semanticResults: boolean[] = [];
let lockWaitProofs = 0;
let schemaOwned = false;
let prepared: Prepared | undefined;
let runtime: ReturnType<typeof createRuntimePostgres> | undefined;
let contentionControl: ReturnType<typeof createRuntimePostgres> | undefined;
let runFailed = false;
let primary: unknown;
let diagnosticStage: Readonly<{
	phase: string;
	operation?: string;
	sample?: number;
}> = { phase: "database-identity" };
let diagnosticSignals = (): Readonly<Record<string, AbortSignal>> => ({});

try {
	const [identity] = await admin.unsafe<
		readonly Readonly<{ database: string; serverVersion: string }>[]
	>(`SELECT current_database() AS database,
       current_setting('server_version_num') AS "serverVersion"`);
	if (Math.trunc(Number(identity?.serverVersion) / 10_000) !== 17)
		throw new Error("PB-05 owner-path runner requires PostgreSQL 17");
	assertPb05OwnerPathSchemaReset({
		database: identity?.database,
		resetOptIn: process.env.QUESTPIE_PB05_OWNER_PATH_RESET,
	});
	schemaOwned = true;

	diagnosticStage = { phase: "application-prepare" };
	prepared = await prepareBeta05PostgresApplication(admin);
	const generated = await generatedFiles(prepared, [
		"postgres-collection-operation-plans.json",
		"postgres-mutation-transaction-statements.json",
		"policy-projection.json",
		"runtime-build.json",
		"runtime-executables.json",
		"collection-operation-programs.json",
		"field-normalizer-programs.json",
		"server-value-programs.json",
		"reaction-projection.json",
	]);
	const mutation = await import("../../packages/runtime/src/mutation");
	const collectionArtifact = JSON.parse(
		generated["postgres-collection-operation-plans.json"]!,
	) as Readonly<{ digest: string }>;
	const fixedArtifact = JSON.parse(
		generated["postgres-mutation-transaction-statements.json"]!,
	) as Readonly<{ digest: string }>;
	const policyProjection = JSON.parse(
		generated["policy-projection.json"]!,
	) as Readonly<{
		policies: readonly Readonly<{
			program: Readonly<{ identity: string; target: string }>;
		}>[];
	}>;
	const runtimeBuild = JSON.parse(
		generated["runtime-build.json"]!,
	) as Readonly<{
		digest: string;
		slots: readonly Readonly<{
			identity: string;
			kind: string;
			slot: string;
			runtimeGraphDigest: string;
			bundleExport: string;
		}>[];
	}>;
	const runtimeExecutables = JSON.parse(
		generated["runtime-executables.json"]!,
	) as Readonly<{
		slots: readonly Readonly<{
			identity: string;
			slot: string;
			origin: Readonly<{
				path: string;
				exportName: string;
				packageId: string | null;
			}>;
			sourceDigest: string;
		}>[];
	}>;
	const mutationBinding = runtimeBuild.slots.find(
		(slot) =>
			slot.identity === "mutation:message.publish" && slot.slot === "handler",
	);
	const mutationExecutable = runtimeExecutables.slots.find(
		(slot) =>
			slot.identity === "mutation:message.publish" && slot.slot === "handler",
	);
	if (
		!mutationBinding ||
		mutationBinding.kind !== "mutation" ||
		!mutationExecutable ||
		mutationExecutable.origin.exportName !== "publishMessage" ||
		!/(?:^|\/)message-publish\.ts$/u.test(mutationExecutable.origin.path) ||
		mutationExecutable.origin.packageId !== null ||
		!/^[0-9a-f]{64}$/u.test(mutationExecutable.sourceDigest)
	)
		throw new TypeError(
			"PB-05 Runtime artifacts do not bind collaboration publishMessage",
		);
	const publishMessage = await loadCompiledPublishMessage(prepared);
	const invalidation = createPostgresLiveQueryInvalidationEffect({
		deploymentDigest: runtimeBuild.digest,
		fanoutPerBatch: 1_024,
	});
	consumer = invalidation.consumer;
	const programs = mutation.linkCollectionMutationPrograms({
		collectionOperations: JSON.parse(
			generated["collection-operation-programs.json"]!,
		),
		fieldNormalizers: JSON.parse(generated["field-normalizer-programs.json"]!),
		serverValues: JSON.parse(generated["server-value-programs.json"]!),
		policies: policyProjection.policies.map(({ program }) => ({
			identity: program.identity,
			target: program.target,
		})),
	});
	const collectionPlans = mutation.linkPostgresCollectionOperationPlans({
		artifact: collectionArtifact,
		operations: programs,
		expectedDigest: collectionArtifact.digest,
	});
	const transactionStatements =
		mutation.linkPostgresMutationTransactionStatements({
			artifact: generated["postgres-mutation-transaction-statements.json"]!,
			expectedDigest: fixedArtifact.digest,
		});
	const reactions = linkReactionProjection(
		JSON.parse(generated["reaction-projection.json"]!),
	);
	runtime = database("pb05-owner-path-callbacks");
	const mutationDatabase = instrumentPb05TransactionRunner({
		database: runtime,
		measurement,
		population: "mutation",
		operation: "fresh",
	});
	const reconciliationDatabase = instrumentPb05TransactionRunner({
		database: runtime,
		measurement,
		population: "realtime",
		operation: "reconciliation",
	});
	const facts = {
		principal: principal.user({ id: beta05Ids.principal }),
		authority: { kind: "ordinary" as const },
		tenant: { id: beta05Ids.company },
		values: { selectedMembershipId: beta05Ids.membership },
		contextInput: { companyId: beta05Ids.company },
		liveQueryObservation: null,
		signal: new AbortController().signal,
		deadline: null,
	} satisfies ExecutionFacts<
		Readonly<{
			tenant: Readonly<{ id: string }>;
			values: Readonly<{ selectedMembershipId: string }>;
		}>
	>;
	const invoke = createPostgresDatabaseMutationInvoker<View>({
		database: mutationDatabase,
		application,
		transactionStatements,
		collectionPlans,
		reactions,
		contextInputCodec: {
			kind: "object",
			properties: { companyId: { kind: "uuid" } },
		},
		runtimeBuildDigest: runtimeBuild.digest,
		facts,
	});
	const reconcile = (record: boolean) =>
		reconcilePostgresChangeLedger({
			database: reconciliationDatabase,
			application,
			consumer,
			apply: async () => undefined,
			effect: Object.freeze({
				consumer,
				apply: (input) => {
					if (input.transaction === undefined)
						throw new TypeError(
							"PB-05 realtime invalidation did not retain its owned transaction",
						);
					const appliedInput = {
						...input,
						transaction: instrumentPb05OwnedTransaction({
							transaction: input.transaction,
							measurement,
							population: "realtime",
							operation: "apply",
						}),
					};
					return record
						? observePb05AcceptedCallback({
								measurement,
								population: "realtime",
								operation: "apply",
								phase: "apply",
								use: () => invalidation.apply(appliedInput),
							})
						: invalidation.apply(appliedInput);
				},
			}),
		});
	await reconcile(false);
	for (
		let index = 0;
		index < warmupSamples + measuredCallbackSamples;
		index += 1
	) {
		const record = index >= warmupSamples;
		diagnosticStage = {
			phase: "callback",
			operation: "mutation-handler",
			sample: index,
		};
		const priorMutation =
			measurement.snapshot({ requireCompleteInventory: false }).idleGaps[
				"mutation:fresh:handler"
			]?.totalMs ?? 0;
		const callId = `pb05-owner-path-${crypto.randomUUID()}`;
		const result = await invoke(
			operation(
				`owner-path-${callId}`,
				publishMessage,
				mutationBinding,
				measurement,
				record,
			),
			callId,
		);
		semanticResults.push(
			result.committed === true &&
				typeof result.value === "object" &&
				result.value !== null &&
				(result.value as Readonly<Record<string, unknown>>).body ===
					`owner-path-${callId}`,
		);
		if (record) {
			const total =
				measurement.snapshot({ requireCompleteInventory: false }).idleGaps[
					"mutation:fresh:handler"
				]?.totalMs ?? 0;
			mutationGaps.push(total - priorMutation);
		}
		const priorRealtime =
			measurement.snapshot({ requireCompleteInventory: false }).idleGaps[
				"realtime:apply:apply"
			]?.totalMs ?? 0;
		diagnosticStage = {
			phase: "callback",
			operation: "realtime-apply",
			sample: index,
		};
		const reconciliation = await reconcile(record);
		semanticResults.push(
			reconciliation.facts.length > 0 &&
				/^[0-9]+$/u.test(reconciliation.priorHorizon) &&
				/^[0-9]+$/u.test(reconciliation.nextHorizon) &&
				BigInt(reconciliation.nextHorizon) >=
					BigInt(reconciliation.priorHorizon),
		);
		if (record) {
			const total =
				measurement.snapshot({ requireCompleteInventory: false }).idleGaps[
					"realtime:apply:apply"
				]?.totalMs ?? 0;
			realtimeGaps.push(total - priorRealtime);
		}
	}
	await closeDatabase(runtime);
	runtime = undefined;

	const [durable] = await admin.unsafe<readonly Readonly<{ runId: string }>[]>(
		`SELECT run_id::text AS "runId" FROM questpie_internal.durable_runs
ORDER BY accepted_at DESC LIMIT 1`,
	);
	if (!durable) throw new Error("owner-path runner produced no durable run");
	const durableRunId = durable.runId;
	const activeContentionControl = database(
		"pb05-owner-path-contention-control",
	);
	contentionControl = activeContentionControl;

	async function runContention(
		owner: Owner,
		waiterApplication: string,
		waiterDatabase: PostgresTransactionRunner,
		operationBoundary: ReturnType<typeof createPb05OperationAbortBoundary>,
		use: (
			database: PostgresTransactionRunner,
			index: number,
		) => Promise<unknown>,
		valid: (result: unknown, index: number) => boolean,
	): Promise<void> {
		for (let index = 0; index < measuredContentionSamples; index += 1) {
			const blockerReady = Promise.withResolvers<void>();
			const releaseBlocker = Promise.withResolvers<void>();
			const blockerController = new AbortController();
			const operationOwner = createPb05ContentionOperationOwner({
				abortAfterCloseMs: 4_000,
			});
			let released = false;
			diagnosticStage = {
				phase: "contention",
				operation: owner,
				sample: index,
			};
			diagnosticSignals = () => ({
				antagonist: blockerController.signal,
				owner: operationOwner.signal,
			});
			const blocker = activeContentionControl
				.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					control: { signal: blockerController.signal },
					async use(transaction) {
						if (owner === "maintenance")
							await transaction.execute(maintenanceAntagonist, {
								application,
								runId: durableRunId,
							});
						else if (owner === "reconciliation")
							await transaction.execute(reconciliationAntagonist, {
								application,
								consumer,
							});
						else
							await transaction.execute(
								retentionAntagonist,
								retentionLockIdentity,
							);
						blockerReady.resolve();
						await releaseBlocker.promise;
					},
				})
				.catch((error) => {
					blockerReady.reject(error);
					throw error;
				});
			void blocker.catch(() => undefined);
			const blockerSettlement = settlePb05OwnedBlocker(blocker, {
				released: () => released,
				signal: blockerController.signal,
			});
			void blockerSettlement.catch(() => undefined);
			const before = measurement.snapshot({ requireCompleteInventory: false })
				.contention[owner]!.waitMs;
			await withPb05ReleasedBlocker({
				work: async () => {
					await blockerReady.promise;
					const admission = operationOwner.start(() =>
						operationBoundary.run(operationOwner.signal, async () => {
							const result = await use(waiterDatabase, index);
							semanticResults.push(valid(result, index));
							return result;
						}),
					);
					if (!admission.accepted) return;
					await waitForLock(
						activeContentionControl,
						waiterApplication,
						AbortSignal.timeout(2_000),
					);
					lockWaitProofs += 1;
				},
				release: () => {
					released = true;
					operationOwner.close();
					releaseBlocker.resolve();
					blockerController.abort(
						new DOMException("PB-05 antagonist released", "AbortError"),
					);
				},
				settlements: () => [blockerSettlement, operationOwner.settlement],
				workTimeoutMs: 2_500,
				settlementTimeoutMs: 5_000,
			});
			const after = measurement.snapshot({ requireCompleteInventory: false })
				.contention[owner]!.waitMs;
			ownerWaits[owner].push(after - before);
		}
	}

	await withRuntimeDatabase(
		"pb05-owner-path-maintenance",
		async (maintenanceRuntime) => {
			let cancelledVersion: number | undefined;
			const measured = instrumentPb05OwnerContentionRunner({
				database: maintenanceRuntime,
				measurement,
				owner: "maintenance",
				lockIdentity: `${application}:${durableRunId}`,
			});
			const operationBoundary = createPb05OperationAbortBoundary(measured);
			const maintenance = createPostgresDatabaseDurableMaintenance({
				database: operationBoundary.database,
				application,
				authorize: () => true,
			});
			await runContention(
				"maintenance",
				"pb05-owner-path-maintenance",
				operationBoundary.database,
				operationBoundary,
				() =>
					maintenance.cancelRun({
						runId: durableRunId,
						reason: "PB-05 owner-path measurement",
						actor: { kind: "user", id: beta05Ids.principal },
					}),
				(result, index) => {
					if (!result || typeof result !== "object") return false;
					const outcome = result as Readonly<Record<string, unknown>>;
					if (
						outcome.command !== "cancelRun" ||
						typeof outcome.commandId !== "string" ||
						typeof outcome.version !== "number"
					)
						return false;
					if (index === 0) {
						cancelledVersion = outcome.version;
						return (
							outcome.outcome === "applied" &&
							outcome.rejectionCode === null &&
							outcome.stateBefore === "ready" &&
							outcome.stateAfter === "cancelled" &&
							outcome.version > 0
						);
					}
					return (
						outcome.outcome === "rejected" &&
						outcome.rejectionCode === "RUN_IS_TERMINAL" &&
						outcome.stateBefore === "cancelled" &&
						outcome.stateAfter === "cancelled" &&
						outcome.version === cancelledVersion
					);
				},
			);
		},
	);

	await withRuntimeDatabase(
		"pb05-owner-path-reconciliation",
		async (reconciliationRuntime) => {
			const measured = instrumentPb05OwnerContentionRunner({
				database: reconciliationRuntime,
				measurement,
				owner: "reconciliation",
				lockIdentity: `${application}:${consumer}`,
			});
			const operationBoundary = createPb05OperationAbortBoundary(measured);
			await runContention(
				"reconciliation",
				"pb05-owner-path-reconciliation",
				operationBoundary.database,
				operationBoundary,
				async (database) => {
					let appliedFacts = 0;
					const result = await reconcilePostgresChangeLedger({
						database,
						application,
						consumer,
						apply: async (facts) => {
							appliedFacts += facts.length;
						},
					});
					return { result, appliedFacts };
				},
				(value) => {
					if (!value || typeof value !== "object") return false;
					const candidate = value as Readonly<Record<string, unknown>>;
					if (!candidate.result || typeof candidate.result !== "object")
						return false;
					const result = candidate.result as Readonly<Record<string, unknown>>;
					return (
						Array.isArray(result.facts) &&
						result.facts.length === 0 &&
						typeof candidate.appliedFacts === "number" &&
						candidate.appliedFacts === 0 &&
						typeof result.priorHorizon === "string" &&
						typeof result.nextHorizon === "string" &&
						/^[1-9][0-9]{0,19}$/u.test(result.priorHorizon) &&
						/^[1-9][0-9]{0,19}$/u.test(result.nextHorizon) &&
						BigInt(result.nextHorizon) >= BigInt(result.priorHorizon)
					);
				},
			);
		},
	);

	await withRuntimeDatabase(
		"pb05-owner-path-retention",
		async (retentionRuntime) => {
			const measured = instrumentPb05OwnerContentionRunner({
				database: retentionRuntime,
				measurement,
				owner: "retention",
				lockIdentity: retentionLockIdentity,
			});
			const operationBoundary = createPb05OperationAbortBoundary(measured);
			const retention = createPostgresLiveQueryRetention({
				database: operationBoundary.database,
				hmacKey: new Uint8Array(32).fill(7),
			});
			const retained = {
				binding: {
					applicationName,
					deploymentDigest: "b".repeat(64),
					authorityPartitionDigest,
					queryIdentity: "messages.page",
					inputDigest: "c".repeat(64),
					wireVersion: 1,
					retainedGeneration: 1n,
				},
				resultBytes: new Uint8Array([1]),
				dependencyPlanBytes: new Uint8Array([2]),
			};
			const resumeToken = retention.mint(retained);
			await runContention(
				"retention",
				"pb05-owner-path-retention",
				operationBoundary.database,
				operationBoundary,
				() => retention.acknowledge({ ...retained, resumeToken }),
				(result) => result === undefined,
			);
			const retainedRows = await admin.unsafe<
				readonly Readonly<{
					generation: string;
					resultBytes: Uint8Array;
					dependencyPlanBytes: Uint8Array;
				}>[]
			>(
				`SELECT retained_generation::text AS generation,
       result_bytes AS "resultBytes",
       dependency_plan_bytes AS "dependencyPlanBytes"
FROM questpie_internal.retained_live_query_results
WHERE application_name = $1
  AND authority_partition_digest = $2`,
				[applicationName, authorityPartitionDigest],
			);
			semanticResults.push(
				retainedRows.length === 1 &&
					retainedRows[0]?.generation === "1" &&
					retainedRows[0].resultBytes.length === 1 &&
					retainedRows[0].resultBytes[0] === 1 &&
					retainedRows[0].dependencyPlanBytes.length === 1 &&
					retainedRows[0].dependencyPlanBytes[0] === 2,
			);
		},
	);

	diagnosticStage = { phase: "measurement-contract" };
	diagnosticSignals = () => ({});
	const snapshot = measurement.snapshot({ requireCompleteInventory: false });
	const measurements = derivePb05OwnerPathMeasurements({
		snapshot,
		expected: {
			callbackSamples: measuredCallbackSamples,
			contentionSamples: measuredContentionSamples,
			mutationTransactions: warmupSamples + measuredCallbackSamples,
			reconciliationTransactions: 1 + warmupSamples + measuredCallbackSamples,
			semanticChecks:
				(warmupSamples + measuredCallbackSamples) * 2 +
				measuredContentionSamples * 3 +
				1,
		},
		lockWaitProofs,
		semanticResults,
	});
	assertPb05OperationalMetrics(measurements, scenario.metrics);
	console.log(
		JSON.stringify({
			id: scenario.id,
			status: scenario.status,
			publicCeilings: scenario.publicCeilings,
			measurements,
			observerStructure: {
				mutationTransactions: snapshot.populations.mutation!.transactions,
				reconciliationTransactions: snapshot.populations.realtime!.transactions,
			},
			distributions: {
				actualMutationHandler: distribution(mutationGaps),
				actualRealtimeApply: distribution(realtimeGaps),
				maintenanceOwnerPathWait: distribution(ownerWaits.maintenance),
				reconciliationOwnerPathWait: distribution(ownerWaits.reconciliation),
				retentionOwnerPathWait: distribution(ownerWaits.retention),
			},
			limitations: [
				"isolated local PostgreSQL evidence only",
				"durations are provisional and do not define public ceilings",
				"antagonist SQL only establishes the opposing production lock",
			],
		}),
	);
} catch (error) {
	console.error(
		"PB-05 owner-path stage failure",
		JSON.stringify(
			pb05OwnerPathStageAttribution(diagnosticStage, diagnosticSignals()),
		),
	);
	runFailed = true;
	primary = error;
} finally {
	const cleanupFailures: unknown[] = [];
	try {
		await closeDatabase(runtime);
	} catch (error) {
		cleanupFailures.push(error);
	}
	try {
		await closeDatabase(contentionControl);
	} catch (error) {
		cleanupFailures.push(error);
	}
	try {
		await prepared?.dispose();
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (schemaOwned)
		try {
			await admin.unsafe(
				"SET statement_timeout = 5000; DROP SCHEMA IF EXISTS collaboration CASCADE; DROP SCHEMA IF EXISTS questpie_internal CASCADE",
			);
		} catch (error) {
			cleanupFailures.push(error);
		}
	try {
		await admin.close({ timeout: 5 });
	} catch (error) {
		cleanupFailures.push(error);
	}
	if (runFailed) {
		for (const cleanup of cleanupFailures)
			console.error("PB-05 owner-path suppressed cleanup failure", cleanup);
	} else if (cleanupFailures.length > 0) {
		runFailed = true;
		primary = cleanupFailures[0];
	}
}

if (runFailed) throw primary;
