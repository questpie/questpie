import {
	definePostgresStatement,
	type PostgresStatement,
} from "../postgres/contract";
import type { DurablePrincipalKind } from "./rows";

type StatementResult = Readonly<{
	command: string;
	rowCount: number | null;
	rows: readonly (readonly unknown[])[];
}>;

function text(value: string, label: string, maximum?: number): string {
	if (
		value.length === 0 ||
		value.includes("\0") ||
		(maximum !== undefined && [...value].length > maximum)
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function uuid(value: string, label: string): string {
	if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function digest(value: string, label: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function integer(
	value: number,
	minimum: number,
	maximum: number,
	label: string,
) {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function seconds(
	value: number,
	minimum: number,
	maximum: number,
	label: string,
) {
	if (!Number.isFinite(value) || value < minimum || value > maximum)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return value;
}

function date(value: unknown, label: string): Date {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return new Date(value.getTime());
}

function bytes(value: unknown, maximum: number, label: string): Uint8Array {
	if (!(value instanceof Uint8Array) || value.byteLength > maximum)
		throw new TypeError(`invalid PostgreSQL Durable ${label}`);
	return new Uint8Array(value);
}

function principalKind(value: unknown): DurablePrincipalKind {
	if (value !== "anonymous" && value !== "service" && value !== "user")
		throw new TypeError("invalid PostgreSQL Durable Principal kind");
	return value;
}

function exactVoid(
	result: StatementResult,
	command: "INSERT" | "UPDATE",
	label: string,
): void {
	if (
		result.command !== command ||
		result.rowCount !== 1 ||
		result.rows.length !== 0
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
}

function returnedAttempts(
	result: StatementResult,
	label: string,
): readonly Readonly<{ attemptId: string; leaseTokenDigest: string }>[] {
	if (
		result.command !== "UPDATE" ||
		result.rowCount === null ||
		result.rowCount !== result.rows.length ||
		result.rowCount < 0 ||
		result.rowCount > 8
	)
		throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
	return Object.freeze(
		result.rows.map((row) => {
			if (row.length !== 2)
				throw new TypeError(`invalid PostgreSQL Durable ${label} result`);
			return Object.freeze({
				attemptId: uuid(row[0] as string, "attempt identity"),
				leaseTokenDigest: digest(row[1] as string, "lease token digest"),
			});
		}),
	);
}

export type DurableClaimRun = Readonly<{
	runId: string;
	dispatchId: string;
	resource: string;
	tenantId: string;
	principalKind: DurablePrincipalKind;
	principalId: string;
	contextInputBytes: Uint8Array;
	payloadBytes: Uint8Array;
	retryBytes: Uint8Array;
	runtimeBuildDigest: string;
	executableDigest: string;
	causationId: string;
	correlationId: string;
	cancellationRequested: boolean;
	attemptCount: number;
}>;

type RunIdentityInput = Readonly<{ application: string; runId: string }>;

const runSelection = `run_id::text AS "runId",
       dispatch_id::text AS "dispatchId",
       resource_identity AS "resource",
       tenant_id AS "tenantId",
       principal_kind AS "principalKind",
       principal_id AS "principalId",
       context_input_bytes AS "contextInputBytes",
       payload_bytes AS "payloadBytes",
       retry_bytes AS "retryBytes",
       runtime_build_digest AS "runtimeBuildDigest",
       executable_digest AS "executableDigest",
       causation_id AS "causationId",
       correlation_id AS "correlationId",
       cancellation_requested AS "cancellationRequested",
       attempt_count AS "attemptCount"`;

export const durableClaimRunSelect: PostgresStatement<
	RunIdentityInput,
	DurableClaimRun | null
> = definePostgresStatement({
	name: "durable.claim.run.select",
	text: `SELECT ${runSelection}
FROM questpie_internal.durable_runs
WHERE application_name = $1 AND run_id = $2
  AND NOT cancellation_requested
  AND ((state IN ('delayed', 'ready') AND available_at <= pg_catalog.transaction_timestamp())
    OR (state = 'running' AND lease_expires_at <= pg_catalog.transaction_timestamp()))
FOR UPDATE SKIP LOCKED`,
	parameterCount: 2,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.runId, "run identity"),
	],
	decode(result) {
		if (
			result.command !== "SELECT" ||
			result.rowCount === null ||
			result.rowCount !== result.rows.length ||
			result.rowCount < 0 ||
			result.rowCount > 1
		)
			throw new TypeError("invalid PostgreSQL Durable claim selection result");
		if (result.rowCount === 0) return null;
		const row = result.rows[0];
		if (row?.length !== 15)
			throw new TypeError("invalid PostgreSQL Durable claim selection result");
		if (typeof row[13] !== "boolean")
			throw new TypeError("invalid PostgreSQL Durable claim selection result");
		return Object.freeze({
			runId: uuid(row[0] as string, "run identity"),
			dispatchId: uuid(row[1] as string, "dispatch identity"),
			resource: text(row[2] as string, "Resource Identity"),
			tenantId: text(row[3] as string, "Tenant"),
			principalKind: principalKind(row[4]),
			principalId: text(row[5] as string, "Principal identity"),
			contextInputBytes: bytes(row[6], 262_144, "Context input"),
			payloadBytes: bytes(row[7], 262_144, "payload"),
			retryBytes: bytes(row[8], 4_096, "retry program"),
			runtimeBuildDigest: digest(row[9] as string, "Runtime Build digest"),
			executableDigest: digest(row[10] as string, "executable digest"),
			causationId: text(row[11] as string, "causation identity"),
			correlationId: text(row[12] as string, "correlation identity"),
			cancellationRequested: row[13],
			attemptCount: integer(row[14] as number, 0, 8, "attempt count"),
		});
	},
});

export const durableClaimAttemptsExhaust: PostgresStatement<
	RunIdentityInput,
	readonly Readonly<{ attemptId: string; leaseTokenDigest: string }>[]
> = definePostgresStatement({
	name: "durable.claim.attempts.exhaust",
	text: `UPDATE questpie_internal.durable_attempts
SET outcome = 'failed', failure_code = 'RETRY_EXHAUSTED'
WHERE application_name = $1 AND run_id = $2 AND outcome IS NULL
RETURNING attempt_id::text AS "attemptId", lease_token_digest AS "leaseTokenDigest"`,
	parameterCount: 2,
	parameters: durableClaimRunSelect.parameters,
	decode: (result) => returnedAttempts(result, "claim exhaustion"),
});

export const durableClaimRunExhaust: PostgresStatement<RunIdentityInput, void> =
	definePostgresStatement({
		name: "durable.claim.run.exhaust",
		text: `UPDATE questpie_internal.durable_runs
SET state = 'failed', current_attempt_id = NULL, lease_token_digest = NULL,
    lease_expires_at = NULL, result_bytes = NULL,
    failure_code = 'RETRY_EXHAUSTED', dead_letter = true,
    terminal_at = pg_catalog.transaction_timestamp()
WHERE application_name = $1 AND run_id = $2`,
		parameterCount: 2,
		parameters: durableClaimRunSelect.parameters,
		decode: (result) => exactVoid(result, "UPDATE", "claim exhaustion run"),
	});

export type DurableClaimRunLeaseInput = RunIdentityInput &
	Readonly<{
		attemptNumber: number;
		attemptId: string;
		leaseTokenDigest: string;
		leaseSeconds: number;
		deadlineSeconds: number;
	}>;

export const durableClaimRunLease: PostgresStatement<
	DurableClaimRunLeaseInput,
	Readonly<{ leaseExpiresAt: Date; deadlineAt: Date }>
> = definePostgresStatement({
	name: "durable.claim.run.lease",
	text: `UPDATE questpie_internal.durable_runs
SET state = 'running', attempt_count = $3, current_attempt_id = $4,
    lease_token_digest = $5,
    lease_expires_at = pg_catalog.transaction_timestamp() + make_interval(secs => $6::double precision)
WHERE application_name = $1 AND run_id = $2
RETURNING lease_expires_at AS "leaseExpiresAt",
          pg_catalog.transaction_timestamp() + make_interval(secs => $7::double precision) AS "deadlineAt"`,
	parameterCount: 7,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		integer(input.attemptNumber, 1, 8, "attempt number"),
		uuid(input.attemptId, "attempt identity"),
		digest(input.leaseTokenDigest, "lease token digest"),
		seconds(input.leaseSeconds, 1, 30, "lease duration"),
		seconds(input.deadlineSeconds, input.leaseSeconds, 300, "attempt deadline"),
	],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			result.rows[0]?.length !== 2
		)
			throw new TypeError("invalid PostgreSQL Durable claim lease result");
		return Object.freeze({
			leaseExpiresAt: date(result.rows[0][0], "claim lease result"),
			deadlineAt: date(result.rows[0][1], "claim deadline result"),
		});
	},
});

export const durableClaimAttemptsSupersede: PostgresStatement<
	Readonly<RunIdentityInput & { attemptId: string }>,
	readonly Readonly<{ attemptId: string; leaseTokenDigest: string }>[]
> = definePostgresStatement({
	name: "durable.claim.attempts.supersede",
	text: `UPDATE questpie_internal.durable_attempts
SET outcome = 'leaseSuperseded'
WHERE application_name = $1 AND run_id = $2 AND attempt_id <> $3 AND outcome IS NULL
RETURNING attempt_id::text AS "attemptId", lease_token_digest AS "leaseTokenDigest"`,
	parameterCount: 3,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.runId, "run identity"),
		uuid(input.attemptId, "attempt identity"),
	],
	decode: (result) => returnedAttempts(result, "claim supersession"),
});

export type DurableClaimAttemptInsertInput = Readonly<{
	application: string;
	attemptId: string;
	runId: string;
	attemptNumber: number;
	workerId: string;
	leaseTokenDigest: string;
	leaseExpiresAt: Date;
	deadlineAt: Date;
}>;

export const durableClaimAttemptInsert: PostgresStatement<
	DurableClaimAttemptInsertInput,
	void
> = definePostgresStatement({
	name: "durable.claim.attempt.insert",
	text: `INSERT INTO questpie_internal.durable_attempts
  (application_name, attempt_id, run_id, attempt_number, worker_id, lease_token_digest,
   lease_expires_at, deadline_at, started_at, heartbeat_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
   pg_catalog.transaction_timestamp(), pg_catalog.transaction_timestamp())`,
	parameterCount: 8,
	parameters: (input) => [
		text(input.application, "application identity"),
		uuid(input.attemptId, "attempt identity"),
		uuid(input.runId, "run identity"),
		integer(input.attemptNumber, 1, 8, "attempt number"),
		text(input.workerId, "worker identity", 128),
		digest(input.leaseTokenDigest, "lease token digest"),
		date(input.leaseExpiresAt, "lease expiry"),
		date(input.deadlineAt, "attempt deadline"),
	],
	decode: (result) => exactVoid(result, "INSERT", "claim attempt insert"),
});
