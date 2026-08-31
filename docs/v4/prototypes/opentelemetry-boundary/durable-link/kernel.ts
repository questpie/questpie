import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
	internalProtocolV7Catalog,
	internalProtocolV7Checksum,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v7";
import { durableRunIdentity } from "../../../../../packages/runtime/src/durable/acceptance";

export type ResourceKind = "job" | "reaction";
export type PrincipalKind = "anonymous" | "service" | "user";
export type TraceContext = Readonly<{
	traceId: Uint8Array;
	spanId: Uint8Array;
	flags: number;
}>;
export type AcceptedRun = Readonly<{
	dispatchId: string;
	runId: string;
	trace: TraceContext | null;
}>;
export type Attempt = Readonly<{
	attemptId: string;
	attemptNumber: number;
	root: TraceContext;
	link: TraceContext | null;
}>;
export type AcceptanceInput = Readonly<{
	application: string;
	tenantId: string;
	sourceOperation: string;
	principalKind: PrincipalKind;
	principalId: string;
	callId: string;
	dispatchSlot: string;
	dispatchId: string;
	kind: ResourceKind;
	resource: string;
	requestDigest: string;
	payloadBytes: Uint8Array;
	trace: TraceContext | null;
}>;

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

const traceColumns = [
	["durable_runs", "trace_id", "bytea", false],
	["durable_runs", "span_id", "bytea", false],
	["durable_runs", "trace_flags", "smallint", false],
] as const;
const traceConstraint = [
	"durable_runs",
	"durable_run_trace_context_complete",
	"c",
	"CHECK (trace_id IS NULL AND span_id IS NULL AND trace_flags IS NULL OR octet_length(trace_id) = 16 AND trace_id <> decode(repeat('00'::text, 16), 'hex'::text) AND octet_length(span_id) = 8 AND span_id <> decode(repeat('00'::text, 8), 'hex'::text) AND trace_flags >= 0 AND trace_flags <= 255)",
] as const;

function insertAfterTable<Row extends readonly unknown[]>(
	rows: readonly Row[],
	table: string,
	additions: readonly Row[],
): readonly Row[] {
	const result = [...rows];
	let index = result.findLastIndex((row) => row[0] === table) + 1;
	if (index === 0) throw new TypeError(`catalog table ${table} is absent`);
	result.splice(index, 0, ...additions);
	return Object.freeze(result);
}

export const internalProtocolV8Sql = `ALTER TABLE questpie_internal.durable_runs
  ADD COLUMN trace_id bytea,
  ADD COLUMN span_id bytea,
  ADD COLUMN trace_flags smallint,
  ADD CONSTRAINT durable_run_trace_context_complete CHECK (
    (trace_id IS NULL AND span_id IS NULL AND trace_flags IS NULL)
    OR (octet_length(trace_id) = 16
      AND trace_id <> decode(repeat('00', 16), 'hex')
      AND octet_length(span_id) = 8
      AND span_id <> decode(repeat('00', 8), 'hex')
      AND trace_flags BETWEEN 0 AND 255)
  );
`;

export const internalProtocolV8Checksum = createHash("sha256")
	.update("questpie-internal-protocol-v8\0")
	.update(internalProtocolV7Checksum)
	.update("\0")
	.update(internalProtocolV8Sql)
	.digest("hex");

export const internalProtocolV8Catalog = Object.freeze({
	tables: Object.freeze([...internalProtocolV7Catalog.tables]),
	columns: insertAfterTable(
		internalProtocolV7Catalog.columns,
		"durable_runs",
		traceColumns,
	),
	constraints: insertAfterTable(
		internalProtocolV7Catalog.constraints,
		"durable_runs",
		[traceConstraint],
	),
	indexes: Object.freeze([...internalProtocolV7Catalog.indexes]),
});

function identifier(value: string): string {
	if (!/^[a-z][a-z0-9_]*$/u.test(value)) throw new TypeError("unsafe schema");
	return `"${value}"`;
}

function bytes(value: Uint8Array, length: number, name: string): Buffer {
	if (value.byteLength !== length)
		throw new TypeError(`${name} must contain exactly ${length} bytes`);
	return Buffer.from(value);
}

function identityBytes(
	value: Uint8Array,
	length: number,
	name: string,
): Buffer {
	const result = bytes(value, length, name);
	if (result.every((byte) => byte === 0))
		throw new TypeError(`${name} must not be all zero`);
	return result;
}

function digest(value: string, name: string): string {
	if (!/^[0-9a-f]{64}$/u.test(value))
		throw new TypeError(`${name} must be a lowercase SHA-256 digest`);
	return value;
}

function boundedBytes(value: Uint8Array): Buffer {
	if (value.byteLength > 262_144)
		throw new TypeError("payload exceeds its production byte limit");
	return Buffer.from(value);
}

export function traceContext(input: TraceContext): TraceContext {
	if (
		!Number.isSafeInteger(input.flags) ||
		input.flags < 0 ||
		input.flags > 255
	)
		throw new TypeError("trace flags must be an integer from 0 through 255");
	return Object.freeze({
		traceId: identityBytes(input.traceId, 16, "trace ID"),
		spanId: identityBytes(input.spanId, 8, "span ID"),
		flags: input.flags,
	});
}

function generatedTrace(): TraceContext {
	return traceContext({
		traceId: randomBytes(16),
		spanId: randomBytes(8),
		flags: 1,
	});
}

function decodedTrace(row: {
	trace_id: Buffer | null;
	span_id: Buffer | null;
	trace_flags: number | null;
}): TraceContext | null {
	if (row.trace_id === null && row.span_id === null && row.trace_flags === null)
		return null;
	if (row.trace_id === null || row.span_id === null || row.trace_flags === null)
		throw new TypeError("partial durable trace context");
	return traceContext({
		traceId: row.trace_id,
		spanId: row.span_id,
		flags: row.trace_flags,
	});
}

async function transaction<Result>(
	pool: Pool,
	use: (client: PoolClient) => Promise<Result>,
): Promise<Result> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const result = await use(client);
		await client.query("COMMIT");
		return result;
	} catch (error) {
		await client.query("ROLLBACK").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}

/** Exact protocol-v7 columns and constraints used by Job/Reaction acceptance. */
export async function installProtocolV7(pool: Pool, schemaName: string) {
	const schema = identifier(schemaName);
	await pool.query(`CREATE SCHEMA ${schema};
CREATE TABLE ${schema}.protocol (
  singleton boolean PRIMARY KEY,
  version integer NOT NULL,
  checksum text NOT NULL,
  CONSTRAINT protocol_singleton_true CHECK (singleton),
  CONSTRAINT protocol_checksum_sha256 CHECK (checksum ~ '^[0-9a-f]{64}$')
);
INSERT INTO ${schema}.protocol (singleton, version, checksum)
VALUES (true, 7, '${internalProtocolV7Checksum}');

CREATE TABLE ${schema}.durable_dispatches (
  application_name text NOT NULL,
  tenant_id text NOT NULL,
  source_operation text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  call_id text NOT NULL,
  dispatch_slot text NOT NULL,
  record_id uuid NOT NULL,
  resource_identity text NOT NULL,
  input_digest text NOT NULL,
  payload_bytes bytea NOT NULL,
  transaction_id xid8 NOT NULL,
  recorded_at timestamptz NOT NULL,
  state text NOT NULL,
  resource_kind text NOT NULL,
  PRIMARY KEY (application_name, record_id),
  CONSTRAINT durable_dispatch_origin_key UNIQUE
    (application_name, tenant_id, source_operation, principal_kind, principal_id, call_id, dispatch_slot),
  CONSTRAINT durable_dispatch_principal_kind_known CHECK
    (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT durable_dispatch_call_id_bounded CHECK (length(call_id) BETWEEN 1 AND 256),
  CONSTRAINT durable_dispatch_input_digest_sha256 CHECK (input_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT durable_dispatch_payload_bytes_bounded CHECK (octet_length(payload_bytes) <= 262144),
  CONSTRAINT durable_dispatch_state_known CHECK (state IN ('accepted', 'pending')),
  CONSTRAINT durable_dispatch_resource_kind_known CHECK (resource_kind IN ('job', 'reaction'))
);

CREATE TABLE ${schema}.durable_runs (
  application_name text NOT NULL,
  run_id uuid NOT NULL,
  dispatch_id uuid NOT NULL,
  resource_identity text NOT NULL,
  tenant_id text NOT NULL,
  principal_kind text NOT NULL,
  principal_id text NOT NULL,
  run_as text NOT NULL,
  context_input_bytes bytea NOT NULL,
  payload_bytes bytea NOT NULL,
  retry_bytes bytea NOT NULL,
  runtime_build_digest text NOT NULL,
  executable_digest text NOT NULL,
  causation_kind text NOT NULL,
  causation_id text NOT NULL,
  correlation_id text NOT NULL,
  state text NOT NULL,
  attempt_count integer NOT NULL,
  current_attempt_id uuid,
  lease_token_digest text,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL,
  horizon_at timestamptz NOT NULL,
  cancellation_requested boolean NOT NULL,
  event_sequence integer NOT NULL,
  result_bytes bytea,
  failure_code text,
  dead_letter boolean NOT NULL,
  accepted_at timestamptz NOT NULL,
  terminal_at timestamptz,
  semantic_version integer NOT NULL,
  PRIMARY KEY (application_name, run_id),
  CONSTRAINT durable_run_dispatch_unique UNIQUE (application_name, dispatch_id),
  FOREIGN KEY (application_name, dispatch_id)
    REFERENCES ${schema}.durable_dispatches (application_name, record_id),
  CONSTRAINT durable_run_state_known CHECK
    (state IN ('cancelled', 'delayed', 'failed', 'ready', 'running', 'succeeded')),
  CONSTRAINT durable_run_principal_kind_known CHECK
    (principal_kind IN ('anonymous', 'service', 'user')),
  CONSTRAINT durable_run_as_known CHECK (run_as = 'caller'),
  CONSTRAINT durable_run_causation_kind_known CHECK
    (causation_kind IN ('explicit', 'mutationDispatch')),
  CONSTRAINT durable_run_attempt_count_bounded CHECK (attempt_count BETWEEN 0 AND 8),
  CONSTRAINT durable_run_event_sequence_bounded CHECK (event_sequence BETWEEN 0 AND 1024),
  CONSTRAINT durable_run_payload_bytes_bounded CHECK (octet_length(payload_bytes) <= 262144),
  CONSTRAINT durable_run_context_bytes_bounded CHECK (octet_length(context_input_bytes) <= 262144),
  CONSTRAINT durable_run_retry_bytes_bounded CHECK (octet_length(retry_bytes) <= 4096),
  CONSTRAINT durable_run_result_bytes_bounded CHECK
    (result_bytes IS NULL OR octet_length(result_bytes) <= 262144),
  CONSTRAINT durable_run_lease_shape CHECK (
    (state = 'running' AND current_attempt_id IS NOT NULL
      AND lease_token_digest IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'running' AND current_attempt_id IS NULL
      AND lease_token_digest IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT durable_run_lease_digest_sha256 CHECK
    (lease_token_digest IS NULL OR lease_token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT durable_run_terminal_shape CHECK (
    (state IN ('cancelled', 'failed', 'succeeded') AND terminal_at IS NOT NULL)
    OR (state IN ('delayed', 'ready', 'running') AND terminal_at IS NULL)
  ),
  CONSTRAINT durable_run_result_shape CHECK (
    (state = 'succeeded' AND result_bytes IS NOT NULL AND failure_code IS NULL)
    OR (state <> 'succeeded' AND result_bytes IS NULL)
  ),
  CONSTRAINT durable_run_failure_shape CHECK (
    (state = 'failed' AND failure_code IS NOT NULL)
    OR (state <> 'failed' AND NOT dead_letter)
  ),
  CONSTRAINT durable_run_failure_code_known CHECK (
    failure_code IS NULL OR failure_code IN
      ('EFFECT_AMBIGUOUS', 'EFFECT_CONFLICT', 'HANDLER_FAILED', 'REACTION_ERROR',
       'RESOURCE_LIMIT', 'RETRY_EXHAUSTED', 'RUN_AS_DENIED', 'VALIDATION_FAILED')
  ),
  CONSTRAINT durable_run_semantic_version_positive CHECK (semantic_version > 0)
);
CREATE INDEX durable_runs_claim_idx ON ${schema}.durable_runs
  (application_name, state, available_at, run_id);
CREATE INDEX durable_runs_lease_idx ON ${schema}.durable_runs
  (application_name, state, lease_expires_at);
CREATE INDEX durable_runs_resource_idx ON ${schema}.durable_runs
  (application_name, resource_identity, state);

CREATE TABLE ${schema}.durable_attempts (
  application_name text NOT NULL,
  attempt_id uuid NOT NULL,
  run_id uuid NOT NULL,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  lease_token_digest text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  deadline_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  outcome text,
  failure_code text,
  PRIMARY KEY (application_name, attempt_id),
  CONSTRAINT durable_attempt_number_unique UNIQUE (application_name, run_id, attempt_number),
  FOREIGN KEY (application_name, run_id)
    REFERENCES ${schema}.durable_runs (application_name, run_id) ON DELETE CASCADE,
  CONSTRAINT durable_attempt_number_bounded CHECK (attempt_number BETWEEN 1 AND 8),
  CONSTRAINT durable_attempt_worker_bounded CHECK (length(worker_id) BETWEEN 1 AND 128),
  CONSTRAINT durable_attempt_lease_digest_sha256 CHECK (lease_token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT durable_attempt_outcome_known CHECK
    (outcome IS NULL OR outcome IN ('cancelled', 'failed', 'leaseSuperseded', 'succeeded')),
  CONSTRAINT durable_attempt_failure_shape CHECK (failure_code IS NULL OR outcome = 'failed')
);`);
}

async function protocolRow(pool: Queryable, schema: string) {
	const result = await pool.query<{ version: number; checksum: string }>(
		`SELECT version, checksum FROM ${schema}.protocol WHERE singleton = true`,
	);
	return result.rows[0];
}

export async function assertRuntimeProtocol(
	pool: Pool,
	schemaName: string,
	version: 7 | 8,
) {
	const protocol = await protocolRow(pool, identifier(schemaName));
	const checksum =
		version === 7 ? internalProtocolV7Checksum : internalProtocolV8Checksum;
	if (protocol?.version !== version || protocol.checksum !== checksum)
		throw new TypeError(`protocol v${version} Runtime refused by database`);
}

export async function upgradeProtocolV8(
	pool: Pool,
	schemaName: string,
	allowNonRolling: boolean,
) {
	const schema = identifier(schemaName);
	await transaction(pool, async (client) => {
		const current = await client.query<{ version: number; checksum: string }>(
			`SELECT version, checksum FROM ${schema}.protocol WHERE singleton = true FOR UPDATE`,
		);
		if (
			current.rows[0]?.version !== 7 ||
			current.rows[0]?.checksum !== internalProtocolV7Checksum
		)
			throw new TypeError("protocol v8 upgrade requires exact protocol v7");
		if (!allowNonRolling)
			throw new TypeError("protocol v8 requires explicit non-rolling cutover");
		await client.query(
			internalProtocolV8Sql.replaceAll("questpie_internal", schema),
		);
		await client.query(
			`UPDATE ${schema}.protocol SET version = 8, checksum = $1 WHERE singleton = true`,
			[internalProtocolV8Checksum],
		);
	});
}

async function selectRun(queryable: Queryable, schema: string, runId: string) {
	const selected = await queryable.query<{
		dispatch_id: string;
		run_id: string;
		trace_id: Buffer | null;
		span_id: Buffer | null;
		trace_flags: number | null;
	}>(
		`SELECT dispatch_id, run_id, trace_id, span_id, trace_flags
		 FROM ${schema}.durable_runs WHERE run_id = $1`,
		[runId],
	);
	const row = selected.rows[0];
	if (!row) throw new TypeError("durable run is absent");
	return row;
}

async function acceptInTransaction(
	client: PoolClient,
	schema: string,
	input: AcceptanceInput,
): Promise<AcceptedRun> {
	const requestDigest = digest(input.requestDigest, "request digest");
	const payload = boundedBytes(input.payloadBytes);
	const trace = input.trace === null ? null : traceContext(input.trace);
	const protocol = await protocolRow(client, schema);
	if (protocol?.version === 7 && trace !== null)
		throw new TypeError("protocol v7 cannot store durable trace context");
	if (protocol?.version !== 7 && protocol?.version !== 8)
		throw new TypeError("unsupported protocol");
	const claimed = await client.query<{ record_id: string }>(
		`INSERT INTO ${schema}.durable_dispatches
		 (application_name, tenant_id, source_operation, principal_kind, principal_id,
		  call_id, dispatch_slot, record_id, resource_identity, input_digest,
		  payload_bytes, transaction_id, recorded_at, state, resource_kind)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
		  pg_catalog.pg_current_xact_id(),pg_catalog.transaction_timestamp(),'pending',$12)
		 ON CONFLICT DO NOTHING RETURNING record_id`,
		[
			input.application,
			input.tenantId,
			input.sourceOperation,
			input.principalKind,
			input.principalId,
			input.callId,
			input.dispatchSlot,
			input.dispatchId,
			input.resource,
			requestDigest,
			payload,
			input.kind,
		],
	);
	const runId = durableRunIdentity(input.dispatchId);
	if (claimed.rowCount === 0) {
		const existing = await client.query<{ input_digest: string }>(
			`SELECT input_digest FROM ${schema}.durable_dispatches
			 WHERE application_name = $1 AND record_id = $2 FOR UPDATE`,
			[input.application, input.dispatchId],
		);
		if (existing.rows[0]?.input_digest !== requestDigest)
			throw new TypeError("acceptance request conflict");
		const row = await selectRun(client, schema, runId);
		return Object.freeze({
			dispatchId: row.dispatch_id,
			runId: row.run_id,
			trace: decodedTrace(row),
		});
	}
	await client.query(
		`UPDATE ${schema}.durable_dispatches SET state = 'accepted'
		 WHERE application_name = $1 AND record_id = $2 AND state = 'pending'`,
		[input.application, input.dispatchId],
	);
	const baseColumns = `application_name, run_id, dispatch_id, resource_identity,
		tenant_id, principal_kind, principal_id, run_as, context_input_bytes,
		payload_bytes, retry_bytes, runtime_build_digest, executable_digest,
		causation_kind, causation_id, correlation_id, state, attempt_count,
		available_at, horizon_at, cancellation_requested, event_sequence,
		dead_letter, accepted_at, semantic_version`;
	const baseValues = `$1,$2,$3,$4,$5,$6,$7,'caller','\\x00',$8,'\\x00',$9,$10,
		$11,$12,$12,'ready',0,pg_catalog.transaction_timestamp(),
		pg_catalog.transaction_timestamp() + interval '1 day',false,1,false,
		pg_catalog.transaction_timestamp(),1`;
	const parameters = [
		input.application,
		runId,
		input.dispatchId,
		input.resource,
		input.tenantId,
		input.principalKind,
		input.principalId,
		payload,
		"0".repeat(64),
		"1".repeat(64),
		input.kind === "job" ? "explicit" : "mutationDispatch",
		input.callId,
	];
	if (protocol.version === 8) {
		await client.query(
			`INSERT INTO ${schema}.durable_runs
			 (${baseColumns}, trace_id, span_id, trace_flags)
			 VALUES (${baseValues},$13,$14,$15)`,
			[
				...parameters,
				trace?.traceId ?? null,
				trace?.spanId ?? null,
				trace?.flags ?? null,
			],
		);
	} else {
		await client.query(
			`INSERT INTO ${schema}.durable_runs (${baseColumns}) VALUES (${baseValues})`,
			parameters,
		);
	}
	return Object.freeze({ dispatchId: input.dispatchId, runId, trace });
}

export async function accept(
	pool: Pool,
	schemaName: string,
	input: AcceptanceInput,
): Promise<AcceptedRun> {
	const schema = identifier(schemaName);
	return transaction(pool, (client) =>
		acceptInTransaction(client, schema, input),
	);
}

export async function acceptThenRollback(
	pool: Pool,
	schemaName: string,
	input: AcceptanceInput,
) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await acceptInTransaction(client, identifier(schemaName), input);
		await client.query("ROLLBACK");
	} finally {
		client.release();
	}
}

export async function startAttempt(
	pool: Pool,
	schemaName: string,
	runId: string,
	workerId: string,
): Promise<Attempt> {
	const schema = identifier(schemaName);
	return transaction(pool, async (client) => {
		const selected = await client.query<{
			application_name: string;
			attempt_count: number;
			trace_id: Buffer | null;
			span_id: Buffer | null;
			trace_flags: number | null;
		}>(
			`SELECT application_name, attempt_count, trace_id, span_id, trace_flags
			 FROM ${schema}.durable_runs WHERE run_id = $1 FOR UPDATE`,
			[runId],
		);
		const row = selected.rows[0];
		if (!row) throw new TypeError("durable run is absent");
		const attemptNumber = row.attempt_count + 1;
		if (attemptNumber > 8) throw new TypeError("attempt count exhausted");
		const attemptId = randomUUID();
		const leaseDigest = createHash("sha256")
			.update(randomBytes(32))
			.digest("hex");
		await client.query(
			`UPDATE ${schema}.durable_attempts SET outcome = 'leaseSuperseded'
			 WHERE application_name = $1 AND run_id = $2 AND outcome IS NULL`,
			[row.application_name, runId],
		);
		const times = await client.query<{
			lease_expires_at: Date;
			deadline_at: Date;
		}>(
			`UPDATE ${schema}.durable_runs
			 SET state = 'running', attempt_count = $3, current_attempt_id = $4,
			     lease_token_digest = $5,
			     lease_expires_at = pg_catalog.transaction_timestamp() + interval '30 seconds'
			 WHERE application_name = $1 AND run_id = $2
			 RETURNING lease_expires_at,
			   pg_catalog.transaction_timestamp() + interval '5 minutes' AS deadline_at`,
			[row.application_name, runId, attemptNumber, attemptId, leaseDigest],
		);
		await client.query(
			`INSERT INTO ${schema}.durable_attempts
			 (application_name, attempt_id, run_id, attempt_number, worker_id,
			  lease_token_digest, lease_expires_at, deadline_at, started_at, heartbeat_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
			  pg_catalog.transaction_timestamp(),pg_catalog.transaction_timestamp())`,
			[
				row.application_name,
				attemptId,
				runId,
				attemptNumber,
				workerId,
				leaseDigest,
				times.rows[0]?.lease_expires_at,
				times.rows[0]?.deadline_at,
			],
		);
		return Object.freeze({
			attemptId,
			attemptNumber,
			root: generatedTrace(),
			link: decodedTrace(row),
		});
	});
}

export async function pruneAttempts(
	pool: Pool,
	schemaName: string,
	runId: string,
) {
	const schema = identifier(schemaName);
	await transaction(pool, async (client) => {
		await client.query(
			`UPDATE ${schema}.durable_runs SET state = 'ready', current_attempt_id = NULL,
			 lease_token_digest = NULL, lease_expires_at = NULL WHERE run_id = $1`,
			[runId],
		);
		await client.query(
			`DELETE FROM ${schema}.durable_attempts WHERE run_id = $1`,
			[runId],
		);
	});
}

type Snapshot = Readonly<{
	application: string;
	tenantId: string;
	sourceOperation: string;
	principalKind: PrincipalKind;
	principalId: string;
	callId: string;
	dispatchSlot: string;
	kind: ResourceKind;
	resource: string;
	requestDigest: string;
	payloadHex: string;
	traceIdHex: string | null;
	spanIdHex: string | null;
	flags: number | null;
}>;

export async function backupRun(
	pool: Pool,
	schemaName: string,
	runIdOrDispatchId: string,
): Promise<string> {
	const result = await pool.query<{
		application_name: string;
		tenant_id: string;
		source_operation: string;
		principal_kind: PrincipalKind;
		principal_id: string;
		call_id: string;
		dispatch_slot: string;
		resource_kind: ResourceKind;
		resource_identity: string;
		input_digest: string;
		payload_bytes: Buffer;
		trace_id: Buffer | null;
		span_id: Buffer | null;
		trace_flags: number | null;
	}>(
		`SELECT d.application_name, d.tenant_id, d.source_operation,
		 d.principal_kind, d.principal_id, d.call_id, d.dispatch_slot,
		 d.resource_kind, d.resource_identity, d.input_digest, d.payload_bytes,
		 r.trace_id, r.span_id, r.trace_flags
		 FROM ${identifier(schemaName)}.durable_runs r
		 JOIN ${identifier(schemaName)}.durable_dispatches d
		   ON d.application_name = r.application_name AND d.record_id = r.dispatch_id
		 WHERE r.run_id = $1 OR r.dispatch_id = $1`,
		[runIdOrDispatchId],
	);
	const row = result.rows[0];
	if (!row) throw new TypeError("durable run is absent");
	return JSON.stringify({
		application: row.application_name,
		tenantId: row.tenant_id,
		sourceOperation: row.source_operation,
		principalKind: row.principal_kind,
		principalId: row.principal_id,
		callId: row.call_id,
		dispatchSlot: row.dispatch_slot,
		kind: row.resource_kind,
		resource: row.resource_identity,
		requestDigest: row.input_digest,
		payloadHex: row.payload_bytes.toString("hex"),
		traceIdHex: row.trace_id?.toString("hex") ?? null,
		spanIdHex: row.span_id?.toString("hex") ?? null,
		flags: row.trace_flags,
	} satisfies Snapshot);
}

export async function restoreRun(
	pool: Pool,
	schemaName: string,
	backup: string,
	dispatchId: string,
) {
	const value = JSON.parse(backup) as Snapshot;
	return accept(pool, schemaName, {
		application: value.application,
		tenantId: value.tenantId,
		sourceOperation: value.sourceOperation,
		principalKind: value.principalKind,
		principalId: value.principalId,
		callId: `${value.callId}:restore:${dispatchId}`,
		dispatchSlot: dispatchId,
		dispatchId,
		kind: value.kind,
		resource: value.resource,
		requestDigest: value.requestDigest,
		payloadBytes: Buffer.from(value.payloadHex, "hex"),
		trace:
			value.traceIdHex === null ||
			value.spanIdHex === null ||
			value.flags === null
				? null
				: {
						traceId: Buffer.from(value.traceIdHex, "hex"),
						spanId: Buffer.from(value.spanIdHex, "hex"),
						flags: value.flags,
					},
	});
}
