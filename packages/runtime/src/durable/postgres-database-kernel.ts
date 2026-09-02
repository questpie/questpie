import type { PostgresTransactionRunner } from "../postgres";
import type { LinkedJobProjection } from "./job-projection";
import {
	assertDurableAttemptPostgresTransactionRunner,
	type DurableAttemptPostgresTransactionRunner,
} from "./postgres-attempt-observation";
import { createPostgresDatabaseDurableClaim } from "./postgres-database-claim";
import { createPostgresDatabaseDurableHeartbeat } from "./postgres-database-heartbeat";
import { createPostgresDatabaseDurableInspection } from "./postgres-database-inspection";
import { createPostgresDatabaseDurableScheduling } from "./postgres-database-scheduling";
import { createPostgresDatabaseDurableTerminal } from "./postgres-database-terminal";
import type { LinkedReactionProjection } from "./projection";
import type { DurableKernel } from "./rows";

export function createPostgresDatabaseDurableKernel(
	input: Readonly<{
		database: PostgresTransactionRunner;
		attemptDatabase: DurableAttemptPostgresTransactionRunner;
		application: string;
		reactions: LinkedReactionProjection;
		jobs?: LinkedJobProjection;
		claimBatch?: number;
		random?: () => number;
	}>,
): DurableKernel {
	assertDurableAttemptPostgresTransactionRunner(input.attemptDatabase);
	const maximumBatch = input.claimBatch ?? 64;
	if (
		!Number.isSafeInteger(maximumBatch) ||
		maximumBatch < 1 ||
		maximumBatch > 64
	)
		throw new TypeError("durable claim batch must be between 1 and 64");
	const executableDigests = Object.freeze(
		[
			...new Set(
				[
					...input.reactions.byIdentity.values(),
					...(input.jobs?.byIdentity.values() ?? []),
				].map((definition) => definition.contractDigest),
			),
		].sort(),
	);
	const scheduling = createPostgresDatabaseDurableScheduling({
		database: input.database,
		application: input.application,
		executableDigests,
		maximumBatch,
	});
	const inspection = createPostgresDatabaseDurableInspection({
		database: input.database,
		application: input.application,
	});
	const terminal = createPostgresDatabaseDurableTerminal({
		database: input.attemptDatabase,
		application: input.application,
		random: input.random ?? Math.random,
	});

	return Object.freeze<DurableKernel>({
		application: input.application,
		admit: scheduling.admit,
		reapCancelled: scheduling.reapCancelled,
		claim: createPostgresDatabaseDurableClaim({
			database: input.database,
			application: input.application,
			reactions: input.reactions,
			jobs: input.jobs,
		}),
		heartbeat: createPostgresDatabaseDurableHeartbeat({
			database: input.attemptDatabase,
			application: input.application,
		}),
		succeed: terminal.succeed,
		fail: terminal.fail,
		cancel: terminal.cancel,
		inspect: inspection.inspect,
		events: inspection.events,
	});
}
