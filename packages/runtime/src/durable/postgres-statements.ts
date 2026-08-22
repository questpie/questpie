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

function nullableUuid(value: string | null, label: string): string | null {
	return value === null ? null : uuid(value, label);
}

function nullableDigest(value: string | null): string | null {
	return value === null ? null : digest(value);
}

function eventSequence(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > 1_024)
		throw new TypeError("invalid PostgreSQL Durable event sequence");
	return value;
}

function enumText<Value extends string>(
	value: string,
	values: ReadonlySet<string>,
	label: string,
): Value {
	if (!values.has(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value as Value;
}

const durableEventKinds: ReadonlySet<string> = new Set([
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

const durableEventErrorCodes: ReadonlySet<string> = new Set([
	"EFFECT_AMBIGUOUS",
	"EFFECT_CONFLICT",
	"HANDLER_FAILED",
	"REACTION_ERROR",
	"RESOURCE_LIMIT",
	"RETRY_EXHAUSTED",
	"RUN_AS_DENIED",
	"VALIDATION_FAILED",
]);

export type DurableEventKind =
	| "accepted"
	| "ambiguityAcknowledged"
	| "attemptStarted"
	| "cancellationRequested"
	| "cancelled"
	| "effectAmbiguous"
	| "effectSettled"
	| "failed"
	| "leaseSuperseded"
	| "retryScheduled"
	| "succeeded";

export type DurableEventErrorCode =
	| "EFFECT_AMBIGUOUS"
	| "EFFECT_CONFLICT"
	| "HANDLER_FAILED"
	| "REACTION_ERROR"
	| "RESOURCE_LIMIT"
	| "RETRY_EXHAUSTED"
	| "RUN_AS_DENIED"
	| "VALIDATION_FAILED";

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

export type DurableEventSequenceBumpInput = Readonly<{
	application: string;
	runId: string;
}>;

export const durableEventSequenceBump: PostgresStatement<
	DurableEventSequenceBumpInput,
	Readonly<{ sequence: number }> | null
> = definePostgresStatement({
	name: "durable.event.sequence.bump",
	text: `UPDATE questpie_internal.durable_runs
SET event_sequence = event_sequence + 1
WHERE application_name = $1 AND run_id = $2
RETURNING event_sequence::int AS "sequence"`,
	parameterCount: 2,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError("invalid PostgreSQL Durable event sequence result");
		if (result.rowCount === 0) return null;
		const row = result.rows[0];
		if (row?.length !== 1)
			throw new TypeError("invalid PostgreSQL Durable event sequence result");
		return Object.freeze({
			sequence: eventSequence(row[0] as number),
		});
	},
});

export type DurableEventInsertInput = Readonly<{
	application: string;
	runId: string;
	sequence: number;
	resource: string;
	dispatchId: string;
	attemptId: string | null;
	leaseTokenDigest: string | null;
	causationId: string;
	correlationId: string;
	kind: DurableEventKind;
	errorCode: DurableEventErrorCode | null;
}>;

export const durableEventInsert: PostgresStatement<
	DurableEventInsertInput,
	void
> = definePostgresStatement({
	name: "durable.event.insert",
	text: `INSERT INTO questpie_internal.durable_run_events
  (application_name, run_id, sequence, occurred_at, resource_identity, dispatch_id,
   attempt_id, lease_token_digest, causation_id, correlation_id, kind, error_code)
VALUES ($1, $2, $3, pg_catalog.transaction_timestamp(), $4, $5, $6, $7, $8, $9, $10, $11)`,
	parameterCount: 11,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		eventSequence(input.sequence),
		nonemptyText(input.resource, "Resource Identity"),
		uuid(input.dispatchId, "dispatch identity"),
		nullableUuid(input.attemptId, "attempt identity"),
		nullableDigest(input.leaseTokenDigest),
		nonemptyText(input.causationId, "causation identity"),
		nonemptyText(input.correlationId, "correlation identity"),
		enumText<DurableEventKind>(input.kind, durableEventKinds, "event kind"),
		input.errorCode === null
			? null
			: enumText<DurableEventErrorCode>(
					input.errorCode,
					durableEventErrorCodes,
					"event error code",
				),
	],
	decode(result) {
		if (
			result.command !== "INSERT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 0
		)
			throw new TypeError("invalid PostgreSQL Durable event insert result");
	},
});
