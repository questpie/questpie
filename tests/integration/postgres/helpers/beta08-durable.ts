import { resolve } from "node:path";

import type { SQL } from "bun";

import {
	createPostgresDurableEffectLedger,
	createPostgresDurableKernel,
	createPostgresDurableMaintenance,
	linkReactionProjection,
	type DurableEffectLedger,
	type DurableKernel,
	type DurableMaintenance,
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
		}>[]
	>;
	cancelRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: Readonly<{ kind: string; id: string }>;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
	retryRun(
		input: Readonly<{
			runId: string;
			actor: Readonly<{ kind: string; id: string }>;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			actor: Readonly<{ kind: string; id: string }>;
		}>,
	): Promise<Beta08MaintenanceOutcome>;
}>;

type Beta08Application = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: unknown;
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
	compilation: Readonly<{
		measurements: Readonly<{
			publicDeclarationBytes: number;
			typescriptInstantiations: number;
		}>;
	}>;
	kernel: DurableKernel;
	ledger: DurableEffectLedger;
	maintenance: DurableMaintenance;
	reactionProjectionBytes: string;
	principal: unknown;
	dispose(): Promise<void>;
}>;

/**
 * Builds the BETA-08 tracer: the accepted BETA-05 relocated application over a
 * fresh PostgreSQL schema, plus the same durable kernel factories the generated
 * application wires internally.
 */
export async function prepareBeta08Durable(
	database: SQL,
	options?: Readonly<{ random?: () => number; claimBatch?: number }>,
): Promise<Beta08Harness> {
	const prepared = await prepareBeta05PostgresApplication(database);
	const framework = prepared.generated.framework as Readonly<{
		principal: Readonly<{ user(input: Readonly<{ id: string }>): unknown }>;
	}>;
	const internal = (await prepared.generated.loadInternal()) as Readonly<{
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
	const reactions = linkReactionProjection(JSON.parse(reactionProjectionBytes));
	return Object.freeze({
		app,
		compilation: prepared.compilation,
		kernel: createPostgresDurableKernel({
			sql: database,
			application: beta08Application,
			reactions,
			claimBatch: options?.claimBatch,
			random: options?.random,
		}),
		ledger: createPostgresDurableEffectLedger({
			sql: database,
			application: beta08Application,
		}),
		maintenance: createPostgresDurableMaintenance({
			sql: database,
			application: beta08Application,
		}),
		reactionProjectionBytes,
		principal: framework.principal.user({ id: beta05Ids.principal }),
		dispose: async () => {
			await app.close();
			await prepared.dispose();
		},
	});
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
