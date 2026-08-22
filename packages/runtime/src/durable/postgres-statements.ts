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

function boundedText(
	value: string,
	minimum: number,
	maximum: number,
	label: string,
): string {
	const length = [...value].length;
	if (value.includes("\0") || length < minimum || length > maximum)
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

export type DurableEffectFenceInput = Readonly<{
	application: string;
	runId: string;
	attemptId: string;
	leaseTokenDigest: string;
}>;

export const durableEffectFence: PostgresStatement<
	DurableEffectFenceInput,
	boolean
> = definePostgresStatement({
	name: "durable.effect.fence",
	text: `SELECT 1 AS held FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2
  AND current_attempt_id = $3 AND lease_token_digest = $4
FOR UPDATE`,
	parameterCount: 4,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		uuid(input.attemptId, "attempt identity"),
		digest(input.leaseTokenDigest),
	],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError("invalid PostgreSQL Durable effect fence result");
		if (result.rowCount === 0) return false;
		if (result.rows[0]?.length !== 1 || result.rows[0][0] !== 1)
			throw new TypeError("invalid PostgreSQL Durable effect fence result");
		return true;
	},
});

export type DurableEffectSettleInput = Readonly<{
	application: string;
	runId: string;
	effectName: string;
	receipt: string;
	attemptId: string;
}>;

export const durableEffectSettle: PostgresStatement<
	DurableEffectSettleInput,
	string | null
> = definePostgresStatement({
	name: "durable.effect.settle",
	text: `UPDATE questpie_internal.durable_effects
SET status = 'succeeded', receipt = $4, settled_attempt_id = $5,
    settled_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3
  AND status IN ('ambiguous', 'pending')
RETURNING effect_id::text`,
	parameterCount: 5,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		boundedText(input.effectName, 1, 63, "effect name"),
		boundedText(input.receipt, 0, 256, "effect receipt"),
		uuid(input.attemptId, "attempt identity"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError("invalid PostgreSQL Durable effect settle result");
		if (result.rowCount === 0) return null;
		const row = result.rows[0];
		if (row?.length !== 1 || typeof row[0] !== "string")
			throw new TypeError("invalid PostgreSQL Durable effect settle result");
		return uuid(row[0], "effect identity");
	},
});

export type DurableEffectAmbiguousInput = Readonly<{
	application: string;
	runId: string;
	effectName: string;
}>;

export const durableEffectAmbiguous: PostgresStatement<
	DurableEffectAmbiguousInput,
	string | null
> = definePostgresStatement({
	name: "durable.effect.ambiguous",
	text: `UPDATE questpie_internal.durable_effects
SET status = 'ambiguous'
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3 AND status = 'pending'
RETURNING effect_id::text`,
	parameterCount: 3,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		boundedText(input.effectName, 1, 63, "effect name"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError("invalid PostgreSQL Durable ambiguous effect result");
		if (result.rowCount === 0) return null;
		const row = result.rows[0];
		if (row?.length !== 1 || typeof row[0] !== "string")
			throw new TypeError("invalid PostgreSQL Durable ambiguous effect result");
		return uuid(row[0], "effect identity");
	},
});

export type DurableEffectReservationInsertInput = Readonly<{
	application: string;
	runId: string;
	effectName: string;
	effectId: string;
	inputDigest: string;
	attemptId: string;
}>;

export const durableEffectReservationInsert: PostgresStatement<
	DurableEffectReservationInsertInput,
	void
> = definePostgresStatement({
	name: "durable.effect.reservation.insert",
	text: `INSERT INTO questpie_internal.durable_effects
  (application_name, run_id, effect_name, effect_id, input_digest, status,
   reserved_attempt_id, reserved_at)
VALUES ($1, $2, $3, $4, $5, 'pending', $6, pg_catalog.transaction_timestamp())
ON CONFLICT DO NOTHING`,
	parameterCount: 6,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		boundedText(input.effectName, 1, 63, "effect name"),
		uuid(input.effectId, "effect identity"),
		digest(input.inputDigest),
		uuid(input.attemptId, "attempt identity"),
	],
	decode(result) {
		if (
			result.command !== "INSERT" ||
			result.rowCount === null ||
			result.rowCount < 0 ||
			result.rowCount > 1 ||
			result.rows.length !== 0
		)
			throw new TypeError(
				"invalid PostgreSQL Durable effect reservation result",
			);
	},
});

export type DurableEffectReservationReadInput = Readonly<{
	application: string;
	runId: string;
	effectName: string;
}>;

export type DurableEffectReservationRow = Readonly<{
	effectId: string;
	status: "acknowledged" | "ambiguous" | "pending" | "succeeded";
	receipt: string | null;
	inputDigest: string;
}>;

const durableEffectStatuses: ReadonlySet<
	DurableEffectReservationRow["status"]
> = new Set(["acknowledged", "ambiguous", "pending", "succeeded"]);

export const durableEffectReservationRead: PostgresStatement<
	DurableEffectReservationReadInput,
	DurableEffectReservationRow
> = definePostgresStatement({
	name: "durable.effect.reservation.read",
	text: `SELECT effect_id::text AS "effectId", status, receipt, input_digest AS "inputDigest"
FROM questpie_internal.durable_effects
WHERE application_name = $1 AND run_id = $2 AND effect_name = $3`,
	parameterCount: 3,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		boundedText(input.effectName, 1, 63, "effect name"),
	],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 4 ||
			typeof row[0] !== "string" ||
			typeof row[1] !== "string" ||
			!durableEffectStatuses.has(
				row[1] as DurableEffectReservationRow["status"],
			) ||
			!(row[2] === null || typeof row[2] === "string") ||
			typeof row[3] !== "string"
		)
			throw new TypeError("invalid PostgreSQL Durable effect reservation row");
		const status = row[1] as DurableEffectReservationRow["status"];
		const receipt =
			row[2] === null ? null : boundedText(row[2], 0, 256, "effect receipt");
		if ((status === "succeeded") !== (receipt !== null))
			throw new TypeError("invalid PostgreSQL Durable effect reservation row");
		return Object.freeze({
			effectId: uuid(row[0], "effect identity"),
			status,
			receipt,
			inputDigest: digest(row[3]),
		});
	},
});

export type DurableEffectReadInput = Readonly<{
	application: string;
	runId: string;
}>;

export type DurableEffectReadRow = Readonly<{
	effectName: string;
	effectId: string;
	status: DurableEffectReservationRow["status"];
	receipt: string | null;
}>;

export const durableEffectRead: PostgresStatement<
	DurableEffectReadInput,
	readonly DurableEffectReadRow[]
> = definePostgresStatement({
	name: "durable.effect.read",
	text: `SELECT effect_name AS "effectName", effect_id::text AS "effectId",
       status, receipt
FROM questpie_internal.durable_effects
WHERE application_name = $1 AND run_id = $2
ORDER BY effect_name`,
	parameterCount: 2,
	parameters: (input) => [
		nonemptyText(input.application, "application identity"),
		uuid(input.runId, "run identity"),
	],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rowCount < 0 ||
			result.rowCount !== result.rows.length
		)
			throw new TypeError("invalid PostgreSQL Durable effect read result");
		return Object.freeze(
			result.rows.map((row) => {
				if (
					row.length !== 4 ||
					typeof row[0] !== "string" ||
					typeof row[1] !== "string" ||
					typeof row[2] !== "string" ||
					!durableEffectStatuses.has(
						row[2] as DurableEffectReservationRow["status"],
					) ||
					!(row[3] === null || typeof row[3] === "string")
				)
					throw new TypeError("invalid PostgreSQL Durable effect read row");
				const status = row[2] as DurableEffectReservationRow["status"];
				const receipt =
					row[3] === null
						? null
						: boundedText(row[3], 0, 256, "effect receipt");
				if ((status === "succeeded") !== (receipt !== null))
					throw new TypeError("invalid PostgreSQL Durable effect read row");
				return Object.freeze({
					effectName: boundedText(row[0], 1, 63, "effect name"),
					effectId: uuid(row[1], "effect identity"),
					status,
					receipt,
				});
			}),
		);
	},
});
