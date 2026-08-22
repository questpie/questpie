import {
	QuestpiePostgresError,
	type PostgresTransaction,
	type PostgresTransactionRunner,
} from "../postgres/contract";
import {
	durableClaimAttemptInsert,
	durableClaimAttemptsExhaust,
	durableClaimAttemptsSupersede,
	durableClaimRunExhaust,
	durableClaimRunLease,
	durableClaimRunSelect,
	type DurableClaimRun,
} from "./postgres-claim-statements";
import {
	durableEventInsert,
	durableEventSequenceBump,
	durableKernelMarker,
	type DurableEventErrorCode,
	type DurableEventKind,
} from "./postgres-statements";
import type {
	LinkedReactionProjection,
	LinkedReactionRetry,
} from "./projection";
import {
	decodeRetryBytes,
	leaseTokenDigest,
	type DurableClaim,
	type DurableClaimOutcome,
} from "./rows";

type ClaimRequest = Readonly<{
	runId: string;
	workerId: string;
	leaseMilliseconds?: number;
	attemptDeadlineMilliseconds?: number;
}>;

function claim(
	row: DurableClaimRun,
	input: Readonly<{
		workerId: string;
		attemptId: string;
		attemptNumber: number;
		leaseToken: string;
		leaseMilliseconds: number;
		leaseExpiresAt: Date;
		deadlineAt: Date;
		retry: LinkedReactionRetry;
	}>,
): DurableClaim {
	return Object.freeze({
		runId: row.runId,
		dispatchId: row.dispatchId,
		resource: row.resource,
		attemptId: input.attemptId,
		attemptNumber: input.attemptNumber,
		leaseToken: input.leaseToken,
		leaseMilliseconds: input.leaseMilliseconds,
		leaseExpiresAt: input.leaseExpiresAt,
		deadlineAt: input.deadlineAt,
		workerId: input.workerId,
		tenantId: row.tenantId,
		principal: Object.freeze({
			kind: row.principalKind,
			id: row.principalId,
		}),
		contextInputBytes: row.contextInputBytes,
		payloadBytes: row.payloadBytes,
		retry: input.retry,
		runtimeBuildDigest: row.runtimeBuildDigest,
		executableDigest: row.executableDigest,
		causationId: row.causationId,
		correlationId: row.correlationId,
		cancellationRequested: row.cancellationRequested,
	});
}

async function appendEvent(
	transaction: PostgresTransaction,
	input: Readonly<{
		application: string;
		run: DurableClaimRun;
		kind: DurableEventKind;
		attemptId: string | null;
		leaseTokenDigest: string | null;
		errorCode?: DurableEventErrorCode | null;
	}>,
): Promise<void> {
	const bumped = await transaction.execute(durableEventSequenceBump, {
		application: input.application,
		runId: input.run.runId,
	});
	if (!bumped) throw new TypeError("Durable run history has no run");
	await transaction.execute(durableEventInsert, {
		application: input.application,
		runId: input.run.runId,
		sequence: bumped.sequence,
		resource: input.run.resource,
		dispatchId: input.run.dispatchId,
		attemptId: input.attemptId,
		leaseTokenDigest: input.leaseTokenDigest,
		causationId: input.run.causationId,
		correlationId: input.run.correlationId,
		kind: input.kind,
		errorCode: input.errorCode ?? null,
	});
}

export function createPostgresDatabaseDurableClaim(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		reactions: LinkedReactionProjection;
		randomUUID?: () => string;
	}>,
): (request: ClaimRequest) => Promise<DurableClaimOutcome> {
	const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
	return async (request) => {
		const leaseMilliseconds = request.leaseMilliseconds ?? 30_000;
		const deadlineMilliseconds = request.attemptDeadlineMilliseconds ?? 300_000;
		if (
			!Number.isSafeInteger(leaseMilliseconds) ||
			leaseMilliseconds < 1_000 ||
			leaseMilliseconds > 30_000
		)
			throw new TypeError("durable lease must be between 1000 and 30000 ms");
		if (
			!Number.isSafeInteger(deadlineMilliseconds) ||
			deadlineMilliseconds < leaseMilliseconds ||
			deadlineMilliseconds > 300_000
		)
			throw new TypeError("durable attempt deadline is outside its bound");

		try {
			return await input.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				use: async (transaction): Promise<DurableClaimOutcome> => {
					await transaction.execute(durableKernelMarker, undefined);
					const row = await transaction.execute(durableClaimRunSelect, {
						application: input.application,
						runId: request.runId,
					});
					if (row === null)
						return Object.freeze({ status: "skipped" as const });
					const reaction = input.reactions.byIdentity.get(row.resource);
					if (!reaction || reaction.contractDigest !== row.executableDigest)
						return Object.freeze({
							status: "refused" as const,
							code: "EXECUTABLE_RETIRED" as const,
						});
					const retry = decodeRetryBytes(row.retryBytes);
					const attemptNumber = row.attemptCount + 1;
					if (attemptNumber > retry.maximumAttempts) {
						const stale = await transaction.execute(
							durableClaimAttemptsExhaust,
							{ application: input.application, runId: request.runId },
						);
						await transaction.execute(durableClaimRunExhaust, {
							application: input.application,
							runId: request.runId,
						});
						await appendEvent(transaction, {
							application: input.application,
							run: row,
							kind: "failed",
							attemptId: stale[0]?.attemptId ?? null,
							leaseTokenDigest: stale[0]?.leaseTokenDigest ?? null,
							errorCode: "RETRY_EXHAUSTED",
						});
						return Object.freeze({ status: "skipped" as const });
					}

					const attemptId = randomUUID();
					const leaseToken = randomUUID();
					const tokenDigest = leaseTokenDigest(leaseToken);
					const leased = await transaction.execute(durableClaimRunLease, {
						application: input.application,
						runId: request.runId,
						attemptNumber,
						attemptId,
						leaseTokenDigest: tokenDigest,
						leaseSeconds: leaseMilliseconds / 1_000,
						deadlineSeconds: deadlineMilliseconds / 1_000,
					});
					const previous = await transaction.execute(
						durableClaimAttemptsSupersede,
						{ application: input.application, runId: request.runId, attemptId },
					);
					await transaction.execute(durableClaimAttemptInsert, {
						application: input.application,
						attemptId,
						runId: request.runId,
						attemptNumber,
						workerId: request.workerId,
						leaseTokenDigest: tokenDigest,
						leaseExpiresAt: leased.leaseExpiresAt,
						deadlineAt: leased.deadlineAt,
					});
					const claimed = claim(row, {
						workerId: request.workerId,
						attemptId,
						attemptNumber,
						leaseToken,
						leaseMilliseconds,
						leaseExpiresAt: leased.leaseExpiresAt,
						deadlineAt: leased.deadlineAt,
						retry,
					});
					for (const stale of previous)
						await appendEvent(transaction, {
							application: input.application,
							run: row,
							kind: "leaseSuperseded",
							attemptId: stale.attemptId,
							leaseTokenDigest: stale.leaseTokenDigest,
						});
					await appendEvent(transaction, {
						application: input.application,
						run: row,
						kind: "attemptStarted",
						attemptId,
						leaseTokenDigest: tokenDigest,
					});
					return Object.freeze({ status: "claimed" as const, claim: claimed });
				},
			});
		} catch (error) {
			if (
				error instanceof QuestpiePostgresError &&
				error.code === "serializationFailure"
			)
				return Object.freeze({ status: "skipped" as const });
			throw error;
		}
	};
}
