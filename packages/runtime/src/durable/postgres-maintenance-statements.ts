import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";
import type {
	DurableMaintenanceAuditEntry,
	DurableMaintenanceCommand,
	DurableMaintenanceRejection,
} from "./maintenance-contract";
import type { DurableActor, DurableRunState } from "./rows";

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

const states: ReadonlySet<string> = new Set([
	"cancelled",
	"delayed",
	"failed",
	"ready",
	"running",
	"succeeded",
]);
const commands: ReadonlySet<string> = new Set([
	"acknowledgeAmbiguity",
	"cancelRun",
	"retryRun",
]);
const rejections: ReadonlySet<string> = new Set([
	"ALREADY_REQUESTED",
	"ATTEMPTS_EXHAUSTED",
	"AUTHORITY_DENIED",
	"NOT_AMBIGUOUS",
	"REASON_INVALID",
	"RUN_IS_TERMINAL",
	"RUN_NOT_FAILED",
	"VERSION_MISMATCH",
]);

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL Durable maintenance ${label}`);
	return value;
}

function uuid(value: unknown, label: string): string {
	const candidate = text(value, label);
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(candidate))
		throw new TypeError(`invalid PostgreSQL Durable maintenance ${label}`);
	return candidate;
}

function integer(
	value: unknown,
	minimum: number,
	maximum: number,
	label: string,
): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		throw new TypeError(`invalid PostgreSQL Durable maintenance ${label}`);
	return value;
}

function state(value: unknown, label: string): DurableRunState {
	const candidate = text(value, label);
	if (!states.has(candidate))
		throw new TypeError(`invalid PostgreSQL Durable maintenance ${label}`);
	return candidate as DurableRunState;
}

function command(value: unknown): DurableMaintenanceCommand {
	const candidate = text(value, "command");
	if (!commands.has(candidate))
		throw new TypeError("invalid PostgreSQL Durable maintenance command");
	return candidate as DurableMaintenanceCommand;
}

function actorKind(value: unknown): DurableActor["kind"] {
	if (value !== "anonymous" && value !== "service" && value !== "user")
		throw new TypeError("invalid PostgreSQL Durable maintenance actor kind");
	return value;
}

function reason(value: unknown): string | null {
	if (value === null) return null;
	const candidate = text(value, "reason");
	if ([...candidate].length > 256)
		throw new TypeError("invalid PostgreSQL Durable maintenance reason");
	return candidate;
}

function identityParameters(
	input: Readonly<{ application: string; runId: string }>,
) {
	return [
		text(input.application, "application identity"),
		uuid(input.runId, "run identity"),
	] as const;
}

function selectedRows(
	result: StatementResult,
	maximum: number,
	label: string,
): readonly (readonly unknown[])[] {
	if (
		result.command !== "SELECT" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > maximum
	)
		throw new TypeError(
			`invalid PostgreSQL Durable maintenance ${label} result`,
		);
	return result.rows;
}

function changedOne(result: StatementResult, command: "INSERT" | "UPDATE") {
	if (
		result.command !== command ||
		result.rowCount !== 1 ||
		result.rows.length !== 0
	)
		throw new TypeError("invalid PostgreSQL Durable maintenance write result");
}

export type DurableMaintenanceRun = Readonly<{
	state: DurableRunState;
	attemptCount: number;
	deadLetter: boolean;
	resource: string;
	dispatchId: string;
	causationId: string;
	correlationId: string;
	cancellationRequested: boolean;
	version: number;
}>;

function decodeRun(result: StatementResult): DurableMaintenanceRun {
	const rows = selectedRows(result, 1, "run read");
	const row = rows[0];
	if (
		rows.length !== 1 ||
		row?.length !== 9 ||
		typeof row[2] !== "boolean" ||
		typeof row[7] !== "boolean"
	)
		throw new TypeError("invalid PostgreSQL Durable maintenance run result");
	return Object.freeze({
		state: state(row[0], "run state"),
		attemptCount: integer(row[1], 0, 8, "attempt count"),
		deadLetter: row[2],
		resource: text(row[3], "Resource Identity"),
		dispatchId: uuid(row[4], "dispatch identity"),
		causationId: text(row[5], "causation identity"),
		correlationId: text(row[6], "correlation identity"),
		cancellationRequested: row[7],
		version: integer(row[8], 0, 1_024, "run version"),
	});
}

const runReadText = `SELECT state, attempt_count AS "attemptCount", dead_letter AS "deadLetter",
       resource_identity AS "resource", dispatch_id::text AS "dispatchId",
       causation_id AS "causationId", correlation_id AS "correlationId",
       cancellation_requested AS "cancellationRequested",
       event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2`;

export const durableMaintenanceRunRead: PostgresStatement<
	Readonly<{ application: string; runId: string }>,
	DurableMaintenanceRun
> = definePostgresStatement({
	name: "durable.maintenance.run.read",
	text: runReadText,
	parameterCount: 2,
	parameters: identityParameters,
	decode: decodeRun,
});

export const durableMaintenanceRunReadLocked: PostgresStatement<
	Readonly<{ application: string; runId: string }>,
	DurableMaintenanceRun
> = definePostgresStatement({
	name: "durable.maintenance.run.read-locked",
	text: `${runReadText}\nFOR UPDATE`,
	parameterCount: 2,
	parameters: identityParameters,
	decode: decodeRun,
});

export const durableMaintenanceRunStateRead: PostgresStatement<
	Readonly<{ application: string; runId: string }>,
	DurableRunState | null
> = definePostgresStatement({
	name: "durable.maintenance.run.state-read",
	text: `SELECT state
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2`,
	parameterCount: 2,
	parameters: identityParameters,
	decode(result) {
		const rows = selectedRows(result, 1, "state read");
		if (rows.length === 0) return null;
		if (rows[0]?.length !== 1)
			throw new TypeError(
				"invalid PostgreSQL Durable maintenance state result",
			);
		return state(rows[0][0], "run state");
	},
});

type AuditInsertInput = Readonly<{
	application: string;
	commandId: string;
	runId: string;
	command: DurableMaintenanceCommand;
	outcome: "applied" | "rejected";
	rejectionCode: DurableMaintenanceRejection | null;
	actor: DurableActor;
	stateBefore: DurableRunState;
	stateAfter: DurableRunState;
	reason: string | null;
}>;

export const durableMaintenanceAuditInsert: PostgresStatement<
	AuditInsertInput,
	void
> = definePostgresStatement({
	name: "durable.maintenance.audit.insert",
	text: `INSERT INTO questpie_internal.durable_maintenance_commands
  (application_name, command_id, run_id, command, outcome, rejection_code,
   actor_kind, actor_id, state_before, state_after, reason, requested_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, pg_catalog.transaction_timestamp())`,
	parameterCount: 11,
	parameters(input) {
		const rejectionCode =
			input.rejectionCode === null
				? null
				: text(input.rejectionCode, "rejection code");
		if (rejectionCode !== null && !rejections.has(rejectionCode))
			throw new TypeError(
				"invalid PostgreSQL Durable maintenance rejection code",
			);
		if (input.outcome === "applied" && rejectionCode !== null)
			throw new TypeError("invalid PostgreSQL Durable maintenance audit shape");
		if (input.outcome === "rejected" && rejectionCode === null)
			throw new TypeError("invalid PostgreSQL Durable maintenance audit shape");
		return [
			text(input.application, "application identity"),
			uuid(input.commandId, "command identity"),
			uuid(input.runId, "run identity"),
			command(input.command),
			input.outcome,
			rejectionCode,
			actorKind(input.actor.kind),
			text(input.actor.id, "actor identity"),
			state(input.stateBefore, "state before"),
			state(input.stateAfter, "state after"),
			reason(input.reason),
		];
	},
	decode: (result) => changedOne(result, "INSERT"),
});

export const durableMaintenanceVersionRead: PostgresStatement<
	Readonly<{ application: string; runId: string }>,
	number
> = definePostgresStatement({
	name: "durable.maintenance.run.version-read",
	text: `SELECT event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2`,
	parameterCount: 2,
	parameters: identityParameters,
	decode(result) {
		const rows = selectedRows(result, 1, "version read");
		if (rows.length !== 1 || rows[0]?.length !== 1)
			throw new TypeError(
				"invalid PostgreSQL Durable maintenance version result",
			);
		return integer(rows[0][0], 0, 1_024, "run version");
	},
});

type CancellationInsertInput = Readonly<{
	application: string;
	cancellationId: string;
	runId: string;
	actor: DurableActor;
	reason: string;
}>;

export const durableMaintenanceCancellationInsert: PostgresStatement<
	CancellationInsertInput,
	void
> = definePostgresStatement({
	name: "durable.maintenance.cancellation.insert",
	text: `INSERT INTO questpie_internal.durable_cancellations
  (application_name, cancellation_id, run_id, requested_by_kind, requested_by_id,
   reason, requested_at)
VALUES ($1, $2, $3, $4, $5, $6, pg_catalog.transaction_timestamp())`,
	parameterCount: 6,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.cancellationId, "cancellation identity"),
		uuid(input.runId, "run identity"),
		actorKind(input.actor.kind),
		text(input.actor.id, "actor identity"),
		reason(input.reason)!,
	],
	decode: (result) => changedOne(result, "INSERT"),
});

type RunWriteInput = Readonly<{ application: string; runId: string }>;

function runWrite(
	name: string,
	textValue: string,
): PostgresStatement<RunWriteInput, void> {
	return definePostgresStatement({
		name,
		text: textValue,
		parameterCount: 2,
		parameters: identityParameters,
		decode: (result) => changedOne(result, "UPDATE"),
	});
}

export const durableMaintenanceRunCancelClaimed: PostgresStatement<
	RunWriteInput,
	void
> = runWrite(
	"durable.maintenance.run.cancel-claimed",
	`UPDATE questpie_internal.durable_runs
SET cancellation_requested = true
WHERE application_name = $1 AND run_id = $2`,
);

export const durableMaintenanceRunCancelUnclaimed: PostgresStatement<
	RunWriteInput,
	void
> = runWrite(
	"durable.maintenance.run.cancel-unclaimed",
	`UPDATE questpie_internal.durable_runs
SET cancellation_requested = true, state = 'cancelled', failure_code = NULL,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
);

export const durableMaintenanceRunRetry: PostgresStatement<
	RunWriteInput,
	void
> = runWrite(
	"durable.maintenance.run.retry",
	`UPDATE questpie_internal.durable_runs
SET state = 'ready', dead_letter = false, failure_code = NULL, terminal_at = NULL,
    available_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
);

type EffectInput = Readonly<{
	application: string;
	runId: string;
	effectName: string;
}>;

export const durableMaintenanceEffectAcknowledge: PostgresStatement<
	EffectInput,
	string | null
> = definePostgresStatement({
	name: "durable.maintenance.effect.acknowledge",
	text: `UPDATE questpie_internal.durable_effects
SET status = 'acknowledged', settled_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3 AND status = 'ambiguous'
RETURNING effect_id::text AS "effectId"`,
	parameterCount: 3,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		text(input.effectName, "effect name"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError(
				"invalid PostgreSQL Durable maintenance effect result",
			);
		if (result.rows.length === 0) return null;
		if (result.rows[0]?.length !== 1)
			throw new TypeError(
				"invalid PostgreSQL Durable maintenance effect result",
			);
		return uuid(result.rows[0][0], "effect identity");
	},
});

export const durableMaintenanceAuditRead: PostgresStatement<
	Readonly<{ application: string; runId: string }>,
	readonly DurableMaintenanceAuditEntry[]
> = definePostgresStatement({
	name: "durable.maintenance.audit.read",
	text: `SELECT command_id::text AS "commandId", command, outcome,
       rejection_code AS "rejectionCode", actor_kind AS "actorKind",
       actor_id AS "actorId", state_before AS "stateBefore",
       state_after AS "stateAfter", reason
FROM questpie_internal.durable_maintenance_commands
WHERE application_name = $1 AND run_id = $2
ORDER BY requested_at, command_id`,
	parameterCount: 2,
	parameters: identityParameters,
	decode(result) {
		return Object.freeze(
			selectedRows(result, Number.MAX_SAFE_INTEGER, "audit read").map((row) => {
				if (
					row.length !== 9 ||
					(row[3] !== null && typeof row[3] !== "string") ||
					typeof row[4] !== "string"
				)
					throw new TypeError(
						"invalid PostgreSQL Durable maintenance audit result",
					);
				const outcome = text(row[2], "audit outcome");
				if (outcome !== "applied" && outcome !== "rejected")
					throw new TypeError(
						"invalid PostgreSQL Durable maintenance audit result",
					);
				const rejectionCode =
					row[3] === null ? null : text(row[3], "rejection code");
				if (rejectionCode !== null && !rejections.has(rejectionCode))
					throw new TypeError(
						"invalid PostgreSQL Durable maintenance audit result",
					);
				if (
					(outcome === "applied") !== (rejectionCode === null) ||
					row[8] === ""
				)
					throw new TypeError(
						"invalid PostgreSQL Durable maintenance audit result",
					);
				return Object.freeze({
					commandId: uuid(row[0], "command identity"),
					command: command(row[1]),
					outcome,
					rejectionCode,
					actor: Object.freeze({
						kind: actorKind(row[4]),
						id: text(row[5], "actor identity"),
					}),
					stateBefore: state(row[6], "state before"),
					stateAfter: state(row[7], "state after"),
					reason: reason(row[8]),
				});
			}),
		);
	},
});
