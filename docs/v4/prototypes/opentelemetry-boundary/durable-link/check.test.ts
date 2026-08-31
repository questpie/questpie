import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
	accept,
	acceptThenRollback,
	backupRun,
	installProtocolV7,
	pruneAttempts,
	registerRuntime,
	restoreRun,
	startAttempt,
	traceContext,
	unregisterRuntime,
	upgradeProtocolV8,
} from "./kernel";

if (!process.env.PGHOST) throw new Error("PGHOST is required");

const pool = new Pool({
	host: process.env.PGHOST,
	port: Number(process.env.PGPORT ?? "5432"),
	database: process.env.PGDATABASE ?? "postgres",
	user: process.env.PGUSER ?? "postgres",
	max: 4,
});
const schema = `qp_otel_${randomUUID().replaceAll("-", "")}`;
const digest = (value: string) => createHash("sha256").update(value).digest();
const context = (seed: number) =>
	traceContext({
		traceId: new Uint8Array(16).fill(seed),
		spanId: new Uint8Array(8).fill(seed + 1),
		flags: seed,
	});

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

describe("protocol-v8 durable trace-link candidate", () => {
	test("requires an explicit zero-runtime non-rolling v7 to v8 cutover", async () => {
		const legacyRunId = randomUUID();
		await pool.query(
			`INSERT INTO "${schema}".durable_runs
			 (run_id, resource_kind, resource_name, idempotency_key, payload_digest)
			 VALUES ($1, 'reaction', 'reaction:legacy', 'legacy-v7', $2)`,
			[legacyRunId, digest("legacy-v7")],
		);
		const oldRuntime = randomUUID();
		await registerRuntime(pool, schema, oldRuntime, 7);
		await expect(upgradeProtocolV8(pool, schema, false)).rejects.toThrow(
			"explicit non-rolling",
		);
		await expect(upgradeProtocolV8(pool, schema, true)).rejects.toThrow(
			"zero active runtimes",
		);
		await unregisterRuntime(pool, schema, oldRuntime);
		await upgradeProtocolV8(pool, schema, true);
		await expect(
			registerRuntime(pool, schema, randomUUID(), 7),
		).rejects.toThrow("v7 Runtime refused");
		await registerRuntime(pool, schema, randomUUID(), 8);
		await registerRuntime(pool, schema, randomUUID(), 8);
		const legacy = await pool.query<{
			trace_id: Buffer | null;
			span_id: Buffer | null;
			trace_flags: number | null;
		}>(
			`SELECT trace_id, span_id, trace_flags FROM "${schema}".durable_runs WHERE run_id = $1`,
			[legacyRunId],
		);
		expect(legacy.rows[0]).toEqual({
			trace_id: null,
			span_id: null,
			trace_flags: null,
		});
		const instances = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM "${schema}".runtime_instances`,
		);
		expect(instances.rows[0]?.count).toBe("2");
	});

	test("Job and Reaction first acceptance store exact nullable bytes and replay retains first", async () => {
		for (const [kind, seed] of [
			["job", 1],
			["reaction", 3],
		] as const) {
			const firstTrace = context(seed);
			const accepted = await accept(pool, schema, {
				kind,
				resource: `${kind}:mail.deliver`,
				idempotencyKey: `${kind}:same`,
				payloadDigest: digest(`${kind}:payload`),
				trace: firstTrace,
			});
			const replay = await accept(pool, schema, {
				kind,
				resource: `${kind}:mail.deliver`,
				idempotencyKey: `${kind}:same`,
				payloadDigest: digest(`${kind}:payload`),
				trace: context(seed + 10),
			});
			expect(replay.runId).toBe(accepted.runId);
			expect(replay.trace).toEqual(firstTrace);
		}

		const old = await accept(pool, schema, {
			kind: "job",
			resource: "job:old",
			idempotencyKey: "old:null",
			payloadDigest: digest("old"),
			trace: null,
		});
		expect(old.trace).toBeNull();
	});

	test("rollback stores no context and malformed byte widths are rejected", async () => {
		await acceptThenRollback(pool, schema, {
			kind: "job",
			resource: "job:rollback",
			idempotencyKey: "rolled-back",
			payloadDigest: digest("rollback"),
			trace: context(5),
		});
		const stored = await pool.query<{ count: string }>(
			`SELECT count(*)::text AS count FROM "${schema}".durable_runs WHERE idempotency_key = 'rolled-back'`,
		);
		expect(stored.rows[0]?.count).toBe("0");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(15),
				spanId: new Uint8Array(8),
				flags: 0,
			}),
		).toThrow("trace ID");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16),
				spanId: new Uint8Array(8).fill(1),
				flags: 0,
			}),
		).toThrow("trace ID must not be all zero");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16).fill(1),
				spanId: new Uint8Array(8),
				flags: 0,
			}),
		).toThrow("span ID must not be all zero");
		expect(() =>
			traceContext({
				traceId: new Uint8Array(16).fill(1),
				spanId: new Uint8Array(8).fill(1),
				flags: 256,
			}),
		).toThrow("trace flags");

		const insertBypassingRuntime = (
			traceId: Buffer,
			spanId: Buffer,
			key: string,
		) =>
			pool.query(
				`INSERT INTO "${schema}".durable_runs
				 (run_id, resource_kind, resource_name, idempotency_key, payload_digest, trace_id, span_id, trace_flags)
				 VALUES ($1, 'job', 'job:hostile', $2, $3, $4, $5, 1)`,
				[randomUUID(), key, digest(key), traceId, spanId],
			);
		await expect(
			insertBypassingRuntime(
				Buffer.alloc(16),
				Buffer.alloc(8, 1),
				"zero-trace",
			),
		).rejects.toMatchObject({ code: "23514" });
		await expect(
			insertBypassingRuntime(Buffer.alloc(16, 1), Buffer.alloc(8), "zero-span"),
		).rejects.toMatchObject({ code: "23514" });
	});

	test("retry and reclaim are distinct sibling roots linked to first acceptance", async () => {
		const accepted = await accept(pool, schema, {
			kind: "reaction",
			resource: "reaction:index",
			idempotencyKey: "siblings",
			payloadDigest: digest("siblings"),
			trace: context(7),
		});
		const first = await startAttempt(pool, schema, accepted.runId);
		const retry = await startAttempt(pool, schema, accepted.runId);
		const reclaim = await startAttempt(pool, schema, accepted.runId);
		expect([
			first.attemptNumber,
			retry.attemptNumber,
			reclaim.attemptNumber,
		]).toEqual([1, 2, 3]);
		expect(
			new Set([first.attemptId, retry.attemptId, reclaim.attemptId]).size,
		).toBe(3);
		expect(
			new Set([
				first.root.traceId.toString(),
				retry.root.traceId.toString(),
				reclaim.root.traceId.toString(),
			]).size,
		).toBe(3);
		expect(first.link).toEqual(accepted.trace);
		expect(retry.link).toEqual(accepted.trace);
		expect(reclaim.link).toEqual(accepted.trace);
	});

	test("schema cannot persist raw call identity or tracestate", async () => {
		const columns = await pool.query<{ column_name: string }>(
			`SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name IN ('durable_runs', 'durable_attempts') ORDER BY column_name`,
			[schema],
		);
		const names = columns.rows.map(({ column_name }) => column_name);
		expect(names).not.toContain("call_id");
		expect(names).not.toContain("correlation_id");
		expect(names).not.toContain("tracestate");
		expect(JSON.stringify(names)).not.toContain("email@example.test");
	});

	test("backup, restore, and attempt pruning preserve acceptance bytes", async () => {
		const accepted = await accept(pool, schema, {
			kind: "job",
			resource: "job:backup",
			idempotencyKey: "backup",
			payloadDigest: digest("backup"),
			trace: context(9),
		});
		await startAttempt(pool, schema, accepted.runId);
		const before = await backupRun(pool, schema, accepted.runId);
		await pruneAttempts(pool, schema, accepted.runId);
		expect(await backupRun(pool, schema, accepted.runId)).toBe(before);
		const restored = await restoreRun(pool, schema, before, "restored");
		expect(restored.trace).toEqual(accepted.trace);
		const restoredBytes = JSON.parse(
			await backupRun(pool, schema, restored.runId),
		) as {
			traceIdHex: string;
			spanIdHex: string;
			flags: number;
		};
		const originalBytes = JSON.parse(before) as typeof restoredBytes;
		expect(restoredBytes.traceIdHex).toBe(originalBytes.traceIdHex);
		expect(restoredBytes.spanIdHex).toBe(originalBytes.spanIdHex);
		expect(restoredBytes.flags).toBe(originalBytes.flags);
	});
});
