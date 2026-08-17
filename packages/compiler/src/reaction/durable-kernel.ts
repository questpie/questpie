import { digest } from "../canonical";

/**
 * The compiler-owned projection of the accepted shared durable kernel: one
 * state machine, one lease and fence contract, one bounded budget table, and
 * one closed append-only event vocabulary. Job and Workflow are later
 * capability projections over this same contract, so it names no Reaction.
 */
export interface DurableKernelContractV1 {
	readonly format: "questpie.durable-kernel";
	readonly version: 1;
	readonly states: readonly string[];
	readonly terminalStates: readonly string[];
	readonly transitions: readonly Readonly<{ from: string; to: string }>[];
	readonly lease: Readonly<{
		defaultMilliseconds: number;
		minimumMilliseconds: number;
		heartbeatMilliseconds: number;
		attemptDeadlineMilliseconds: number;
		fence: readonly string[];
		claimLock: "forUpdateSkipLocked";
		claimCommitsBeforeHandler: true;
	}>;
	readonly budgets: Readonly<Record<string, number>>;
	readonly eventKinds: readonly string[];
	readonly failureCodes: readonly string[];
	readonly permanentFailureCodes: readonly string[];
	readonly claimRefusalCodes: readonly string[];
	readonly maintenanceRejectionCodes: readonly string[];
	readonly maintenanceCommands: readonly string[];
	readonly effectStatuses: readonly string[];
	readonly digest: string;
}

const withoutDigest = {
	format: "questpie.durable-kernel" as const,
	version: 1 as const,
	states: [
		"cancelled",
		"delayed",
		"failed",
		"ready",
		"running",
		"succeeded",
	] as const,
	terminalStates: ["cancelled", "failed", "succeeded"] as const,
	transitions: [
		{ from: "delayed", to: "cancelled" },
		{ from: "delayed", to: "running" },
		{ from: "failed", to: "ready" },
		{ from: "ready", to: "cancelled" },
		{ from: "ready", to: "running" },
		{ from: "running", to: "cancelled" },
		{ from: "running", to: "delayed" },
		{ from: "running", to: "failed" },
		{ from: "running", to: "succeeded" },
	] as const,
	lease: {
		defaultMilliseconds: 30_000,
		minimumMilliseconds: 1_000,
		heartbeatMilliseconds: 10_000,
		attemptDeadlineMilliseconds: 300_000,
		fence: ["currentAttemptId", "leaseTokenDigest"] as const,
		claimLock: "forUpdateSkipLocked" as const,
		claimCommitsBeforeHandler: true as const,
	},
	// Only the budgets this slice actually enforces are pinned into the
	// compatibility contract the Runtime Build digests. The accepted per-Principal
	// attempt, pending-run, dead-letter, and retention budgets arrive with the
	// slice that enforces them.
	budgets: {
		claimBatch: 64,
		eventsPerRun: 1_024,
		payloadBytes: 262_144,
		resultBytes: 262_144,
		retryHorizonMilliseconds: 86_400_000,
	},
	eventKinds: [
		"accepted",
		"ambiguityAcknowledged",
		"attemptStarted",
		"cancellationRequested",
		"cancelled",
		"effectAmbiguous",
		"effectSettled",
		"failed",
		"leaseSuperseded",
		"retryScheduled",
		"succeeded",
	] as const,
	failureCodes: [
		"EFFECT_AMBIGUOUS",
		"EFFECT_CONFLICT",
		"HANDLER_FAILED",
		"REACTION_ERROR",
		"RESOURCE_LIMIT",
		"RETRY_EXHAUSTED",
		"RUN_AS_DENIED",
		"VALIDATION_FAILED",
	] as const,
	permanentFailureCodes: [
		"EFFECT_AMBIGUOUS",
		"EFFECT_CONFLICT",
		"REACTION_ERROR",
		"RESOURCE_LIMIT",
		"RUN_AS_DENIED",
		"VALIDATION_FAILED",
	] as const,
	claimRefusalCodes: ["EXECUTABLE_RETIRED"] as const,
	maintenanceRejectionCodes: [
		"ALREADY_REQUESTED",
		"ATTEMPTS_EXHAUSTED",
		"NOT_AMBIGUOUS",
		"RUN_IS_TERMINAL",
		"RUN_NOT_FAILED",
	] as const,
	maintenanceCommands: [
		"acknowledgeAmbiguity",
		"cancelRun",
		"retryRun",
	] as const,
	effectStatuses: [
		"acknowledged",
		"ambiguous",
		"pending",
		"succeeded",
	] as const,
};

export const durableKernelDigest = digest(
	"questpie-durable-kernel-v1",
	withoutDigest,
);

export const durableKernelContract: DurableKernelContractV1 = Object.freeze({
	...withoutDigest,
	digest: durableKernelDigest,
}) as DurableKernelContractV1;
