import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";
import type { DurableAdmission } from "./rows";

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function text(value: string, label: string): string {
	if (value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function uuid(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value)
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function digest(value: unknown, label: string): string {
	if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function batch(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 64)
		throw new TypeError("invalid PostgreSQL Durable scheduling batch");
	return value;
}

function rows(
	result: StatementResult,
	command: "SELECT" | "UPDATE",
	maximum: number,
	label: string,
): readonly (readonly unknown[])[] {
	if (
		result.command !== command ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > maximum
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	return result.rows;
}

export type DurableAdmissionSelectInput = Readonly<{
	application: string;
	executableDigests: readonly string[];
	batch: number;
}>;

export const durableAdmissionSelect: PostgresStatement<
	DurableAdmissionSelectInput,
	readonly DurableAdmission[]
> = definePostgresStatement({
	name: "durable.admission.select",
	text: `WITH eligible AS (
  SELECT run_id, resource_identity, executable_digest, available_at,
         row_number() OVER (PARTITION BY tenant_id ORDER BY available_at, run_id) AS tenant_turn
  FROM questpie_internal.durable_runs
  WHERE application_name = $1
    AND executable_digest IN (
      SELECT pg_catalog.jsonb_array_elements_text(($2::text)::jsonb)
    )
    AND NOT cancellation_requested
    AND ((state IN ('delayed', 'ready') AND available_at <= pg_catalog.transaction_timestamp())
      OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
)
SELECT run_id::text AS "runId", resource_identity AS "resource",
       executable_digest AS "executableDigest"
FROM eligible
ORDER BY tenant_turn, available_at, run_id
LIMIT $3`,
	parameterCount: 3,
	parameters(input) {
		const executableDigests = input.executableDigests.map((value) =>
			digest(value, "executable digest"),
		);
		if (
			executableDigests.some(
				(value, index) => index > 0 && executableDigests[index - 1]! >= value,
			)
		)
			throw new TypeError(
				"invalid PostgreSQL Durable executable digest ordering",
			);
		return [
			text(input.application, "application identity"),
			JSON.stringify(executableDigests),
			batch(input.batch),
		];
	},
	decode(result) {
		return Object.freeze(
			rows(result, "SELECT", 64, "admission").map((row) => {
				if (row.length !== 3 || typeof row[1] !== "string")
					throw new TypeError("invalid PostgreSQL Durable admission result");
				return Object.freeze({
					runId: uuid(row[0], "admission run identity"),
					resource: text(row[1], "admission Resource Identity"),
					executableDigest: digest(row[2], "admission executable digest"),
				});
			}),
		);
	},
});

export type DurableCancelledRun = Readonly<{
	runId: string;
	resource: string;
	dispatchId: string;
	causationId: string;
	correlationId: string;
}>;

type SchedulingInput = Readonly<{
	application: string;
	limit: number;
}>;

export const durableCancelledRunsReap: PostgresStatement<
	SchedulingInput,
	readonly DurableCancelledRun[]
> = definePostgresStatement({
	name: "durable.cancellation.reap.runs",
	text: `WITH candidates AS (
  SELECT application_name, run_id
  FROM questpie_internal.durable_runs
  WHERE application_name = $1 AND cancellation_requested
    AND (state IN ('delayed', 'ready')
      OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
  ORDER BY run_id
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE questpie_internal.durable_runs AS runs
SET state = 'cancelled', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, failure_code = NULL,
    terminal_at = pg_catalog.transaction_timestamp()
FROM candidates
WHERE runs.application_name = candidates.application_name
  AND runs.run_id = candidates.run_id
RETURNING runs.run_id::text AS "runId", runs.resource_identity AS "resource",
          runs.dispatch_id::text AS "dispatchId", runs.causation_id AS "causationId",
          runs.correlation_id AS "correlationId"`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.application, "application identity"),
		batch(input.limit),
	],
	decode(result) {
		return Object.freeze(
			rows(result, "UPDATE", 64, "cancellation reap").map((row) => {
				if (
					row.length !== 5 ||
					typeof row[1] !== "string" ||
					typeof row[3] !== "string" ||
					typeof row[4] !== "string"
				)
					throw new TypeError(
						"invalid PostgreSQL Durable cancellation reap result",
					);
				return Object.freeze({
					runId: uuid(row[0], "cancelled run identity"),
					resource: text(row[1], "cancelled Resource Identity"),
					dispatchId: uuid(row[2], "cancelled dispatch identity"),
					causationId: text(row[3], "cancelled causation identity"),
					correlationId: text(row[4], "cancelled correlation identity"),
				});
			}),
		);
	},
});

type CancelledAttemptsInput = Readonly<{
	application: string;
	runId: string;
}>;

export const durableCancelledAttemptsComplete: PostgresStatement<
	CancelledAttemptsInput,
	void
> = definePostgresStatement({
	name: "durable.cancellation.reap.attempts",
	text: `UPDATE questpie_internal.durable_attempts
SET outcome = 'cancelled'
WHERE application_name = $1 AND run_id = $2 AND outcome IS NULL`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.runId, "cancelled run identity"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount === null ||
			result.rowCount < 0 ||
			result.rowCount > 8 ||
			result.rows.length !== 0
		)
			throw new TypeError(
				"invalid PostgreSQL Durable cancellation attempt completion result",
			);
	},
});
