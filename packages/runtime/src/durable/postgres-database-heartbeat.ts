import type { PostgresTransactionRunner } from "../postgres/contract";
import {
	durableAttemptHeartbeat,
	durableKernelMarker,
	durableRunHeartbeat,
} from "./postgres-statements";
import type { DurableClaim, DurableHeartbeat } from "./rows";
import { leaseTokenDigest } from "./rows";

export function createPostgresDatabaseDurableHeartbeat(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
	}>,
): (claim: DurableClaim) => Promise<DurableHeartbeat> {
	return (claim) =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				const run = await transaction.execute(durableRunHeartbeat, {
					application: input.application,
					runId: claim.runId,
					attemptId: claim.attemptId,
					leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
					leaseSeconds: claim.leaseMilliseconds / 1_000,
				});
				if (!run.held)
					return Object.freeze({
						status: "fenced" as const,
						cancellationRequested: false,
						deadlineExpired: false,
					});
				const attempt = await transaction.execute(durableAttemptHeartbeat, {
					application: input.application,
					attemptId: claim.attemptId,
					leaseSeconds: claim.leaseMilliseconds / 1_000,
				});
				if (!attempt.found)
					throw new TypeError("Durable heartbeat lost its attempt");
				return Object.freeze({
					status: "held" as const,
					cancellationRequested: run.cancellationRequested,
					deadlineExpired: attempt.deadlineExpired,
				});
			},
		});
}
