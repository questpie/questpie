import { createHash, randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
	bootstrapChecksum,
	bootstrapSql,
} from "../../../../../packages/compiler/src/schema/postgres/bootstrap";
import {
	internalProtocolV2Checksum,
	internalProtocolV2Sql,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v2";
import {
	internalProtocolV3Checksum,
	internalProtocolV3Sql,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v3";
import {
	internalProtocolV4Checksum,
	internalProtocolV4Sql,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v4";
import {
	internalProtocolV5Checksum,
	internalProtocolV5Sql,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v5";
import {
	internalProtocolV6Checksum,
	internalProtocolV6Sql,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v6";
import {
	internalProtocolV7Catalog,
	internalProtocolV7Checksum,
	internalProtocolV7Sql,
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

function compareCatalogRows(
	left: readonly unknown[],
	right: readonly unknown[],
): number {
	const leftKey = `${String(left[0])}\0${String(left[1])}`;
	const rightKey = `${String(right[0])}\0${String(right[1])}`;
	return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
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
	constraints: Object.freeze(
		[...internalProtocolV7Catalog.constraints, traceConstraint].sort(
			compareCatalogRows,
		),
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
	const upgrades = [
		[2, internalProtocolV2Checksum, internalProtocolV2Sql],
		[3, internalProtocolV3Checksum, internalProtocolV3Sql],
		[4, internalProtocolV4Checksum, internalProtocolV4Sql],
		[5, internalProtocolV5Checksum, internalProtocolV5Sql],
		[6, internalProtocolV6Checksum, internalProtocolV6Sql],
		[7, internalProtocolV7Checksum, internalProtocolV7Sql],
	] as const;
	await transaction(pool, async (client) => {
		await client.query(bootstrapSql.replaceAll("questpie_internal", schema));
		await client.query(
			`INSERT INTO ${schema}.protocol (singleton, version, checksum)
			 VALUES (true, 1, $1)`,
			[bootstrapChecksum],
		);
		for (const [version, checksum, sql] of upgrades) {
			await client.query(sql.replaceAll("questpie_internal", schema));
			await client.query(
				`UPDATE ${schema}.protocol SET version = $1, checksum = $2
				 WHERE singleton = true`,
				[version, checksum],
			);
		}
	});
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

function normalizeCatalogDefinition(value: string, schemaName: string): string {
	return value
		.replaceAll(`"${schemaName}".`, "questpie_internal.")
		.replaceAll(`${schemaName}.`, "questpie_internal.");
}

/** Reads the same fixed PostgreSQL catalog shape as the production verifier. */
export async function readLiveProtocolCatalog(pool: Pool, schemaName: string) {
	const tables = await pool.query<{ name: string }>(
		`SELECT c.relname AS name
		 FROM pg_catalog.pg_class c
		 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = $1 AND c.relkind = 'r'
		 ORDER BY c.relname`,
		[schemaName],
	);
	const columns = await pool.query<{
		table: string;
		name: string;
		type: string;
		notNull: boolean;
	}>(
		`SELECT c.relname AS table, a.attname AS name,
		        pg_catalog.format_type(a.atttypid, a.atttypmod) AS type,
		        a.attnotnull AS "notNull"
		 FROM pg_catalog.pg_attribute a
		 JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
		 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = $1 AND c.relkind = 'r'
		   AND a.attnum > 0 AND NOT a.attisdropped
		 ORDER BY c.relname, a.attnum`,
		[schemaName],
	);
	const constraints = await pool.query<{
		table: string;
		name: string;
		type: string;
		definition: string;
	}>(
		`SELECT c.relname AS table, con.conname AS name,
		        con.contype::text AS type,
		        pg_catalog.pg_get_constraintdef(con.oid, true) AS definition
		 FROM pg_catalog.pg_constraint con
		 JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
		 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		 WHERE n.nspname = $1 AND con.contype <> 'n'
		 ORDER BY c.relname, con.conname`,
		[schemaName],
	);
	const indexes = await pool.query<{
		table: string;
		name: string;
		method: string;
		unique: boolean;
		primary: boolean;
		definition: string;
	}>(
		`SELECT t.relname AS table, i.relname AS name, am.amname AS method,
		        x.indisunique AS unique, x.indisprimary AS primary,
		        pg_catalog.pg_get_indexdef(i.oid) AS definition
		 FROM pg_catalog.pg_index x
		 JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
		 JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
		 JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
		 JOIN pg_catalog.pg_am am ON am.oid = i.relam
		 WHERE n.nspname = $1
		 ORDER BY t.relname, i.relname`,
		[schemaName],
	);
	return Object.freeze({
		tables: Object.freeze(tables.rows.map(({ name }) => name)),
		columns: Object.freeze(
			columns.rows.map((column) =>
				Object.freeze([column.table, column.name, column.type, column.notNull]),
			),
		),
		constraints: Object.freeze(
			constraints.rows.map((constraint) =>
				Object.freeze([
					constraint.table,
					constraint.name,
					constraint.type,
					normalizeCatalogDefinition(constraint.definition, schemaName),
				]),
			),
		),
		indexes: Object.freeze(
			indexes.rows.map((index) =>
				Object.freeze([
					index.table,
					index.name,
					index.method,
					index.unique,
					index.primary,
					normalizeCatalogDefinition(index.definition, schemaName),
				]),
			),
		),
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
	await client.query(
		"SELECT set_config('questpie.durable_kernel', 'on', true)",
	);
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
		await client.query(
			"SELECT set_config('questpie.durable_kernel', 'on', true)",
		);
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
			"SELECT set_config('questpie.durable_kernel', 'on', true)",
		);
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
