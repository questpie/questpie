import { randomBytes, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

export type ResourceKind = "job" | "reaction";
export type TraceContext = Readonly<{
	traceId: Uint8Array;
	spanId: Uint8Array;
	flags: number;
}>;

export type AcceptedRun = Readonly<{
	runId: string;
	trace: TraceContext | null;
}>;

export type Attempt = Readonly<{
	attemptId: string;
	attemptNumber: number;
	root: TraceContext;
	link: TraceContext | null;
}>;

type Queryable = Pick<Pool, "query"> | Pick<PoolClient, "query">;

function identifier(value: string): string {
	if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new TypeError("unsafe schema");
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
		await client.query("ROLLBACK").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

export async function installProtocolV7(pool: Pool, schemaName: string) {
	const schema = identifier(schemaName);
	await pool.query(`CREATE SCHEMA ${schema};
		CREATE TABLE ${schema}.protocol (singleton boolean PRIMARY KEY DEFAULT true, version integer NOT NULL);
		INSERT INTO ${schema}.protocol (version) VALUES (7);
		CREATE TABLE ${schema}.runtime_instances (
			instance_id uuid PRIMARY KEY,
			protocol_version integer NOT NULL
		);
		CREATE TABLE ${schema}.durable_runs (
			run_id uuid PRIMARY KEY,
			resource_kind text NOT NULL CHECK (resource_kind IN ('job', 'reaction')),
			resource_name text NOT NULL,
			idempotency_key text NOT NULL,
			payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
			UNIQUE (resource_kind, resource_name, idempotency_key)
		);`);
}

export async function registerRuntime(
	pool: Pool,
	schemaName: string,
	instanceId: string,
	version: 7 | 8,
) {
	const schema = identifier(schemaName);
	await transaction(pool, async (client) => {
		const current = await client.query<{ version: number }>(
			`SELECT version FROM ${schema}.protocol WHERE singleton FOR UPDATE`,
		);
		if (current.rows[0]?.version !== version)
			throw new TypeError(`protocol v${version} Runtime refused by database`);
		await client.query(
			`INSERT INTO ${schema}.runtime_instances (instance_id, protocol_version) VALUES ($1, $2)`,
			[instanceId, version],
		);
	});
}

export async function unregisterRuntime(
	pool: Pool,
	schemaName: string,
	instanceId: string,
) {
	await pool.query(
		`DELETE FROM ${identifier(schemaName)}.runtime_instances WHERE instance_id = $1`,
		[instanceId],
	);
}

export async function upgradeProtocolV8(
	pool: Pool,
	schemaName: string,
	allowNonRolling: boolean,
) {
	const schema = identifier(schemaName);
	await transaction(pool, async (client) => {
		const current = await client.query<{ version: number }>(
			`SELECT version FROM ${schema}.protocol WHERE singleton FOR UPDATE`,
		);
		if (current.rows[0]?.version !== 7)
			throw new TypeError("protocol v8 upgrade requires protocol v7");
		if (!allowNonRolling)
			throw new TypeError("protocol v8 requires explicit non-rolling cutover");
		const active = await client.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM ${schema}.runtime_instances`,
		);
		if (active.rows[0]?.count !== "0")
			throw new TypeError("protocol v8 cutover requires zero active runtimes");
		await client.query(`ALTER TABLE ${schema}.durable_runs
			ADD COLUMN trace_id bytea NULL,
			ADD COLUMN span_id bytea NULL,
			ADD COLUMN trace_flags smallint NULL,
			ADD CONSTRAINT trace_context_complete CHECK (
				(trace_id IS NULL AND span_id IS NULL AND trace_flags IS NULL) OR
				(octet_length(trace_id) = 16 AND trace_id <> decode(repeat('00', 16), 'hex') AND
				 octet_length(span_id) = 8 AND span_id <> decode(repeat('00', 8), 'hex') AND
				 trace_flags BETWEEN 0 AND 255)
			);
			CREATE TABLE ${schema}.durable_attempts (
				attempt_id uuid PRIMARY KEY,
				run_id uuid NOT NULL REFERENCES ${schema}.durable_runs(run_id) ON DELETE CASCADE,
				attempt_number integer NOT NULL,
				root_trace_id bytea NOT NULL CHECK (octet_length(root_trace_id) = 16 AND root_trace_id <> decode(repeat('00', 16), 'hex')),
				root_span_id bytea NOT NULL CHECK (octet_length(root_span_id) = 8 AND root_span_id <> decode(repeat('00', 8), 'hex')),
				root_flags smallint NOT NULL CHECK (root_flags BETWEEN 0 AND 255),
				link_trace_id bytea NULL,
				link_span_id bytea NULL,
				link_flags smallint NULL,
				CONSTRAINT attempt_link_complete CHECK (
					(link_trace_id IS NULL AND link_span_id IS NULL AND link_flags IS NULL) OR
					(octet_length(link_trace_id) = 16 AND link_trace_id <> decode(repeat('00', 16), 'hex') AND
					 octet_length(link_span_id) = 8 AND link_span_id <> decode(repeat('00', 8), 'hex') AND
					 link_flags BETWEEN 0 AND 255)
				),
				UNIQUE (run_id, attempt_number)
			);
			UPDATE ${schema}.protocol SET version = 8 WHERE singleton;`);
	});
}

async function selectRun(queryable: Queryable, schema: string, runId: string) {
	const selected = await queryable.query<{
		run_id: string;
		payload_digest: Buffer;
		trace_id: Buffer | null;
		span_id: Buffer | null;
		trace_flags: number | null;
	}>(
		`SELECT run_id, payload_digest, trace_id, span_id, trace_flags FROM ${schema}.durable_runs WHERE run_id = $1`,
		[runId],
	);
	const row = selected.rows[0];
	if (!row) throw new TypeError("durable run is absent");
	return row;
}

export async function accept(
	pool: Pool,
	schemaName: string,
	input: Readonly<{
		kind: ResourceKind;
		resource: string;
		idempotencyKey: string;
		payloadDigest: Uint8Array;
		trace: TraceContext | null;
	}>,
): Promise<AcceptedRun> {
	const schema = identifier(schemaName);
	const payload = bytes(input.payloadDigest, 32, "payload digest");
	const trace = input.trace === null ? null : traceContext(input.trace);
	return transaction(pool, async (client) => {
		const inserted = await client.query<{ run_id: string }>(
			`INSERT INTO ${schema}.durable_runs
				(run_id, resource_kind, resource_name, idempotency_key, payload_digest, trace_id, span_id, trace_flags)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 ON CONFLICT (resource_kind, resource_name, idempotency_key) DO NOTHING
			 RETURNING run_id`,
			[
				randomUUID(),
				input.kind,
				input.resource,
				input.idempotencyKey,
				payload,
				trace?.traceId ?? null,
				trace?.spanId ?? null,
				trace?.flags ?? null,
			],
		);
		let runId = inserted.rows[0]?.run_id;
		if (!runId) {
			const replay = await client.query<{ run_id: string }>(
				`SELECT run_id FROM ${schema}.durable_runs
				 WHERE resource_kind = $1 AND resource_name = $2 AND idempotency_key = $3
				 FOR UPDATE`,
				[input.kind, input.resource, input.idempotencyKey],
			);
			runId = replay.rows[0]?.run_id;
		}
		if (!runId) throw new TypeError("acceptance replay is absent");
		const row = await selectRun(client, schema, runId);
		if (!row.payload_digest.equals(payload))
			throw new TypeError("idempotency payload conflict");
		return Object.freeze({ runId, trace: decodedTrace(row) });
	});
}

export async function acceptThenRollback(
	pool: Pool,
	schemaName: string,
	input: Parameters<typeof accept>[2],
) {
	const client = await pool.connect();
	const schema = identifier(schemaName);
	try {
		await client.query("BEGIN");
		const trace = input.trace === null ? null : traceContext(input.trace);
		await client.query(
			`INSERT INTO ${schema}.durable_runs
			 (run_id, resource_kind, resource_name, idempotency_key, payload_digest, trace_id, span_id, trace_flags)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
			[
				randomUUID(),
				input.kind,
				input.resource,
				input.idempotencyKey,
				bytes(input.payloadDigest, 32, "payload digest"),
				trace?.traceId ?? null,
				trace?.spanId ?? null,
				trace?.flags ?? null,
			],
		);
		await client.query("ROLLBACK");
	} finally {
		client.release();
	}
}

export async function startAttempt(
	pool: Pool,
	schemaName: string,
	runId: string,
): Promise<Attempt> {
	const schema = identifier(schemaName);
	return transaction(pool, async (client) => {
		const row = await selectRun(client, schema, runId);
		const link = decodedTrace(row);
		const root = generatedTrace();
		const number = await client.query<{ next: number }>(
			`SELECT (count(*) + 1)::int AS next FROM ${schema}.durable_attempts WHERE run_id = $1`,
			[runId],
		);
		const attemptNumber = number.rows[0]?.next ?? 1;
		const attemptId = randomUUID();
		await client.query(
			`INSERT INTO ${schema}.durable_attempts
			 (attempt_id, run_id, attempt_number, root_trace_id, root_span_id, root_flags, link_trace_id, link_span_id, link_flags)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			[
				attemptId,
				runId,
				attemptNumber,
				root.traceId,
				root.spanId,
				root.flags,
				link?.traceId ?? null,
				link?.spanId ?? null,
				link?.flags ?? null,
			],
		);
		return Object.freeze({ attemptId, attemptNumber, root, link });
	});
}

export async function pruneAttempts(
	pool: Pool,
	schemaName: string,
	runId: string,
) {
	await pool.query(
		`DELETE FROM ${identifier(schemaName)}.durable_attempts WHERE run_id = $1`,
		[runId],
	);
}

type Snapshot = Readonly<{
	resourceKind: ResourceKind;
	resource: string;
	idempotencyKey: string;
	payloadDigestHex: string;
	traceIdHex: string | null;
	spanIdHex: string | null;
	flags: number | null;
}>;

export async function backupRun(
	pool: Pool,
	schemaName: string,
	runId: string,
): Promise<string> {
	const result = await pool.query<{
		resource_kind: ResourceKind;
		resource_name: string;
		idempotency_key: string;
		payload_digest: Buffer;
		trace_id: Buffer | null;
		span_id: Buffer | null;
		trace_flags: number | null;
	}>(
		`SELECT resource_kind, resource_name, idempotency_key, payload_digest, trace_id, span_id, trace_flags
		 FROM ${identifier(schemaName)}.durable_runs WHERE run_id = $1`,
		[runId],
	);
	const row = result.rows[0];
	if (!row) throw new TypeError("durable run is absent");
	return JSON.stringify({
		resourceKind: row.resource_kind,
		resource: row.resource_name,
		idempotencyKey: row.idempotency_key,
		payloadDigestHex: row.payload_digest.toString("hex"),
		traceIdHex: row.trace_id?.toString("hex") ?? null,
		spanIdHex: row.span_id?.toString("hex") ?? null,
		flags: row.trace_flags,
	} satisfies Snapshot);
}

export async function restoreRun(
	pool: Pool,
	schemaName: string,
	backup: string,
	suffix: string,
) {
	const value = JSON.parse(backup) as Snapshot;
	return accept(pool, schemaName, {
		kind: value.resourceKind,
		resource: value.resource,
		idempotencyKey: `${value.idempotencyKey}:${suffix}`,
		payloadDigest: Buffer.from(value.payloadDigestHex, "hex"),
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
