import { resolve } from "node:path";

import type { SQL } from "bun";
import type { Principal } from "questpie";

import {
	createPostgresDurableEffectLedger,
	createPostgresDurableKernel,
	linkReactionProjection,
	type DurableEffectLedger,
	type DurableKernel,
} from "../../../../packages/runtime/src/index";
import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./beta05-runtime";

const beta08Application = "application:collaboration";

type Beta08MaintenanceOutcome = Readonly<{
	commandId: string;
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	stateBefore: string;
	stateAfter: string;
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
			actor: unknown;
			expectedVersion?: number;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
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
					"message.publish"(
						input: Readonly<{ channelId: string; body: string }>,
						options: Readonly<{ callId: string }>,
					): Promise<Readonly<{ id: string }>>;
				}>;
			}>,
		) => Promise<Result> | Result,
	): Promise<Result>;
	durable: Beta08Durable;
	close(): Promise<void>;
}>;

export type Beta08Harness = Readonly<{
	app: Beta08Application;
	fetch(request: Request): Promise<Response>;
	bindPrincipal(request: Request): Request;
	wireFrame(
		operation: string,
		input: unknown,
	): Readonly<{ body: string; mediaType: string }>;
	compilation: Readonly<{
		measurements: Readonly<{
			publicDeclarationBytes: number;
			typescriptInstantiations: number;
		}>;
	}>;
	kernel: DurableKernel;
	ledger: DurableEffectLedger;
	maintenance: Beta08Durable;
	kernelWith(
		options: Readonly<{ random?: () => number; claimBatch?: number }>,
	): DurableKernel;
	reactionProjectionBytes: string;
	principal: Principal;
}>;

/**
 * Builds the BETA-08 tracer: the accepted BETA-05 relocated application over a
 * fresh PostgreSQL schema, plus the same durable kernel factories the generated
 * application wires internally.
 */
async function buildBeta08Durable(
	database: SQL,
): Promise<Readonly<{ harness: Beta08Harness; dispose: () => Promise<void> }>> {
	// The lane runs one process per file back to back, and rebuilding the
	// application schema takes an exclusive lock. A departing process that has
	// not released its connections yet would deadlock the reset, so this one
	// closes them and waits for the backends to actually go.
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const [remaining] = await database.unsafe<
			readonly Readonly<{ others: number }>[]
		>(
			`SELECT count(*)::int AS others FROM pg_catalog.pg_stat_activity
WHERE datname = pg_catalog.current_database()
  AND pid <> pg_catalog.pg_backend_pid()`,
		);
		if ((remaining?.others ?? 0) === 0) break;
		await database.unsafe(
			`SELECT pg_catalog.pg_terminate_backend(pid)
FROM pg_catalog.pg_stat_activity
WHERE datname = pg_catalog.current_database()
  AND pid <> pg_catalog.pg_backend_pid()`,
		);
		await Bun.sleep(25);
	}
	const prepared = await prepareBeta05PostgresApplication(database);
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
				postgres: Readonly<{ url: string }>;
				realtime: Readonly<{ hmacKey: Uint8Array }>;
			}>,
		): Promise<Beta08Application>;
	}>;
	const app = await internal.createApplication({
		postgres: { url: beta05PostgresUrl() },
		realtime: { hmacKey: new Uint8Array(32).fill(8) },
	});
	const reactionProjectionBytes = await Bun.file(
		resolve(prepared.generated.generatedRoot, "reaction-projection.json"),
	).text();
	const runtimeBuild = JSON.parse(prepared.runtimeBuildBytes) as Readonly<{
		application: string;
		clientContractDigest: string;
		wireDigest: string;
	}>;
	const wire = JSON.parse(
		await Bun.file(
			resolve(prepared.generated.generatedRoot, "wire-contract.json"),
		).text(),
	) as Readonly<{ mediaType: string; protocol: unknown }>;
	const principal = framework.principal.user({ id: beta05Ids.principal });
	const reactions = linkReactionProjection(JSON.parse(reactionProjectionBytes));
	const harness = Object.freeze({
		app,
		fetch: (request: Request) => app.fetch(request),
		bindPrincipal: (request: Request) =>
			internal.bindIngressPrincipalForRequest(request, principal),
		wireFrame: (operation: string, input: unknown) =>
			Object.freeze({
				mediaType: wire.mediaType,
				body: JSON.stringify({
					application: runtimeBuild.application,
					callId: crypto.randomUUID(),
					clientContractDigest: runtimeBuild.clientContractDigest,
					context: { companyId: beta05Ids.company },
					input,
					operation,
					protocol: wire.protocol,
					timeoutMilliseconds: 5_000,
					wireDigest: runtimeBuild.wireDigest,
				}),
			}),
		compilation: prepared.compilation,
		kernel: createPostgresDurableKernel({
			sql: database,
			application: beta08Application,
			reactions,
		}),
		kernelWith: (
			options: Readonly<{ random?: () => number; claimBatch?: number }>,
		) =>
			createPostgresDurableKernel({
				sql: database,
				application: beta08Application,
				reactions,
				claimBatch: options.claimBatch,
				random: options.random,
			}),
		ledger: createPostgresDurableEffectLedger({
			sql: database,
			application: beta08Application,
		}),
		// The maintenance surface the generated application publishes: its
		// Principal brand is the one the relocated fixture mints, so a test drives
		// the same object an operator would.
		maintenance: app.durable,
		reactionProjectionBytes,
		principal,
	});
	return Object.freeze({
		harness,
		dispose: async () => {
			await app.close();
			await prepared.dispose();
		},
	});
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
	if (built) await (await built).dispose();
}

/**
 * The same kernel factory linked against a Reaction whose contract digest no
 * longer matches the accepted run: a redeployed application whose executable
 * bytes were retired.
 */
export function retiredDurableKernel(
	database: SQL,
	reactionProjectionBytes: string,
): DurableKernel {
	const projection = JSON.parse(reactionProjectionBytes) as Readonly<{
		reactions: Array<{ contractDigest: string }>;
	}>;
	for (const reaction of projection.reactions)
		reaction.contractDigest = "0".repeat(64);
	return createPostgresDurableKernel({
		sql: database,
		application: beta08Application,
		reactions: linkReactionProjection(projection),
	});
}

export { beta05Ids };
