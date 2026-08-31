import type { RuntimeExecutionObservation } from "../observation";
import { QuestpiePostgresError } from "../postgres/contract";
import type {
	DurableAttemptExecutionRequest,
	DurableWorkerOutcome,
} from "./worker";

/** Owns the complete physical Attempt lifetime, including durable settlement. */
export async function runObservedDurableAttempt(
	input: Readonly<{
		observation: RuntimeExecutionObservation | null;
		request: DurableAttemptExecutionRequest;
		use(): Promise<DurableWorkerOutcome>;
	}>,
): Promise<DurableWorkerOutcome> {
	if (input.observation === undefined)
		throw new TypeError("Durable Attempt observation decision is required");
	const kind =
		input.request.capability === "job" ? "job.attempt" : "reaction.attempt";
	const scope =
		input.observation === null
			? null
			: input.observation.begin({
					attemptId: input.request.attemptId,
					attemptNumber: input.request.attemptNumber,
					dispatchId: input.request.dispatchId,
					kind,
					principalKind: input.request.principal.kind,
					resourceIdentity: input.request.resource,
					runId: input.request.runId,
					trace: { kind: "root" },
				});
	if (!scope) return input.use();
	try {
		const outcome = await scope.run(input.use);
		switch (outcome.outcome) {
			case "succeeded":
				scope.event({ kind: "durable.terminal", outcome: "ok" });
				scope.end({ kind, outcome: "ok" });
				break;
			case "cancelled":
				scope.event({ kind: "durable.terminal", outcome: "cancelled" });
				scope.end({ kind, outcome: "cancelled" });
				break;
			case "fenced":
				scope.event({
					attemptId: input.request.attemptId,
					kind: "durable.fenced",
				});
				scope.end({ kind, outcome: "fenced" });
				break;
			case "retryScheduled":
				scope.event({
					attemptNumber: input.request.attemptNumber,
					kind: "durable.retry_scheduled",
					retryDelayMilliseconds: outcome.retryDelayMilliseconds,
				});
				scope.end({
					errorCode: outcome.failureCode ?? undefined,
					kind,
					outcome: "retry",
				});
				break;
			case "failed":
				scope.event({
					errorCode: outcome.failureCode ?? undefined,
					kind: "durable.terminal",
					outcome: "framework_error",
				});
				scope.end({
					errorCode: outcome.failureCode ?? undefined,
					kind,
					outcome: "framework_error",
				});
				break;
			case "refusedIncompatible":
			case "skipped":
				throw new TypeError("Unclaimed work cannot enter an Attempt scope");
		}
		return outcome;
	} catch (error) {
		const cancelled =
			input.request.signal.aborted &&
			(error === input.request.signal.reason ||
				(error instanceof QuestpiePostgresError && error.code === "cancelled"));
		scope.end({
			kind,
			outcome: cancelled ? "cancelled" : "framework_error",
		});
		throw error;
	}
}
