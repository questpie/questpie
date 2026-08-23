import type {
	PostgresTransaction,
	PostgresTransactionRunner,
} from "../postgres/contract";
import type {
	DurableMaintenance,
	DurableMaintenanceAuthority,
	DurableMaintenanceCommand,
	DurableMaintenanceOutcome,
	DurableMaintenanceRejection,
} from "./maintenance-contract";
import { appendPostgresDatabaseDurableRunEvent } from "./postgres-database-event";
import {
	durableMaintenanceAuditInsert,
	durableMaintenanceAuditRead,
	durableMaintenanceCancellationInsert,
	durableMaintenanceEffectAcknowledge,
	durableMaintenanceRunCancelClaimed,
	durableMaintenanceRunCancelUnclaimed,
	durableMaintenanceRunRead,
	durableMaintenanceRunReadLocked,
	durableMaintenanceRunRetry,
	durableMaintenanceRunStateRead,
	durableMaintenanceVersionRead,
	type DurableMaintenanceRun,
} from "./postgres-maintenance-statements";
import {
	durableKernelMarker,
	type DurableEventKind,
} from "./postgres-statements";
import type { DurableActor, DurableRunState } from "./rows";

type DatabaseMaintenance = Readonly<{
	cancelRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: DurableActor;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	retryRun(
		input: Readonly<{
			runId: string;
			reason: string;
			actor: DurableActor;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			reason: string;
			actor: DurableActor;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	audit: DurableMaintenance["audit"];
}>;

type Request = Readonly<{
	runId: string;
	reason: string;
	actor: DurableActor;
	expectedVersion?: number;
}>;

const terminalStates: ReadonlySet<DurableRunState> = new Set([
	"cancelled",
	"failed",
	"succeeded",
]);

export function createPostgresDatabaseDurableMaintenance(
	input: Readonly<{
		database: PostgresTransactionRunner;
		application: string;
		authorize: DurableMaintenanceAuthority;
		randomUUID?: () => string;
	}>,
): DatabaseMaintenance {
	const randomUUID = input.randomUUID ?? (() => crypto.randomUUID());
	const identity = (runId: string) => ({
		application: input.application,
		runId,
	});
	const authorityDenial = (
		commandId: string,
		command: DurableMaintenanceCommand,
	): DurableMaintenanceOutcome =>
		Object.freeze({
			commandId,
			command,
			outcome: "rejected" as const,
			rejectionCode: "AUTHORITY_DENIED" as const,
			stateBefore: null,
			stateAfter: null,
			version: null,
		});
	const validReason = (value: string): boolean =>
		value.length > 0 && !value.includes("\0") && [...value].length <= 256;
	const staleVersion = (
		run: DurableMaintenanceRun,
		expectedVersion: number | undefined,
	): boolean =>
		expectedVersion !== undefined && expectedVersion !== run.version;

	type AuditRecord = Readonly<{
		runId: string;
		command: DurableMaintenanceCommand;
		outcome: "applied" | "rejected";
		rejectionCode: DurableMaintenanceRejection | null;
		actor: DurableActor;
		stateBefore: DurableRunState;
		stateAfter: DurableRunState;
		reason: string | null;
	}>;

	const record = async (
		transaction: PostgresTransaction,
		entry: AuditRecord,
		commandId = randomUUID(),
	): Promise<DurableMaintenanceOutcome> => {
		await transaction.execute(durableMaintenanceAuditInsert, {
			application: input.application,
			commandId,
			...entry,
		});
		if (entry.rejectionCode === "AUTHORITY_DENIED")
			return authorityDenial(commandId, entry.command);
		const version = await transaction.execute(
			durableMaintenanceVersionRead,
			identity(entry.runId),
		);
		return Object.freeze({
			commandId,
			command: entry.command,
			outcome: entry.outcome,
			rejectionCode: entry.rejectionCode,
			stateBefore: entry.stateBefore,
			stateAfter: entry.stateAfter,
			version,
		});
	};

	const refusalBeforeLock = async (
		transaction: PostgresTransaction,
		request: Request,
		command: DurableMaintenanceCommand,
	): Promise<DurableMaintenanceOutcome | null> => {
		const invalidReason = !validReason(request.reason);
		if (
			!(await input.authorize({
				actor: request.actor,
				command,
				runId: request.runId,
			}))
		) {
			const commandId = randomUUID();
			const state = await transaction.execute(
				durableMaintenanceRunStateRead,
				identity(request.runId),
			);
			if (state === null) return authorityDenial(commandId, command);
			return record(
				transaction,
				{
					runId: request.runId,
					command,
					outcome: "rejected",
					rejectionCode: "AUTHORITY_DENIED",
					actor: request.actor,
					stateBefore: state,
					stateAfter: state,
					reason: invalidReason ? null : request.reason,
				},
				commandId,
			);
		}
		if (invalidReason) {
			const run = await transaction.execute(
				durableMaintenanceRunRead,
				identity(request.runId),
			);
			return record(transaction, {
				runId: request.runId,
				command,
				outcome: "rejected",
				rejectionCode: "REASON_INVALID",
				actor: request.actor,
				stateBefore: run.state,
				stateAfter: run.state,
				reason: null,
			});
		}
		return null;
	};

	const appendEvent = (
		transaction: PostgresTransaction,
		run: DurableMaintenanceRun,
		runId: string,
		kind: DurableEventKind,
	): Promise<void> =>
		appendPostgresDatabaseDurableRunEvent(transaction, {
			application: input.application,
			claim: {
				runId,
				dispatchId: run.dispatchId,
				resource: run.resource,
				attemptId: null,
				leaseToken: null,
				causationId: run.causationId,
				correlationId: run.correlationId,
			},
			kind,
		});

	const write = <Output>(
		use: (transaction: PostgresTransaction) => Promise<Output>,
	): Promise<Output> =>
		input.database.transaction({
			mode: { isolation: "readCommitted", access: "readWrite" },
			use: async (transaction) => {
				await transaction.execute(durableKernelMarker, undefined);
				return use(transaction);
			},
		});

	return Object.freeze({
		cancelRun: (request) =>
			write(async (transaction) => {
				const refusal = await refusalBeforeLock(
					transaction,
					request,
					"cancelRun",
				);
				if (refusal) return refusal;
				const run = await transaction.execute(
					durableMaintenanceRunReadLocked,
					identity(request.runId),
				);
				const rejected = async (rejectionCode: DurableMaintenanceRejection) =>
					record(transaction, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode,
						actor: request.actor,
						stateBefore: run.state,
						stateAfter: run.state,
						reason: request.reason,
					});
				if (staleVersion(run, request.expectedVersion))
					return rejected("VERSION_MISMATCH");
				if (terminalStates.has(run.state)) return rejected("RUN_IS_TERMINAL");
				if (run.cancellationRequested) return rejected("ALREADY_REQUESTED");
				await transaction.execute(durableMaintenanceCancellationInsert, {
					application: input.application,
					cancellationId: randomUUID(),
					runId: request.runId,
					actor: request.actor,
					reason: request.reason,
				});
				const claimed = run.state === "running";
				await transaction.execute(
					claimed
						? durableMaintenanceRunCancelClaimed
						: durableMaintenanceRunCancelUnclaimed,
					identity(request.runId),
				);
				await appendEvent(
					transaction,
					run,
					request.runId,
					claimed ? "cancellationRequested" : "cancelled",
				);
				return record(transaction, {
					runId: request.runId,
					command: "cancelRun",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore: run.state,
					stateAfter: claimed ? run.state : "cancelled",
					reason: request.reason,
				});
			}),
		retryRun: (request) =>
			write(async (transaction) => {
				const refusal = await refusalBeforeLock(
					transaction,
					request,
					"retryRun",
				);
				if (refusal) return refusal;
				const run = await transaction.execute(
					durableMaintenanceRunReadLocked,
					identity(request.runId),
				);
				const rejected = async (rejectionCode: DurableMaintenanceRejection) =>
					record(transaction, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode,
						actor: request.actor,
						stateBefore: run.state,
						stateAfter: run.state,
						reason: request.reason,
					});
				if (staleVersion(run, request.expectedVersion))
					return rejected("VERSION_MISMATCH");
				if (run.state !== "failed") return rejected("RUN_NOT_FAILED");
				if (run.attemptCount >= 8) return rejected("ATTEMPTS_EXHAUSTED");
				await transaction.execute(
					durableMaintenanceRunRetry,
					identity(request.runId),
				);
				await appendEvent(transaction, run, request.runId, "retryRequested");
				return record(transaction, {
					runId: request.runId,
					command: "retryRun",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore: run.state,
					stateAfter: "ready",
					reason: request.reason,
				});
			}),
		acknowledgeAmbiguity: (request) =>
			write(async (transaction) => {
				const refusal = await refusalBeforeLock(
					transaction,
					request,
					"acknowledgeAmbiguity",
				);
				if (refusal) return refusal;
				const run = await transaction.execute(
					durableMaintenanceRunReadLocked,
					identity(request.runId),
				);
				if (staleVersion(run, request.expectedVersion))
					return record(transaction, {
						runId: request.runId,
						command: "acknowledgeAmbiguity",
						outcome: "rejected",
						rejectionCode: "VERSION_MISMATCH",
						actor: request.actor,
						stateBefore: run.state,
						stateAfter: run.state,
						reason: request.reason,
					});
				const effectId = await transaction.execute(
					durableMaintenanceEffectAcknowledge,
					{
						application: input.application,
						runId: request.runId,
						effectName: request.effectName,
					},
				);
				if (effectId === null)
					return record(transaction, {
						runId: request.runId,
						command: "acknowledgeAmbiguity",
						outcome: "rejected",
						rejectionCode: "NOT_AMBIGUOUS",
						actor: request.actor,
						stateBefore: run.state,
						stateAfter: run.state,
						reason: request.reason,
					});
				await appendEvent(
					transaction,
					run,
					request.runId,
					"ambiguityAcknowledged",
				);
				return record(transaction, {
					runId: request.runId,
					command: "acknowledgeAmbiguity",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore: run.state,
					stateAfter: run.state,
					reason: request.reason,
				});
			}),
		audit: (runId) =>
			input.database.transaction({
				mode: { isolation: "readCommitted", access: "readOnly" },
				use: (transaction) =>
					transaction.execute(durableMaintenanceAuditRead, identity(runId)),
			}),
	});
}
