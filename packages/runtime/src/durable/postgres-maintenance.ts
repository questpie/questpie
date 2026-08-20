import type { SQL } from "bun";
import { principal as principalKernel, type Principal } from "questpie";

import type { DurableRunState } from "./postgres-kernel";
import {
	appendDurableRunEvent,
	durableInteger,
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
	| "AUTHORITY_DENIED"
	| "NOT_AMBIGUOUS"
	| "REASON_INVALID"
	| "RUN_IS_TERMINAL"
	| "RUN_NOT_FAILED"
	| "VERSION_MISMATCH";

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
		input: Readonly<{
			runId: string;
			reason: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	retryRun(
		input: Readonly<{
			runId: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	acknowledgeAmbiguity(
		input: Readonly<{
			runId: string;
			effectName: string;
			actor: Principal;
			expectedVersion?: number;
		}>,
	): Promise<DurableMaintenanceOutcome>;
	audit(runId: string): Promise<readonly DurableMaintenanceAuditEntry[]>;
}

/**
 * Whether this actor may run this command against this run.
 *
 * `authority-mechanism.md` decides that maintenance Authority is an ordinary
 * Policy decision taken in the Execution that reaches the command, not a new
 * Authority class. This guard is defence in depth for a server path that
 * reaches a command it should not; the primary gate is the Policy on the
 * Operation that exposed it.
 */
export type DurableMaintenanceAuthority = (
	request: Readonly<{
		actor: DurableActor;
		command: DurableMaintenanceCommand;
		runId: string;
	}>,
) => boolean | Promise<boolean>;

export function createPostgresDurableMaintenance(
	input: Readonly<{
		sql: SQL;
		application: string;
		authorize?: DurableMaintenanceAuthority;
	}>,
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

	/**
	 * `locking: false` serves the denial path. An unauthorized caller must not
	 * take `FOR UPDATE` on a run it may not touch: the lock is held for the rest
	 * of the transaction, this read has no `SKIP LOCKED`, and a second
	 * maintenance command would wait out `lock_timeout` behind it — a
	 * denial-of-service surface handed to exactly the caller who was refused.
	 * Reading unlocked still gives the audit the `stateBefore` it records.
	 */
	const readRun = async (
		query: DurableQuery,
		runId: string,
		locking = true,
	): Promise<DurableRow> => {
		const [row] = await query(
			`SELECT state, attempt_count AS "attemptCount", dead_letter AS "deadLetter",
       resource_identity AS "resource", dispatch_id::text AS "dispatchId",
       causation_id AS "causationId", correlation_id AS "correlationId",
       cancellation_requested AS "cancellationRequested",
       event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2${locking ? "\nFOR UPDATE" : ""}`,
			[input.application, runId],
		);
		if (!row) throw new TypeError("durable maintenance target run is missing");
		return row;
	};

	/** The denial path: audited, and taking no lock on the way. */
	const refuseUnauthorized = async (
		query: DurableQuery,
		request: Readonly<{ runId: string; actor: DurableActor }>,
		command: DurableMaintenanceCommand,
	): Promise<DurableMaintenanceOutcome> => {
		const run = await readRun(query, request.runId, false);
		const state = durableText(run.state, "run state") as DurableRunState;
		return record(query, {
			runId: request.runId,
			command,
			outcome: "rejected",
			rejectionCode: "AUTHORITY_DENIED",
			actor: request.actor,
			stateBefore: state,
			stateAfter: state,
		});
	};

	/**
	 * Gate 8 expected-version fencing. `inspect()` reports the run version, and a
	 * command bound to a stale one is refused rather than applied to a run that
	 * moved underneath the operator who read it.
	 */
	const staleVersion = (
		run: DurableRow,
		expectedVersion: number | undefined,
	): boolean =>
		expectedVersion !== undefined &&
		expectedVersion !== durableInteger(run.version, "run version");

	/**
	 * Defence in depth. A denial is audited like any other attempt: an audit that
	 * omits rejected commands is the artifact this slice is trying not to ship.
	 */
	const denied = async (
		actor: DurableActor,
		command: DurableMaintenanceCommand,
		runId: string,
	): Promise<boolean> =>
		input.authorize !== undefined &&
		!(await input.authorize({ actor, command, runId }));

	const actorOf = (actor: Principal): DurableActor => {
		if (!principalKernel.is(actor))
			throw new TypeError("durable maintenance requires a trusted Principal");
		return Object.freeze({ kind: actor.kind, id: actor.id });
	};

	const appendEvent = async (
		query: DurableQuery,
		run: DurableRow,
		runId: string,
		kind: string,
	): Promise<void> => {
		await appendDurableRunEvent(query, {
			application: input.application,
			claim: {
				runId,
				dispatchId: durableText(run.dispatchId, "dispatch identity"),
				resource: durableText(run.resource, "Resource Identity"),
				attemptId: null,
				leaseToken: null,
				causationId: durableText(run.causationId, "causation identity"),
				correlationId: durableText(run.correlationId, "correlation identity"),
			},
			kind,
		});
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
			reason?: string | null;
		}>,
	): Promise<DurableMaintenanceOutcome> => {
		const commandId = crypto.randomUUID();
		await query(
			`INSERT INTO questpie_internal.durable_maintenance_commands
  (application_name, command_id, run_id, command, outcome, rejection_code,
   actor_kind, actor_id, state_before, state_after, reason, requested_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, pg_catalog.transaction_timestamp())`,
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
				entry.reason ?? null,
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
			const actor = actorOf(request.actor);
			return transaction(async (query) => {
				if (await denied(actor, "cancelRun", request.runId))
					return refuseUnauthorized(
						query,
						{ runId: request.runId, actor },
						"cancelRun",
					);
				const run = await readRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				if (staleVersion(run, request.expectedVersion))
					return record(query, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode: "VERSION_MISMATCH",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (terminalStates.has(stateBefore))
					return record(query, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode: "RUN_IS_TERMINAL",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (run.cancellationRequested === true)
					return record(query, {
						runId: request.runId,
						command: "cancelRun",
						outcome: "rejected",
						rejectionCode: "ALREADY_REQUESTED",
						actor,
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
SET cancellation_requested = true, state = 'cancelled', failure_code = NULL,
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
					actor,
					stateBefore,
					stateAfter: claimed ? stateBefore : "cancelled",
				});
			});
		},
		async retryRun(request) {
			const actor = actorOf(request.actor);
			return transaction(async (query) => {
				if (await denied(actor, "retryRun", request.runId))
					return refuseUnauthorized(
						query,
						{ runId: request.runId, actor },
						"retryRun",
					);
				const run = await readRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				if (staleVersion(run, request.expectedVersion))
					return record(query, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode: "VERSION_MISMATCH",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (stateBefore !== "failed")
					return record(query, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode: "RUN_NOT_FAILED",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				if (Number(run.attemptCount) >= 8)
					return record(query, {
						runId: request.runId,
						command: "retryRun",
						outcome: "rejected",
						rejectionCode: "ATTEMPTS_EXHAUSTED",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				await query(
					`UPDATE questpie_internal.durable_runs
SET state = 'ready', dead_letter = false, failure_code = NULL, terminal_at = NULL,
    available_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
					[input.application, request.runId],
				);
				return record(query, {
					runId: request.runId,
					command: "retryRun",
					outcome: "applied",
					rejectionCode: null,
					actor,
					stateBefore,
					stateAfter: "ready",
				});
			});
		},
		async acknowledgeAmbiguity(request) {
			const actor = actorOf(request.actor);
			return transaction(async (query) => {
				if (await denied(actor, "acknowledgeAmbiguity", request.runId))
					return refuseUnauthorized(
						query,
						{ runId: request.runId, actor },
						"acknowledgeAmbiguity",
					);
				const run = await readRun(query, request.runId);
				const stateBefore = durableText(
					run.state,
					"run state",
				) as DurableRunState;
				if (staleVersion(run, request.expectedVersion))
					return record(query, {
						runId: request.runId,
						command: "acknowledgeAmbiguity",
						outcome: "rejected",
						rejectionCode: "VERSION_MISMATCH",
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
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
						actor,
						stateBefore,
						stateAfter: stateBefore,
					});
				await appendEvent(query, run, request.runId, "ambiguityAcknowledged");
				return record(query, {
					runId: request.runId,
					command: "acknowledgeAmbiguity",
					outcome: "applied",
					rejectionCode: null,
					actor,
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
