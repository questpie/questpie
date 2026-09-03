import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
	internalProtocolV7Catalog,
	internalProtocolV7Checksum,
} from "../../../../../packages/compiler/src/schema/postgres/internal-protocol-v7";
import {
	accept,
	acceptThenRollback,
	assertRuntimeProtocol,
	backupRun,
	installProtocolV7,
	internalProtocolV8Catalog,
	internalProtocolV8Checksum,
	pruneAttempts,
	readLiveProtocolCatalog,
	restoreRun,
	startAttempt,
	traceContext,
	upgradeProtocolV8,
} from "./kernel";

const postgresDescribe = process.env.PGHOST ? describe : describe.skip;
const pool = new Pool({
	host: process.env.PGHOST,
	port: Number(process.env.PGPORT ?? "5432"),
	database: process.env.PGDATABASE ?? "postgres",
	user: process.env.PGUSER ?? "postgres",
	max: 4,
});
const schema = `qp_otel_${randomUUID().replaceAll("-", "")}`;
const sha256 = (value: string) =>
	createHash("sha256").update(value).digest("hex");
const context = (seed: number) =>
	traceContext({
		traceId: new Uint8Array(16).fill(seed),
		spanId: new Uint8Array(8).fill(seed + 1),
		flags: seed,
	});
const acceptance = (
	kind: "job" | "reaction",
	identity: string,
	seed: number,
) => {
	const dispatchId = randomUUID();
	return {
		application: "support",
		tenantId: "tenant-1",
		sourceOperation: kind === "job" ? "execution:jobs.accept" : "ticket.close",
		principalKind: "user" as const,
		principalId: "user-1",
		callId: `${kind}-call-${identity}`,
		dispatchSlot: kind === "job" ? dispatchId : `reaction:${identity}`,
		dispatchId,
		kind,
		resource: `${kind}:mail.deliver`,
		requestDigest: sha256(`${kind}:${identity}:request`),
		payloadBytes: Buffer.from(`${kind}:${identity}:payload`),
		trace: context(seed),
	};
};

postgresDescribe("protocol-v8 durable trace-link candidate", () => {
	beforeAll(async () => {
		const version = await pool.query<{ server_version_num: string }>(
			"SHOW server_version_num",
		);
		expect(version.rows[0]?.server_version_num).toMatch(/^17\d{4}$/);
		await installProtocolV7(pool, schema);
	});
	afterAll(async () => {
		await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await pool.end();
	});

	test("pins production v7 and an exact three-column-only v8 catalog delta", () => {
		expect(internalProtocolV7Catalog.tables).toHaveLength(21);
		expect(internalProtocolV7Checksum).toMatch(/^[0-9a-f]{64}$/);
		expect(internalProtocolV8Catalog.tables).toEqual(
			internalProtocolV7Catalog.tables,
		);
		expect(internalProtocolV8Catalog.indexes).toEqual(
			internalProtocolV7Catalog.indexes,
		);
		const addedColumns = internalProtocolV8Catalog.columns.filter(
			(column) =>
				!internalProtocolV7Catalog.columns.some(
					(candidate) => JSON.stringify(candidate) === JSON.stringify(column),
				),
		);
		expect(addedColumns).toEqual([
			["durable_runs", "trace_id", "bytea", false],
			["durable_runs", "span_id", "bytea", false],
			["durable_runs", "trace_flags", "smallint", false],
		]);
		expect(internalProtocolV8Catalog.constraints).toHaveLength(
			internalProtocolV7Catalog.constraints.length + 1,
		);
		expect(internalProtocolV8Checksum).toBe(
			"ca445aa536ec27041cc50ee2aa98daed4518cc86e633f1e04bb62bc180956c79",
		);
		expect(
			internalProtocolV8Catalog.tables.includes(
				"runtime_instances" as (typeof internalProtocolV8Catalog.tables)[number],
			),
		).toBeFalse();
	});

	test("requires explicit non-rolling cutover and exact checksum compatibility", async () => {
		const legacy = acceptance("reaction", "legacy", 1);
		await accept(pool, schema, { ...legacy, trace: null });
		expect(await readLiveProtocolCatalog(pool, schema)).toEqual(
			internalProtocolV7Catalog,
		);
		await assertRuntimeProtocol(pool, schema, 7);
		await expect(assertRuntimeProtocol(pool, schema, 8)).rejects.toThrow(
			"protocol v8 Runtime refused",
		);
		await expect(upgradeProtocolV8(pool, schema, false)).rejects.toThrow(
			"explicit non-rolling",
		);
		await upgradeProtocolV8(pool, schema, true);
		await expect(assertRuntimeProtocol(pool, schema, 7)).rejects.toThrow(
			"protocol v7 Runtime refused",
		);
		await assertRuntimeProtocol(pool, schema, 8);
		expect(await readLiveProtocolCatalog(pool, schema)).toEqual(
			internalProtocolV8Catalog,
		);
		expect(
			JSON.parse(await backupRun(pool, schema, legacy.dispatchId)),
		).toMatchObject({ traceIdHex: null, spanIdHex: null, flags: null });
		const invented = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM information_schema.tables
			 WHERE table_schema = $1 AND table_name = 'runtime_instances'`,
			[schema],
		);
		expect(invented.rows[0]?.count).toBe("0");
	});

	test("Job and Reaction first-run acceptance retain first context", async () => {
		for (const [kind, seed] of [
			["job", 3],
			["reaction", 5],
		] as const) {
			const input = acceptance(kind, "first", seed);
			const accepted = await accept(pool, schema, input);
			const replay = await accept(pool, schema, {
				...input,
				trace: context(seed + 10),
			});
			expect(replay).toEqual(accepted);
			expect(replay.trace).toEqual(input.trace);
			const row = await pool.query<{
				resource_kind: string;
				record_id: string;
				dispatch_id: string;
				state: string;
			}>(
				`SELECT d.resource_kind, d.record_id, r.dispatch_id, d.state
				 FROM "${schema}".durable_dispatches d
				 JOIN "${schema}".durable_runs r
				   ON r.application_name = d.application_name AND r.dispatch_id = d.record_id
				 WHERE d.record_id = $1 AND r.run_id = $2`,
				[input.dispatchId, accepted.runId],
			);
			expect(row.rows[0]).toEqual({
				resource_kind: kind,
				record_id: input.dispatchId,
				dispatch_id: input.dispatchId,
				state: "accepted",
			});
		}
	});

	test("conflict and rollback cannot replace first context", async () => {
		const input = acceptance("job", "conflict", 7);
		const accepted = await accept(pool, schema, input);
		await expect(
			accept(pool, schema, {
				...input,
				requestDigest: sha256("different request"),
			}),
		).rejects.toThrow("acceptance request conflict");
		expect((await accept(pool, schema, input)).trace).toEqual(accepted.trace);
		const rolledBack = acceptance("reaction", "rollback", 9);
		await acceptThenRollback(pool, schema, rolledBack);
		const stored = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM "${schema}".durable_runs WHERE dispatch_id = $1`,
			[rolledBack.dispatchId],
		);
		expect(stored.rows[0]?.count).toBe("0");
	});

	test("hostile widths fail before or at storage", async () => {
		expect(() =>
			traceContext({
				traceId: new Uint8Array(15),
				spanId: new Uint8Array(8).fill(1),
				flags: 1,
			}),
		).toThrow("trace ID");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16),
				spanId: new Uint8Array(8).fill(1),
				flags: 1,
			}),
		).toThrow("trace ID must not be all zero");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16).fill(1),
				spanId: new Uint8Array(8),
				flags: 1,
			}),
		).toThrow("span ID must not be all zero");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16).fill(1),
				spanId: new Uint8Array(8).fill(2),
				flags: 256,
			}),
		).toThrow("trace flags");
		const input = acceptance("job", "database-hostile", 11);
		const accepted = await accept(pool, schema, input);
		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			await client.query(
				"SELECT set_config('questpie.durable_kernel', 'on', true)",
			);
			await expect(
				client.query(
					`UPDATE "${schema}".durable_runs
				 SET trace_id = $2, span_id = $3, trace_flags = 1 WHERE run_id = $1`,
					[accepted.runId, Buffer.alloc(16), Buffer.alloc(8, 1)],
				),
			).rejects.toMatchObject({ code: "23514" });
		} finally {
			await client.query("ROLLBACK").catch(() => undefined);
			client.release();
		}
	});

	test("retry and reclaim use ephemeral roots over production Attempt rows", async () => {
		const input = acceptance("reaction", "siblings", 13);
		const accepted = await accept(pool, schema, input);
		const attempts = [
			await startAttempt(pool, schema, accepted.runId, "worker-a"),
			await startAttempt(pool, schema, accepted.runId, "worker-b"),
			await startAttempt(pool, schema, accepted.runId, "worker-c"),
		];
		expect(attempts.map(({ attemptNumber }) => attemptNumber)).toEqual([
			1, 2, 3,
		]);
		expect(new Set(attempts.map(({ attemptId }) => attemptId)).size).toBe(3);
		expect(
			new Set(
				attempts.map(({ root }) => Buffer.from(root.traceId).toString("hex")),
			).size,
		).toBe(3);
		for (const attempt of attempts)
			expect(attempt.link).toEqual(accepted.trace);
		const actual = await pool.query<{ column_name: string }>(
			`SELECT column_name FROM information_schema.columns
			 WHERE table_schema = $1 AND table_name = 'durable_attempts'
			 ORDER BY ordinal_position`,
			[schema],
		);
		const expected = internalProtocolV7Catalog.columns
			.filter(([table]) => table === "durable_attempts")
			.map(([, name]) => name);
		expect(actual.rows.map(({ column_name }) => column_name)).toEqual(expected);
		expect(JSON.stringify(actual.rows)).not.toMatch(/trace|span|tracestate/);
	});

	test("backup, restore, and Attempt pruning preserve Run trace bytes", async () => {
		const input = acceptance("job", "backup", 15);
		const accepted = await accept(pool, schema, input);
		await startAttempt(pool, schema, accepted.runId, "worker-a");
		const before = await backupRun(pool, schema, accepted.runId);
		await pruneAttempts(pool, schema, accepted.runId);
		expect(await backupRun(pool, schema, accepted.runId)).toBe(before);
		const restored = await restoreRun(pool, schema, before, randomUUID());
		expect(restored.trace).toEqual(accepted.trace);
		const original = JSON.parse(before) as Record<string, unknown>;
		const copy = JSON.parse(
			await backupRun(pool, schema, restored.runId),
		) as Record<string, unknown>;
		expect(copy.traceIdHex).toBe(original.traceIdHex);
		expect(copy.spanIdHex).toBe(original.spanIdHex);
		expect(copy.flags).toBe(original.flags);
	});
});
