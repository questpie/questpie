import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function returnedBoolean(
	result: StatementResult,
	label: string,
): Readonly<{ found: boolean; value: boolean }> {
	if (
		result.command !== "UPDATE" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > 1
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	if (result.rowCount === 0)
		return Object.freeze({ found: false, value: false });
	const row = result.rows[0];
	if (row?.length !== 1 || typeof row[0] !== "boolean")
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	return Object.freeze({ found: true, value: row[0] });
}

function nonemptyText(value: string, label: string): string {
	if (value.length === 0 || value.includes("\0"))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function uuid(value: string, label: string): string {
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function digest(value: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value))
		throw new TypeError("invalid PostgreSQL Durable lease token digest");
	return value;
}

function leaseSeconds(value: number): number {
	if (!Number.isFinite(value) || value < 1 || value > 30)
		throw new TypeError("invalid PostgreSQL Durable lease duration");
	return value;
}

export const durableKernelMarker: PostgresStatement<void, void> =
	definePostgresStatement({
		name: "durable.kernel.mark",
		text: "SELECT set_config('questpie.durable_kernel', 'on', true)",
		parameterCount: 0,
		parameters: () => [],
		decode(result) {
			if (
				result.command !== "SELECT" ||
				result.rowCount !== 1 ||
				result.rows.length !== 1 ||
				result.rows[0]?.length !== 1 ||
				result.rows[0][0] !== "on"
			)
				throw new TypeError("invalid PostgreSQL Durable marker result");
		},
	});

export type DurableRunHeartbeatInput = Readonly<{
	application: string;
	runId: string;
	attemptId: string;
	leaseTokenDigest: string;
	leaseSeconds: number;
}>;

export const durableRunHeartbeat: PostgresStatement<
	DurableRunHeartbeatInput,
	Readonly<{ held: boolean; cancellationRequested: boolean }>
> = definePostgresStatement({
	name: "durable.heartbeat.run",
	text: `UPDATE questpie_internal.durable_runs
SET lease_expires_at = pg_catalog.transaction_timestamp()
      + make_interval(secs => $5::double precision)
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
RETURNING cancellation_requested AS "cancellationRequested"`,
	parameterCount: 5,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		uuid(input.attemptId, "attempt identity"),
		digest(input.leaseTokenDigest),
		leaseSeconds(input.leaseSeconds),
	],
	decode(result) {
		const decoded = returnedBoolean(result, "run heartbeat");
		return Object.freeze({
			held: decoded.found,
			cancellationRequested: decoded.value,
		});
	},
});

export type DurableAttemptHeartbeatInput = Readonly<{
	application: string;
	attemptId: string;
	leaseSeconds: number;
}>;

export const durableAttemptHeartbeat: PostgresStatement<
	DurableAttemptHeartbeatInput,
	Readonly<{ found: boolean; deadlineExpired: boolean }>
> = definePostgresStatement({
	name: "durable.heartbeat.attempt",
	text: `UPDATE questpie_internal.durable_attempts
SET heartbeat_at = pg_catalog.transaction_timestamp(),
    lease_expires_at = pg_catalog.transaction_timestamp()
      + make_interval(secs => $3::double precision)
WHERE application_name = $1 AND attempt_id = $2
RETURNING deadline_at <= pg_catalog.transaction_timestamp() AS "deadlineExpired"`,
	parameterCount: 3,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.attemptId, "attempt identity"),
		leaseSeconds(input.leaseSeconds),
	],
	decode(result) {
		const decoded = returnedBoolean(result, "attempt heartbeat");
		return Object.freeze({
			found: decoded.found,
			deadlineExpired: decoded.value,
		});
	},
});
