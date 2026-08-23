import type { SQL } from "bun";

import { createBunDurablePostgresTransactionRunner } from "./postgres-bun-compatibility";
import { createPostgresDatabaseDurableClaim } from "./postgres-database-claim";
import { createPostgresDatabaseDurableHeartbeat } from "./postgres-database-heartbeat";
import { createPostgresDatabaseDurableInspection } from "./postgres-database-inspection";
import { createPostgresDatabaseDurableScheduling } from "./postgres-database-scheduling";
import { createPostgresDatabaseDurableTerminal } from "./postgres-database-terminal";
import type { LinkedReactionProjection } from "./projection";
import type { DurableKernel } from "./rows";

export function createPostgresDurableKernel(
	input: Readonly<{
		sql: SQL;
		application: string;
		reactions: LinkedReactionProjection;
		claimBatch?: number;
		random?: () => number;
	}>,
): DurableKernel {
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
				[...input.reactions.byIdentity.values()].map(
					(reaction) => reaction.contractDigest,
				),
			),
		].sort(),
	);
	const database = createBunDurablePostgresTransactionRunner(input.sql);
	const scheduling = createPostgresDatabaseDurableScheduling({
		database,
		application: input.application,
		executableDigests,
		maximumBatch,
	});
	const inspection = createPostgresDatabaseDurableInspection({
		database,
		application: input.application,
	});
	const terminal = createPostgresDatabaseDurableTerminal({
		database,
		application: input.application,
		random: input.random ?? Math.random,
	});

	return Object.freeze<DurableKernel>({
		application: input.application,
		admit: scheduling.admit,
		reapCancelled: scheduling.reapCancelled,
		claim: createPostgresDatabaseDurableClaim({
			database,
			application: input.application,
			reactions: input.reactions,
		}),
		heartbeat: createPostgresDatabaseDurableHeartbeat({
			database,
			application: input.application,
		}),
		succeed: terminal.succeed,
		fail: terminal.fail,
		cancel: terminal.cancel,
		inspect: inspection.inspect,
		events: inspection.events,
	});
}
