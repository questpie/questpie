import { resolve } from "node:path";

import type { SQL } from "bun";
import type { Principal } from "questpie";

import {
	createPostgresDatabaseDurableAttemptObservation,
	createPostgresDatabaseDurableEffectLedger,
	createPostgresDatabaseDurableKernel,
	type DurableEffectLedger,
} from "../../../../packages/runtime/src/durable";
import { linkReactionProjection } from "../../../../packages/runtime/src/durable/projection";
import type {
	DurableClaim,
	DurableKernel,
} from "../../../../packages/runtime/src/durable/rows";
import type {
	PostgresDatabase,
	PostgresTransactionRunner,
} from "../../../../packages/runtime/src/postgres";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
	prepareBeta05RetainedApplication,
} from "./beta05-runtime";

const beta08Application = "application:collaboration";

type Beta08MaintenanceOutcome = Readonly<{
	commandId: string;
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	stateBefore: string | null;
	stateAfter: string | null;
	version: number | null;
}>;

type Beta08Durable = Readonly<{
	worker(
		options?: Readonly<{
			workerId?: string;
			claimBatch?: number;
			leaseMilliseconds?: number;
			heartbeatMilliseconds?: number;
			attemptDeadlineMilliseconds?: number;
			resultBytesLimit?: number;
		}>,
	): Readonly<{
		workerId: string;
		poll(): Promise<unknown>;
		beginDrain(): void;
	}>;
	poll(
		options?: Readonly<{ workerId?: string; resultBytesLimit?: number }>,
	): Promise<
		Readonly<{
			admitted: number;
			cancelled: number;
			claimed: number;
			refusedIncompatible: number;
			outcomes: readonly Readonly<{
				runId: string;
				resource: string;
				attemptNumber: number;
				outcome: string;
				failureCode: string | null;
			}>[];
		}>
	>;
	inspect(runId: string): Promise<Readonly<{
		version: number;
		state: string;
		attemptCount: number;
		cancellationRequested: boolean;
		deadLetter: boolean;
		failureCode: string | null;
		resultBytes: Uint8Array | null;
	}> | null>;
	events(runId: string): Promise<
		readonly Readonly<{
			sequence: number;
			kind: string;
			errorCode: string | null;
		}>[]
	>;
	effects(runId: string): Promise<
		readonly Readonly<{
			effectName: string;
			status: string;
			receipt: string | null;
		}>[]
	>;
	audit(runId: string): Promise<
		readonly Readonly<{
			command: string;
			outcome: string;
			rejectionCode: string | null;
			actor: Readonly<{ kind: string; id: string }>;
			stateBefore: string;
			stateAfter: string;
			reason: string | null;
		}>[]
	>;
	cancelRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: unknown;
			expectedVersion?: number;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
	retryRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: unknown;
			expectedVersion?: number;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			reason: string;
			actor: unknown;
			expectedVersion?: number;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
}>;

type Beta08Application = Readonly<{
	fetch(request: Request): Promise<Response>;
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				mutations: Readonly<{
					message: Readonly<{
						publish(
							input: Readonly<{ channelId: string; body: string }>,
							options: Readonly<{ callId: string }>,
						): Promise<Readonly<{ id: string }>>;
					}>;
				}>;
			}>,
		) => Promise<Result> | Result,
	): Promise<Result>;
	durable: Beta08Durable;
	close(): Promise<void>;
}>;

export type Beta08Harness = Readonly<{
	app: Beta08Application;
	createSiblingApplication(): Promise<Beta08Application>;
	createRetainedApplication(): Promise<Beta08Application>;
	fetch(request: Request): Promise<Response>;
	bindPrincipal(request: Request): Request;
	mutationRequest(operation: string, input: unknown): Request;
	compilation: Readonly<{
		measurements: Readonly<{
			publicDeclarationBytes: number;
			typescriptInstantiations: number;
		}>;
	}>;
	kernel: DurableKernel;
	ledger: DurableEffectLedger;
	database: PostgresTransactionRunner;
	maintenance: Beta08Durable;
	kernelWith(
		options: Readonly<{ random?: () => number; claimBatch?: number }>,
	): DurableKernel;
	reactionProjectionBytes: string;
	runtimeBuildDigest: string;
	principal: Principal;
	readerPrincipal: Principal;
}>;

/**
 * Builds the BETA-08 tracer: the accepted BETA-05 relocated application over a
 * fresh PostgreSQL schema, plus the same durable kernel factories the generated
 * application wires internally.
 */
async function buildBeta08Durable(
	database: SQL,
): Promise<Readonly<{ harness: Beta08Harness; dispose: () => Promise<void> }>> {
	const prepared = await prepareBeta05PostgresApplication(database);
	const applications = new Set<Beta08Application>();
	let databaseOwner: PostgresDatabase | undefined;
	let retained: ReturnType<typeof prepareBeta05RetainedApplication> | undefined;
	let disposed = false;
	const dispose = async () => {
		if (disposed) return;
		disposed = true;
		const outcomes = await Promise.allSettled(
			[...applications].map(async (application) => application.close()),
		);
		outcomes.push(
			...(await Promise.allSettled([
				Promise.resolve().then(() =>
					databaseOwner?.close({ deadlineAt: Date.now() + 5_000 }),
				),
			])),
		);
		outcomes.push(
			...(await Promise.allSettled([
				Promise.resolve().then(() => prepared.dispose()),
				retained?.then(
					(build) => build.dispose(),
					() => undefined,
				),
			])),
		);
		const failures = outcomes.flatMap((outcome) =>
			outcome.status === "rejected" ? [outcome.reason] : [],
		);
		if (failures.length)
			throw new AggregateError(failures, "BETA-08 fixture cleanup failed");
	};
	try {
		// The relocated fixture links its own `questpie` module, so its branded
		// Principal is the trusted value the maintenance surface requires.
		const framework = prepared.generated.framework as Readonly<{
			principal: Readonly<{ user(input: Readonly<{ id: string }>): Principal }>;
		}>;
		const internal = (await prepared.generated.loadInternal()) as Readonly<{
			bindIngressPrincipalForRequest(
				request: Request,
				principal: unknown,
			): Request;
			createApplication(
				input: Readonly<{
					postgres: Readonly<{
						connectionUrl: string;
						directConnectionUrl: string;
					}>;
					realtime: Readonly<{ hmacKey: Uint8Array }>;
					maintenance: Readonly<{
						authorize(
							input: Readonly<{
								actor: Readonly<{ kind: string; id: string }>;
								command: string;
								runId: string;
							}>,
						): boolean | Promise<boolean>;
					}>;
				}>,
			): Promise<Beta08Application>;
		}>;
		const currentRuntimeBuildBytes = prepared.runtimeBuildBytes;
		const currentRuntimeBuild = JSON.parse(
			currentRuntimeBuildBytes,
		) as Readonly<Record<string, unknown>>;
		const createApplication = async (entry = internal) => {
			const application = await entry.createApplication({
				postgres: {
					connectionUrl: beta05PostgresUrl(),
					directConnectionUrl: beta05PostgresUrl(),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(8) },
				maintenance: {
					authorize: ({ actor }) => actor.id === beta05Ids.principal,
				},
			});
			applications.add(application);
			return application;
		};
		const createRetainedApplication = async () => {
			const build = await (retained ??= prepareBeta05RetainedApplication());
			const manifest = JSON.parse(build.runtimeBuildBytes) as Readonly<
				Record<string, unknown>
			>;
			if (manifest.digest === currentRuntimeBuild.digest)
				throw new Error(
					"Retained fixture must carry distinct executable bytes",
				);
			for (const key of [
				"application",
				"internalProtocol",
				"schemaFingerprint",
				"committedMigrationsDigest",
				"clientContractDigest",
				"operationHttpContractDigest",
				"policyProjectionDigest",
				"postgresContextBootstrapPlansDigest",
			])
				if (manifest[key] !== currentRuntimeBuild[key])
					throw new Error(`Retained fixture changed ${key} compatibility`);
			return createApplication(
				(await build.generated.loadInternal()) as typeof internal,
			);
		};
		const app = await createApplication();
		// Load the source database owner only after the generated application bundle.
		// Bun cannot load the source `pg` entry while the independently bundled copy
		// is still being initialized by the generated module.
		const { createPostgresDatabase } =
			await import("../../../../packages/runtime/src/postgres");
		const runtimeDatabase = (databaseOwner = createPostgresDatabase({
			connectionUrl: beta05PostgresUrl(),
			directConnectionUrl: beta05PostgresUrl(),
			pool: {
				max: 4,
				connectTimeoutMs: 5_000,
				checkoutTimeoutMs: 5_000,
				idleTimeoutMs: 1_000,
				maxLifetimeSeconds: 60,
			},
			timeouts: {
				statementMs: 10_000,
				lockMs: 2_000,
				idleInTransactionMs: 10_000,
			},
		}));
		const reactionProjectionBytes = await Bun.file(
			resolve(prepared.generated.generatedRoot, "reaction-projection.json"),
		).text();
		const runtimeBuild = JSON.parse(prepared.runtimeBuildBytes) as Readonly<{
			application: string;
			clientContractDigest: string;
			operationHttpContractDigest: string;
		}>;
		const principal = framework.principal.user({ id: beta05Ids.principal });
		const readerPrincipal = framework.principal.user({
			id: beta05Ids.readerPrincipal,
		});
		const reactions = linkReactionProjection(
			JSON.parse(reactionProjectionBytes),
		);
		const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
			database: runtimeDatabase,
		});
		const runExplicitNullAttempt = <Result>(
			claim: DurableClaim,
			use: () => Result | Promise<Result>,
		) =>
			attemptPostgres.run({
				observation: null,
				principalKind: claim.principal.kind,
				signal: undefined,
				use,
			});
		const exposeKernel = (kernel: DurableKernel): DurableKernel =>
			Object.freeze<DurableKernel>({
				...kernel,
				heartbeat: (claim) =>
					runExplicitNullAttempt(claim, () => kernel.heartbeat(claim)),
				succeed: (claim, resultBytes) =>
					runExplicitNullAttempt(claim, () =>
						kernel.succeed(claim, resultBytes),
					),
				fail: (claim, failure) =>
					runExplicitNullAttempt(claim, () => kernel.fail(claim, failure)),
				cancel: (claim) =>
					runExplicitNullAttempt(claim, () => kernel.cancel(claim)),
			});
		const exposeLedger = (ledger: DurableEffectLedger): DurableEffectLedger =>
			Object.freeze<DurableEffectLedger>({
				...ledger,
				reserve: (claim, request) =>
					runExplicitNullAttempt(claim, () => ledger.reserve(claim, request)),
				settle: (claim, request) =>
					runExplicitNullAttempt(claim, () => ledger.settle(claim, request)),
				markAmbiguous: (claim, request) =>
					runExplicitNullAttempt(claim, () =>
						ledger.markAmbiguous(claim, request),
					),
			});
		const createKernel = (
			options: Readonly<{ random?: () => number; claimBatch?: number }> = {},
		) =>
			createPostgresDatabaseDurableKernel({
				runtimeBuildDigest: String(currentRuntimeBuild.digest),
				database: runtimeDatabase,
				attemptDatabase: attemptPostgres.database,
				application: beta08Application,
				reactions,
				claimBatch: options.claimBatch,
				random: options.random,
			});
		const kernel = exposeKernel(createKernel());
		const ledger = exposeLedger(
			createPostgresDatabaseDurableEffectLedger({
				database: runtimeDatabase,
				attemptDatabase: attemptPostgres.database,
				application: beta08Application,
			}),
		);
		const harness = Object.freeze({
			app,
			createSiblingApplication: () => createApplication(),
			createRetainedApplication,
			fetch: (request: Request) => app.fetch(request),
			bindPrincipal: (request: Request) => {
				const headers = new Headers(request.headers);
				headers.set(
					"cookie",
					"questpie_tracer_session=f18f8b8e0e1446079dc6e6d4755505f9",
				);
				return internal.bindIngressPrincipalForRequest(
					new Request(request, { headers }),
					principal,
				);
			},
			mutationRequest: (operation: string, input: unknown) => {
				const name = operation.slice("mutation:".length);
				return new Request(`http://runtime.test/_questpie/mutation/${name}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						"Idempotency-Key": encodeURIComponent(crypto.randomUUID()),
						"Questpie-Application": runtimeBuild.application,
						"Questpie-Client-Contract": runtimeBuild.clientContractDigest,
						"Questpie-Wire-Digest": runtimeBuild.operationHttpContractDigest,
						"Questpie-Timeout-Milliseconds": "5000",
					},
					body: JSON.stringify({
						context: { companyId: beta05Ids.company },
						input,
					}),
				});
			},
			compilation: prepared.compilation,
			database: runtimeDatabase,
			kernel,
			kernelWith: (
				options: Readonly<{ random?: () => number; claimBatch?: number }>,
			) => exposeKernel(createKernel(options)),
			ledger,
			// The maintenance surface the generated application publishes: its
			// Principal brand is the one the relocated fixture mints, so a test drives
			// the same object an operator would.
			maintenance: app.durable,
			reactionProjectionBytes,
			runtimeBuildDigest: String(currentRuntimeBuild.digest),
			principal,
			readerPrincipal,
		});
		return Object.freeze({ harness, dispose });
	} catch (error) {
		try {
			await dispose();
		} catch (cleanupError) {
			throw new SuppressedError(
				cleanupError,
				error,
				"BETA-08 setup and cleanup failed",
			);
		}
		throw error;
	}
}

let building: Promise<
	Readonly<{ harness: Beta08Harness; dispose: () => Promise<void> }>
> | null = null;

/**
 * One relocated application per test process. Every test in a file shares it
 * and scopes its assertions by run identity: rebuilding it per test would drop
 * the schema under the previous test's live application.
 */
export async function beta08Harness(database: SQL): Promise<Beta08Harness> {
	building ??= buildBeta08Durable(database);
	return (await building).harness;
}

export async function disposeBeta08Harness(): Promise<void> {
	const built = building;
	building = null;
	// Failed construction already disposed its acquired resources and reported
	// any cleanup failures together with the original setup failure.
	if (built)
		await built.then(
			(value) => value.dispose(),
			() => undefined,
		);
}

/**
 * The same kernel factory linked against a Reaction whose contract digest no
 * longer matches the accepted run: a redeployed application whose executable
 * bytes were retired.
 */
export function retiredDurableKernel(
	database: PostgresTransactionRunner,
	reactionProjectionBytes: string,
	runtimeBuildDigest: string,
): DurableKernel {
	const projection = JSON.parse(reactionProjectionBytes) as Readonly<{
		reactions: Array<{ contractDigest: string }>;
	}>;
	for (const reaction of projection.reactions)
		reaction.contractDigest = "0".repeat(64);
	const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
		database,
	});
	const kernel = createPostgresDatabaseDurableKernel({
		runtimeBuildDigest,
		database,
		attemptDatabase: attemptPostgres.database,
		application: beta08Application,
		reactions: linkReactionProjection(projection),
	});
	return Object.freeze<DurableKernel>({
		...kernel,
		heartbeat: (claim) =>
			attemptPostgres.run({
				observation: null,
				principalKind: claim.principal.kind,
				signal: undefined,
				use: () => kernel.heartbeat(claim),
			}),
		succeed: (claim, resultBytes) =>
			attemptPostgres.run({
				observation: null,
				principalKind: claim.principal.kind,
				signal: undefined,
				use: () => kernel.succeed(claim, resultBytes),
			}),
		fail: (claim, failure) =>
			attemptPostgres.run({
				observation: null,
				principalKind: claim.principal.kind,
				signal: undefined,
				use: () => kernel.fail(claim, failure),
			}),
		cancel: (claim) =>
			attemptPostgres.run({
				observation: null,
				principalKind: claim.principal.kind,
				signal: undefined,
				use: () => kernel.cancel(claim),
			}),
	});
}

export { beta05Ids };
