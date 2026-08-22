import type { PostgresTransactionRunner } from "../postgres/contract";
import { appendPostgresDatabaseDurableRunEvent } from "./postgres-database-event";
import { durableKernelMarker } from "./postgres-statements";
import {
	durableAttemptComplete,
	durableRunRetry,
	durableRunTerminal,
} from "./postgres-terminal-statements";
import type {
	DurableClaim,
	DurableFailureCode,
	DurableTransition,
} from "./rows";
import { leaseTokenDigest, retryDelayMilliseconds } from "./rows";

const permanentFailureCodes: ReadonlySet<DurableFailureCode> = new Set([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);

export function createPostgresDatabaseDurableTerminal(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		random?: () => number;
	}>,
): Readonly<{
	succeed(
		claim: DurableClaim,
		resultBytes: Uint8Array,
	): Promise<DurableTransition>;
	fail(
		claim: DurableClaim,
		failure: Readonly<{ code: DurableFailureCode }>,
	): Promise<DurableTransition>;
	cancel(claim: DurableClaim): Promise<DurableTransition>;
}> {
	const random = input.random ?? Math.random;
	const transition = (
		claim: DurableClaim,
		detail: Readonly<{
			outcome: "cancelled" | "failed" | "succeeded";
			state: "cancelled" | "failed" | "succeeded";
			failureCode: DurableFailureCode | null;
			resultBytes: Uint8Array | null;
			deadLetter: boolean;
			eventKind: "cancelled" | "failed" | "succeeded";
		}>,
	): Promise<DurableTransition> =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				const applied = await transaction.execute(durableRunTerminal, {
					application: input.application,
					runId: claim.runId,
					attemptId: claim.attemptId,
					leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
					state: detail.state,
					resultBytes: detail.resultBytes,
					failureCode: detail.failureCode,
					deadLetter: detail.deadLetter,
				});
				if (applied === null)
					return Object.freeze({
						status: "fenced" as const,
						state: null,
						deadLetter: false,
					});
				if (applied.state !== detail.state)
					throw new TypeError("Durable terminal returned the wrong state");
				await transaction.execute(durableAttemptComplete, {
					application: input.application,
					attemptId: claim.attemptId,
					outcome: detail.outcome,
					failureCode: detail.outcome === "failed" ? detail.failureCode : null,
				});
				await appendPostgresDatabaseDurableRunEvent(transaction, {
					application: input.application,
					claim,
					kind: detail.eventKind,
					errorCode: detail.failureCode,
				});
				return Object.freeze({
					status: "applied" as const,
					state: detail.state,
					deadLetter: detail.deadLetter,
				});
			},
		});

	const retry = (
		claim: DurableClaim,
		failureCode: DurableFailureCode,
	): Promise<DurableTransition> =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				const applied = await transaction.execute(durableRunRetry, {
					application: input.application,
					runId: claim.runId,
					attemptId: claim.attemptId,
					leaseTokenDigest: leaseTokenDigest(claim.leaseToken),
					failureCode,
					delaySeconds:
						retryDelayMilliseconds(claim.retry, claim.attemptNumber, random) /
						1_000,
				});
				if (applied === null)
					return Object.freeze({
						status: "fenced" as const,
						state: null,
						deadLetter: false,
					});
				if (applied.state !== "delayed")
					throw new TypeError("Durable retry returned the wrong state");
				await transaction.execute(durableAttemptComplete, {
					application: input.application,
					attemptId: claim.attemptId,
					outcome: "failed",
					failureCode,
				});
				await appendPostgresDatabaseDurableRunEvent(transaction, {
					application: input.application,
					claim,
					kind: "retryScheduled",
					errorCode: failureCode,
				});
				return Object.freeze({
					status: "applied" as const,
					state: "delayed" as const,
					deadLetter: false,
				});
			},
		});

	return Object.freeze({
		succeed: (claim, resultBytes) =>
			transition(claim, {
				outcome: "succeeded",
				state: "succeeded",
				failureCode: null,
				resultBytes,
				deadLetter: false,
				eventKind: "succeeded",
			}),
		fail: (claim, failure) => {
			const exhausted = claim.attemptNumber >= claim.retry.maximumAttempts;
			if (!permanentFailureCodes.has(failure.code) && !exhausted)
				return retry(claim, failure.code);
			return transition(claim, {
				outcome: "failed",
				state: "failed",
				failureCode: permanentFailureCodes.has(failure.code)
					? failure.code
					: "RETRY_EXHAUSTED",
				resultBytes: null,
				deadLetter: true,
				eventKind: "failed",
			});
		},
		cancel: (claim) =>
			transition(claim, {
				outcome: "cancelled",
				state: "cancelled",
				failureCode: null,
				resultBytes: null,
				deadLetter: false,
				eventKind: "cancelled",
			}),
	});
}
