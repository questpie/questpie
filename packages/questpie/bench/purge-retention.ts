import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
	and,
	asc,
	desc,
	eq,
	gt,
	lt,
	lte,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import { Pool } from "pg";

import { collection } from "../src/exports/index.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import { createTestContext } from "../test/utils/test-context.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

type Cursor = {
	deletedAt: Date;
	id: string;
};

type DatabaseStats = {
	blksHit: bigint;
	blksRead: bigint;
	deadlocks: bigint;
	tempBytes: bigint;
	waitingConnections: number;
	activeConnections: number;
	walLsn: string | null;
	xactCommit: bigint;
	xactRollback: bigint;
};

type RunResult = {
	conflict: number;
	durationMs: number;
	failed: number;
	latenciesMs: number[];
	notFound: number;
	peakRssBytes: number;
	purged: number;
};

const CONFIRMATION = "I_UNDERSTAND";
const DEFAULT_ROWS = 1_000;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 32;

const rows = collection("purge_bench_rows")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({ softDelete: true })
	.access({ purge: true });

function positiveInteger(
	name: string,
	value: string | undefined,
	fallback: number,
): number {
	const parsed = value === undefined ? fallback : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return parsed;
}

function percentile(samples: number[], quantile: number): number {
	if (samples.length === 0) return 0;
	const sorted = [...samples].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.max(0, Math.ceil(quantile * sorted.length) - 1),
	);
	return sorted[index]!;
}

function rounded(value: number, digits = 2): number {
	return Number(value.toFixed(digits));
}

function bigintValue(value: unknown): bigint {
	return BigInt(String(value ?? 0));
}

function bigintDelta(after: bigint, before: bigint): string {
	return (after - before).toString();
}

function errorCode(error: unknown): string | undefined {
	if (!error || typeof error !== "object" || !("code" in error)) {
		return undefined;
	}
	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

async function assertDisposableDatabase(pool: Pool): Promise<void> {
	if (process.env.PURGE_BENCH_CONFIRM_DISPOSABLE !== CONFIRMATION) {
		throw new Error(
			`Set PURGE_BENCH_CONFIRM_DISPOSABLE=${CONFIRMATION} to acknowledge that the target is an empty disposable benchmark database`,
		);
	}

	const info = await pool.query<{
		database_name: string;
		pg_trgm_installed: boolean;
		server_version_num: string;
		user_table_count: string;
	}>(`
		SELECT
			current_database() AS database_name,
			current_setting('server_version_num') AS server_version_num,
			EXISTS (
				SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm'
			) AS pg_trgm_installed,
			(
				SELECT count(*)::text
				FROM pg_catalog.pg_class c
				JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
				WHERE c.relkind IN ('r', 'p')
					AND n.nspname NOT IN ('pg_catalog', 'information_schema')
					AND n.nspname !~ '^pg_toast'
			) AS user_table_count
	`);
	const row = info.rows[0];
	if (!row) throw new Error("Unable to inspect the benchmark database");
	if (Number(row.server_version_num) < 150_000) {
		throw new Error(
			`QUESTPIE requires PostgreSQL 15+; benchmark target ${row.database_name} reports ${row.server_version_num}`,
		);
	}
	if (Number(row.user_table_count) !== 0) {
		throw new Error(
			`Refusing to benchmark database ${row.database_name}: expected zero user tables, found ${row.user_table_count}`,
		);
	}
	if (!row.pg_trgm_installed) {
		throw new Error(
			`Benchmark database ${row.database_name} must have pg_trgm provisioned out-of-band before QUESTPIE migrations run`,
		);
	}

	console.log(
		`Verified empty disposable PostgreSQL database ${row.database_name} (${row.server_version_num})`,
	);
}

async function readDatabaseStats(pool: Pool): Promise<DatabaseStats> {
	const result = await pool.query<{
		active_connections: string;
		blks_hit: string;
		blks_read: string;
		deadlocks: string;
		temp_bytes: string;
		waiting_connections: string;
		wal_lsn: string | null;
		xact_commit: string;
		xact_rollback: string;
	}>(`
		SELECT
			d.xact_commit::text,
			d.xact_rollback::text,
			d.blks_read::text,
			d.blks_hit::text,
			d.temp_bytes::text,
			d.deadlocks::text,
			pg_current_wal_lsn()::text AS wal_lsn,
			(
				SELECT count(*)::text
				FROM pg_stat_activity
				WHERE datname = current_database() AND state = 'active'
			) AS active_connections,
			(
				SELECT count(*)::text
				FROM pg_stat_activity
				WHERE datname = current_database()
					AND state = 'active'
					AND wait_event IS NOT NULL
			) AS waiting_connections
		FROM pg_stat_database d
		WHERE d.datname = current_database()
	`);
	const row = result.rows[0];
	if (!row) throw new Error("Unable to read PostgreSQL benchmark statistics");
	return {
		xactCommit: bigintValue(row.xact_commit),
		xactRollback: bigintValue(row.xact_rollback),
		blksRead: bigintValue(row.blks_read),
		blksHit: bigintValue(row.blks_hit),
		tempBytes: bigintValue(row.temp_bytes),
		deadlocks: bigintValue(row.deadlocks),
		walLsn: row.wal_lsn,
		activeConnections: Number(row.active_connections),
		waitingConnections: Number(row.waiting_connections),
	};
}

async function walBytes(
	pool: Pool,
	before: string | null,
	after: string | null,
): Promise<string | null> {
	if (!before || !after) return null;
	const result = await pool.query<{ bytes: string }>(
		"SELECT pg_wal_lsn_diff($1::pg_lsn, $2::pg_lsn)::text AS bytes",
		[after, before],
	);
	return result.rows[0]?.bytes ?? null;
}

async function seedDeletedRows(
	app: Awaited<ReturnType<typeof buildMockApp>>["app"],
	rowCount: number,
	cutoff: Date,
): Promise<void> {
	const chunkSize = 1_000;
	for (let offset = 0; offset < rowCount; offset += chunkSize) {
		const size = Math.min(chunkSize, rowCount - offset);
		const values = Array.from({ length: size }, (_, chunkIndex) => {
			const index = offset + chunkIndex;
			return {
				id: randomUUID(),
				title: `Purge benchmark row ${index}`,
				deletedAt: new Date(cutoff.getTime() - (rowCount - index) * 1_000),
			};
		});
		await app.db.insert(rows.table).values(values);
	}
}

async function captureHighWater(
	app: Awaited<ReturnType<typeof buildMockApp>>["app"],
	cutoff: Date,
): Promise<Cursor | null> {
	const [highWater] = await app.db
		.select({ deletedAt: rows.table.deletedAt, id: rows.table.id })
		.from(rows.table)
		.where(lte(rows.table.deletedAt, cutoff))
		.orderBy(desc(rows.table.deletedAt), desc(rows.table.id))
		.limit(1);
	if (!highWater?.deletedAt) return null;
	return { deletedAt: highWater.deletedAt, id: highWater.id };
}

function afterCursor(cursor: Cursor | null): SQL | undefined {
	if (!cursor) return undefined;
	return or(
		gt(rows.table.deletedAt, cursor.deletedAt),
		and(
			eq(rows.table.deletedAt, cursor.deletedAt),
			gt(rows.table.id, cursor.id),
		),
	);
}

function atOrBeforeHighWater(highWater: Cursor): SQL {
	return or(
		lt(rows.table.deletedAt, highWater.deletedAt),
		and(
			eq(rows.table.deletedAt, highWater.deletedAt),
			lte(rows.table.id, highWater.id),
		),
	)!;
}

async function runBoundedPurge(
	app: Awaited<ReturnType<typeof buildMockApp>>["app"],
	input: {
		concurrency: number;
		cutoff: Date;
		highWater: Cursor;
		pageSize: number;
	},
): Promise<RunResult> {
	const context = createTestContext({ accessMode: "system" });
	const latenciesMs: number[] = [];
	let cursor: Cursor | null = null;
	let purged = 0;
	let notFound = 0;
	let conflict = 0;
	let failed = 0;
	let peakRssBytes = process.memoryUsage().rss;
	const startedAt = performance.now();
	const memorySampler = setInterval(() => {
		peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
	}, 25);

	try {
		while (true) {
			const page = await app.db
				.select({ deletedAt: rows.table.deletedAt, id: rows.table.id })
				.from(rows.table)
				.where(
					and(
						lte(rows.table.deletedAt, input.cutoff),
						atOrBeforeHighWater(input.highWater),
						afterCursor(cursor),
					),
				)
				.orderBy(asc(rows.table.deletedAt), asc(rows.table.id))
				.limit(input.pageSize);
			if (page.length === 0) break;

			let nextIndex = 0;
			const workers = Array.from(
				{ length: Math.min(input.concurrency, page.length) },
				async () => {
					while (true) {
						const item = page[nextIndex];
						nextIndex += 1;
						if (!item) return;
						const itemStartedAt = performance.now();
						try {
							await app.collections.purge_bench_rows.purgeById(
								{ id: item.id },
								context,
							);
							purged += 1;
						} catch (error) {
							const code = errorCode(error);
							if (code === "NOT_FOUND") {
								notFound += 1;
							} else if (code === "CONFLICT") {
								conflict += 1;
							} else {
								failed += 1;
								throw error;
							}
						} finally {
							latenciesMs.push(performance.now() - itemStartedAt);
						}
					}
				},
			);
			await Promise.all(workers);

			const last = page.at(-1)!;
			if (!last.deletedAt) {
				throw new Error("Retention query returned an active row");
			}
			// A production worker persists this cursor only after every page item
			// reaches a durable terminal state.
			cursor = { deletedAt: last.deletedAt, id: last.id };
		}
	} finally {
		clearInterval(memorySampler);
	}

	return {
		conflict,
		durationMs: performance.now() - startedAt,
		failed,
		latenciesMs,
		notFound,
		peakRssBytes,
		purged,
	};
}

async function benchmarkCase(
	app: Awaited<ReturnType<typeof buildMockApp>>["app"],
	pool: Pool,
	input: { concurrency: number; pageSize: number; rowCount: number },
): Promise<Record<string, number | string | null>> {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
	await seedDeletedRows(app, input.rowCount, cutoff);
	const highWater = await captureHighWater(app, cutoff);
	if (!highWater) throw new Error("Benchmark seed produced no retention rows");

	const beforeStats = await readDatabaseStats(pool);
	const beforeRss = process.memoryUsage().rss;
	const result = await runBoundedPurge(app, {
		...input,
		cutoff,
		highWater,
	});
	const afterStats = await readDatabaseStats(pool);
	const remaining = await app.db
		.select({ count: sql<number>`count(*)::integer` })
		.from(rows.table);
	if (Number(remaining[0]?.count ?? -1) !== 0) {
		throw new Error("Benchmark completed with retained owner rows");
	}

	return {
		rows: input.rowCount,
		pageSize: input.pageSize,
		concurrency: input.concurrency,
		durationMs: rounded(result.durationMs),
		rowsPerSecond: rounded((result.purged / result.durationMs) * 1_000),
		p50Ms: rounded(percentile(result.latenciesMs, 0.5)),
		p95Ms: rounded(percentile(result.latenciesMs, 0.95)),
		purged: result.purged,
		notFound: result.notFound,
		conflict: result.conflict,
		failed: result.failed,
		peakRssMiB: rounded(result.peakRssBytes / 1024 / 1024),
		rssDeltaMiB: rounded((result.peakRssBytes - beforeRss) / 1024 / 1024),
		walBytes: await walBytes(pool, beforeStats.walLsn, afterStats.walLsn),
		xactCommitDelta: bigintDelta(afterStats.xactCommit, beforeStats.xactCommit),
		xactRollbackDelta: bigintDelta(
			afterStats.xactRollback,
			beforeStats.xactRollback,
		),
		blksReadDelta: bigintDelta(afterStats.blksRead, beforeStats.blksRead),
		blksHitDelta: bigintDelta(afterStats.blksHit, beforeStats.blksHit),
		tempBytesDelta: bigintDelta(afterStats.tempBytes, beforeStats.tempBytes),
		deadlocksDelta: bigintDelta(afterStats.deadlocks, beforeStats.deadlocks),
		activeConnectionsEndpointMax: Math.max(
			beforeStats.activeConnections,
			afterStats.activeConnections,
		),
		waitingConnectionsEndpointMax: Math.max(
			beforeStats.waitingConnections,
			afterStats.waitingConnections,
		),
	};
}

async function main(): Promise<void> {
	const databaseUrl = process.env.PURGE_BENCH_DATABASE_URL;
	if (!databaseUrl) {
		throw new Error(
			"PURGE_BENCH_DATABASE_URL is required; this harness only runs against real disposable PostgreSQL",
		);
	}

	const pool = new Pool({
		connectionString: databaseUrl,
		max: 2,
		application_name: "questpie-purge-benchmark-control",
	});
	await assertDisposableDatabase(pool);

	const concurrency = positiveInteger(
		"PURGE_BENCH_CONCURRENCY",
		process.env.PURGE_BENCH_CONCURRENCY,
		DEFAULT_CONCURRENCY,
	);
	if (concurrency > MAX_CONCURRENCY) {
		throw new Error(
			`PURGE_BENCH_CONCURRENCY must not exceed ${MAX_CONCURRENCY}; increase only after reviewing pool and database headroom`,
		);
	}

	const matrix = process.argv.includes("--matrix")
		? [1_000, 10_000, 100_000].flatMap((rowCount) =>
				[25, 100, 250].map((pageSize) => ({
					concurrency,
					pageSize,
					rowCount,
				})),
			)
		: [
				{
					concurrency,
					pageSize: positiveInteger(
						"PURGE_BENCH_PAGE_SIZE",
						process.env.PURGE_BENCH_PAGE_SIZE,
						DEFAULT_PAGE_SIZE,
					),
					rowCount: positiveInteger(
						"PURGE_BENCH_ROWS",
						process.env.PURGE_BENCH_ROWS,
						DEFAULT_ROWS,
					),
				},
			];

	const setup = await buildMockApp(
		{ collections: { purge_bench_rows: rows } },
		{
			db: {
				url: databaseUrl,
				pool: {
					max: Math.max(4, concurrency + 2),
					connectionTimeoutMs: 10_000,
				},
			},
		},
	);

	try {
		await runTestDbMigrations(setup.app);
		const results: Array<Record<string, number | string | null>> = [];
		for (const benchmark of matrix) {
			console.log(
				`Running ${benchmark.rowCount.toLocaleString()} rows, page ${benchmark.pageSize}, concurrency ${benchmark.concurrency}`,
			);
			results.push(await benchmarkCase(setup.app, pool, benchmark));
		}
		console.table(results);
		console.log(JSON.stringify({ results }, null, 2));
	} finally {
		try {
			await setup.app.migrations.down();
		} finally {
			await setup.cleanup();
			await pool.end();
		}
	}
}

await main();
