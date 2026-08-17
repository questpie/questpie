import type { SQL } from "bun";

import type { DurableRunState } from "./postgres-kernel";
import {
	durableText,
	markDurableKernelTransaction,
	type DurableActor,
	type DurableQuery,
	type DurableRow,
} from "./rows";

export type DurableMaintenanceCommand =
	| "acknowledgeAmbiguity"
	| "cancelRun"
	| "retryRun";

export type DurableMaintenanceRejection =
	| "ALREADY_REQUESTED"
	| "ATTEMPTS_EXHAUSTED"
	| "NOT_AMBIGUOUS"
	| "RUN_IS_TERMINAL"
	| "RUN_NOT_FAILED";

export type DurableMaintenanceOutcome = Readonly<{
	commandId: string;
	command: DurableMaintenanceCommand;
	outcome: "applied" | "rejected";
	rejectionCode: DurableMaintenanceRejection | null;
	stateBefore: DurableRunState;
	stateAfter: DurableRunState;
}>;

export type DurableMaintenanceAuditEntry = Readonly<{
	commandId: string;
	command: DurableMaintenanceCommand;
	outcome: "applied" | "rejected";
	rejectionCode: string | null;
	actor: DurableActor;
	stateBefore: string;
	stateAfter: string;
}>;

const terminalStates: ReadonlySet<string> = new Set([
	"cancelled",
	"failed",
	"succeeded",
]);

/**
 * Maintenance is a typed, audited, single-winner command surface. Two callers
 * may issue the same command; exactly one applies and both are recorded.
 */
export interface DurableMaintenance {
	cancelRun(
		input: Readonly<{ runId: string; reason: string; actor: DurableActor }>,
	): Promise<DurableMaintenanceOutcome>;
	retryRun(
		input: Readonly<{ runId: string; actor: DurableActor }>,
	): Promise<DurableMaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			actor: DurableActor;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	audit(runId: string): Promise<readonly DurableMaintenanceAuditEntry[]>;
}

export function createPostgresDurableMaintenance(
	input: Readonly<{ sql: SQL; application: string }>,
): DurableMaintenance {
	const transaction = <Result>(
		use: (query: DurableQuery) => Promise<Result>,
	): Promise<Result> =>
		input.sql.begin(async (session) => {
			const query: DurableQuery = (statement, parameters = []) =>
				session.unsafe(statement, [...parameters]) as unknown as Promise<
					readonly DurableRow[]
				>;
			await markDurableKernelTransaction(query);
			return use(query);
		}) as Promise<Result>;

	const lockRun = async (
		query: DurableQuery,
		runId: string,
	): Promise<DurableRow> => {
		const [row] = await query(
			`SELECT state, attempt_count AS "attemptCount", dead_letter AS "deadLetter",
       resource_identity AS "resource", dispatch_id::text AS "dispatchId",
       causation_id AS "causationId", correlation_id AS "correlationId",
       cancellation_requested AS "cancellationRequested"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2
FOR UPDATE`,
			[input.application, runId],
		);
		if (!row) throw new TypeError("durable maintenance target run is missing");
		return row;
	};

	const appendEvent = async (
		query: DurableQuery,
		run: DurableRow,
		runId: string,
		kind: string,
	): Promise<void> => {
		const [bumped] = await query(
			`UPDATE questpie_internal.durable_runs
SET event_sequence = event_sequence + 1
WHERE application_name = $1 AND run_id = $2
RETURNING event_sequence AS "sequence"`,
			[input.application, runId],
		);
		await query(
			`INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   causation_id, correlation_id, kind)
VALUES ($1, $2, $3, pg_catalog.transaction_timestamp(), $4, $5, $6, $7, $8)`,
			[
				input.application,
				runId,
				bumped?.sequence,
				durableText(run.resource, "Resource Identity"),
				durableText(run.dispatchId, "dispatch identity"),
				durableText(run.causationId, "causation identity"),
				durableText(run.correlationId, "correlation identity"),
				kind,
			],
		);
	};

	const record = async (
		query: DurableQuery,
		entry: Readonly<{
			runId: string;
			command: DurableMaintenanceCommand;
			outcome: "applied" | "rejected";
			rejectionCode: DurableMaintenanceRejection | null;
			actor: DurableActor;
			stateBefore: DurableRunState;
			stateAfter: DurableRunState;
		}>,
	): Promise<DurableMaintenanceOutcome> => {
		const commandId = crypto.randomUUID();
		await query(
			`INSERT INTO questpie_internal.durable_maintenance_commands
  (application_name, command_id, run_id, command, outcome, rejection_code,
   actor_kind, actor_id, state_before, state_after, requested_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, pg_catalog.transaction_timestamp())`,
			[
				input.application,
				commandId,
				entry.runId,
				entry.command,
				entry.outcome,
				entry.rejectionCode,
				entry.actor.kind,
				entry.actor.id,
				entry.stateBefore,
				entry.stateAfter,
			],
		);
		return Object.freeze({
			commandId,
			command: entry.command,
			outcome: entry.outcome,
			rejectionCode: entry.rejectionCode,
			stateBefore: entry.stateBefore,
			stateAfter: entry.stateAfter,
		});
	};

	return Object.freeze<DurableMaintenance>({
		async cancelRun(request) {
			return transaction(async (query) => {
				const run = await lockRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				if (terminalStates.has(stateBefore))
					return record(query, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode: "RUN_IS_TERMINAL",
						actor: request.actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (run.cancellationRequested === true)
					return record(query, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode: "ALREADY_REQUESTED",
						actor: request.actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				await query(
					`INSERT INTO questpie_internal.durable_cancellations
  (application_name, cancellation_id, run_id, requested_by_kind, requested_by_id,
   reason, requested_at)
VALUES ($1, $2, $3, $4, $5, $6, pg_catalog.transaction_timestamp())`,
					[
						input.application,
						crypto.randomUUID(),
						request.runId,
						request.actor.kind,
						request.actor.id,
						request.reason,
					],
				);
				const claimed = stateBefore === "running";
				await query(
					claimed
						? `UPDATE questpie_internal.durable_runs
SET cancellation_requested = true
WHERE application_name = $1 AND run_id = $2`
						: `UPDATE questpie_internal.durable_runs
SET cancellation_requested = true, state = 'cancelled',
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
					[input.application, request.runId],
				);
				await appendEvent(
					query,
					run,
					request.runId,
					claimed ? "cancellationRequested" : "cancelled",
				);
				return record(query, {
					runId: request.runId,
					command: "cancelRun",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore,
					stateAfter: claimed ? stateBefore : "cancelled",
				});
			});
		},
		async retryRun(request) {
			return transaction(async (query) => {
				const run = await lockRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				if (stateBefore !== "failed")
					return record(query, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode: "RUN_NOT_FAILED",
						actor: request.actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (Number(run.attemptCount) >= 8)
					return record(query, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode: "ATTEMPTS_EXHAUSTED",
						actor: request.actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				await query(
					`UPDATE questpie_internal.durable_runs
SET state = 'ready', dead_letter = false, terminal_at = NULL,
    available_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
					[input.application, request.runId],
				);
				return record(query, {
					runId: request.runId,
					command: "retryRun",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore,
					stateAfter: "ready",
				});
			});
		},
		async acknowledgeAmbiguity(request) {
			return transaction(async (query) => {
				const run = await lockRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				const acknowledged = await query(
					`UPDATE questpie_internal.durable_effects
SET status = 'acknowledged', settled_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3 AND status = 'ambiguous'
RETURNING effect_id::text AS "effectId"`,
					[input.application, request.runId, request.effectName],
				);
				if (acknowledged.length === 0)
					return record(query, {
						runId: request.runId,
						command: "acknowledgeAmbiguity",
						outcome: "rejected",
						rejectionCode: "NOT_AMBIGUOUS",
						actor: request.actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				await appendEvent(query, run, request.runId, "ambiguityAcknowledged");
				return record(query, {
					runId: request.runId,
					command: "acknowledgeAmbiguity",
					outcome: "applied",
					rejectionCode: null,
					actor: request.actor,
					stateBefore,
					stateAfter: stateBefore,
				});
			});
		},
		async audit(runId) {
			const rows = (await input.sql.unsafe(
				`SELECT command_id::text AS "commandId", command, outcome,
       rejection_code AS "rejectionCode", actor_kind AS "actorKind",
       actor_id AS "actorId", state_before AS "stateBefore", state_after AS "stateAfter"
FROM questpie_internal.durable_maintenance_commands
WHERE application_name = $1 AND run_id = $2
ORDER BY requested_at, command_id`,
				[input.application, runId],
			)) as unknown as readonly DurableRow[];
			return Object.freeze(
				rows.map((row) =>
					Object.freeze({
						commandId: durableText(row.commandId, "command identity"),
						command: durableText(
							row.command,
							"maintenance command",
						) as DurableMaintenanceCommand,
						outcome: durableText(row.outcome, "command outcome") as
							| "applied"
							| "rejected",
						rejectionCode:
							row.rejectionCode === null
								? null
								: durableText(row.rejectionCode, "rejection code"),
						actor: Object.freeze({
							kind: durableText(row.actorKind, "actor kind") as
								| "anonymous"
								| "service"
								| "user",
							id: durableText(row.actorId, "actor identity"),
						}),
						stateBefore: durableText(row.stateBefore, "state before"),
						stateAfter: durableText(row.stateAfter, "state after"),
					}),
				),
			);
		},
	});
}
