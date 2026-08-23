import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";
import type {
	DurableFailureCode,
	DurableRunEventView,
	DurableRunState,
	DurableRunView,
} from "./rows";

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
const failures: ReadonlySet<string> = new Set([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"HANDLER_FAILED",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RETRY_EXHAUSTED",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);
const eventKinds: ReadonlySet<string> = new Set([
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
]);

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function uuid(value: unknown, label: string): string {
	const candidate = text(value, label);
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(candidate))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return candidate;
}

function digest(value: unknown, label: string): string {
	const candidate = text(value, label);
	if (!/^[0-9a-f]{64}$/u.test(candidate))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return candidate;
}

function integer(
	value: unknown,
	minimum: number,
	maximum: number,
	label: string,
) {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function date(value: unknown, label: string): Date {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return new Date(value.getTime());
}

function resultRows(
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
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	return result.rows;
}

type RunIdentityInput = Readonly<{ application: string; runId: string }>;

const runIdentityParameters = (input: RunIdentityInput) => [
	text(input.application, "application identity"),
	uuid(input.runId, "run identity"),
];

export const durableRunInspect: PostgresStatement<
	RunIdentityInput,
	DurableRunView | null
> = definePostgresStatement({
	name: "durable.inspection.run",
	text: `SELECT run_id::text AS "runId", dispatch_id::text AS "dispatchId",
       resource_identity AS "resource", state, attempt_count AS "attemptCount",
       current_attempt_id::text AS "currentAttemptId",
       cancellation_requested AS "cancellationRequested", dead_letter AS "deadLetter",
       failure_code AS "failureCode", result_bytes AS "resultBytes",
       available_at AS "availableAt", terminal_at AS "terminalAt",
       event_sequence AS "version"
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2`,
	parameterCount: 2,
	parameters: runIdentityParameters,
	decode(result) {
		const selected = resultRows(result, 1, "inspection");
		if (selected.length === 0) return null;
		const row = selected[0];
		if (
			row?.length !== 13 ||
			typeof row[3] !== "string" ||
			!states.has(row[3]) ||
			(row[5] !== null && typeof row[5] !== "string") ||
			typeof row[6] !== "boolean" ||
			typeof row[7] !== "boolean" ||
			(row[8] !== null &&
				(typeof row[8] !== "string" || !failures.has(row[8]))) ||
			(row[9] !== null && !(row[9] instanceof Uint8Array)) ||
			(row[11] !== null && !(row[11] instanceof Date))
		)
			throw new TypeError("invalid PostgreSQL Durable inspection result");
		const state = row[3] as DurableRunState;
		const currentAttemptId =
			row[5] === null ? null : uuid(row[5], "inspection attempt identity");
		const failureCode = row[8] === null ? null : (row[8] as DurableFailureCode);
		const resultBytes =
			row[9] === null ? null : new Uint8Array(row[9] as Uint8Array);
		if (resultBytes !== null && resultBytes.byteLength > 262_144)
			throw new TypeError("invalid PostgreSQL Durable inspection result");
		const terminalAt =
			row[11] === null ? null : date(row[11], "inspection terminal time");
		const terminal =
			state === "cancelled" || state === "failed" || state === "succeeded";
		const shapeIsValid =
			(state === "running") === (currentAttemptId !== null) &&
			terminal === (terminalAt !== null) &&
			(state === "succeeded") === (resultBytes !== null) &&
			(state === "failed") === (failureCode !== null) &&
			(state === "failed" || row[7] === false);
		if (!shapeIsValid)
			throw new TypeError("invalid PostgreSQL Durable inspection result");
		return Object.freeze({
			runId: uuid(row[0], "inspection run identity"),
			version: integer(row[12], 0, 1_024, "inspection version"),
			dispatchId: uuid(row[1], "inspection dispatch identity"),
			resource: text(row[2], "inspection Resource Identity"),
			state,
			attemptCount: integer(row[4], 0, 8, "inspection attempt count"),
			currentAttemptId,
			cancellationRequested: row[6],
			deadLetter: row[7],
			failureCode,
			resultBytes,
			availableAt: date(row[10], "inspection availability"),
			terminalAt,
		});
	},
});

export const durableRunEventsRead: PostgresStatement<
	RunIdentityInput,
	readonly DurableRunEventView[]
> = definePostgresStatement({
	name: "durable.inspection.events",
	text: `SELECT sequence, kind, attempt_id::text AS "attemptId",
       lease_token_digest AS "leaseTokenDigest", error_code AS "errorCode"
FROM questpie_internal.durable_run_events
WHERE application_name = $1 AND run_id = $2
ORDER BY sequence`,
	parameterCount: 2,
	parameters: runIdentityParameters,
	decode(result) {
		return Object.freeze(
			resultRows(result, 1_024, "event history").map((row, index) => {
				if (
					row.length !== 5 ||
					typeof row[1] !== "string" ||
					!eventKinds.has(row[1]) ||
					(row[2] !== null && typeof row[2] !== "string") ||
					(row[3] !== null && typeof row[3] !== "string") ||
					(row[4] !== null &&
						(typeof row[4] !== "string" || !failures.has(row[4])))
				)
					throw new TypeError(
						"invalid PostgreSQL Durable event history result",
					);
				const sequence = integer(row[0], 1, 1_024, "event history sequence");
				if (sequence !== index + 1)
					throw new TypeError(
						"invalid PostgreSQL Durable event history result",
					);
				return Object.freeze({
					sequence,
					kind: row[1],
					attemptId:
						row[2] === null ? null : uuid(row[2], "event attempt identity"),
					leaseTokenDigest:
						row[3] === null ? null : digest(row[3], "event lease token digest"),
					errorCode: row[4] as DurableFailureCode | null,
				});
			}),
		);
	},
});
