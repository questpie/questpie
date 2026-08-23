import {
	QuestpiePostgresError,
	type PostgresTransactionRunner,
} from "../postgres/contract";
import { appendPostgresDatabaseDurableRunEvent } from "./postgres-database-event";
import {
	durableAdmissionSelect,
	durableCancelledAttemptsComplete,
	durableCancelledRunsReap,
} from "./postgres-scheduling-statements";
import { durableKernelMarker } from "./postgres-statements";
import type { DurableAdmission } from "./rows";

export function createPostgresDatabaseDurableScheduling(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		executableDigests: readonly string[];
		maximumBatch: number;
	}>,
): Readonly<{
	admit(batch?: number): Promise<readonly DurableAdmission[]>;
	reapCancelled(limit?: number): Promise<number>;
}> {
	const executableDigests = Object.freeze([...input.executableDigests]);
	const executableDigestSet = new Set(executableDigests);
	const bounded = (value: number, label: string): number => {
		if (!Number.isSafeInteger(value) || value < 1 || value > input.maximumBatch)
			throw new TypeError(
				`durable ${label} batch must be between 1 and ${input.maximumBatch}`,
			);
		return value;
	};
	return Object.freeze({
		async admit(batch = input.maximumBatch) {
			const limit = bounded(batch, "admission");
			const admitted = await input.database.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) =>
					transaction.execute(durableAdmissionSelect, {
						application: input.application,
						executableDigests,
						batch: limit,
					}),
			});
			if (
				admitted.length > limit ||
				admitted.some(
					({ executableDigest }) => !executableDigestSet.has(executableDigest),
				)
			)
				throw new TypeError("invalid PostgreSQL Durable admission result");
			return admitted;
		},
		async reapCancelled(limit = input.maximumBatch) {
			const boundedLimit = bounded(limit, "cancellation reap");
			try {
				return await input.database.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: async (transaction) => {
						await transaction.execute(durableKernelMarker, undefined);
						const cancelled = await transaction.execute(
							durableCancelledRunsReap,
							{
								application: input.application,
								limit: boundedLimit,
							},
						);
						if (cancelled.length > boundedLimit)
							throw new TypeError(
								"invalid PostgreSQL Durable cancellation reap result",
							);
						for (const run of cancelled) {
							await transaction.execute(durableCancelledAttemptsComplete, {
								application: input.application,
								runId: run.runId,
							});
							await appendPostgresDatabaseDurableRunEvent(transaction, {
								application: input.application,
								claim: {
									runId: run.runId,
									dispatchId: run.dispatchId,
									resource: run.resource,
									attemptId: null,
									leaseToken: null,
									causationId: run.causationId,
									correlationId: run.correlationId,
								},
								kind: "cancelled",
							});
						}
						return cancelled.length;
					},
				});
			} catch (error) {
				if (
					error instanceof QuestpiePostgresError &&
					error.code === "serializationFailure"
				)
					return 0;
				throw error;
			}
		},
	});
}
