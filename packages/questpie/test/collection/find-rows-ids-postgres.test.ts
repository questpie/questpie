import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgDialect } from "drizzle-orm/pg-core";
import pg from "pg";

import {
	collection,
	runWithContext,
	withTransaction,
} from "../../src/exports/index.js";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const evidenceDirectory = process.env.QUESTPIE_FINITE_IDS_EVIDENCE_DIR;
const user = { accessMode: "user", locale: "en", defaultLocale: "en" } as const;
let fieldOutputs = 0,
	collectionOutputs = 0,
	accessCalls = 0;
const records = collection("finite_ids_pg")
	.fields(({ f }) => ({
		company: f.text().required(),
		name: f
			.text()
			.required()
			.hooks({
				afterRead: (value) => {
					fieldOutputs++;
					return value + "~";
				},
			}),
		payload: f.json(),
		instant: f.datetime({ withTimezone: true }),
		secret: f.text(),
		optional: f.text(),
	}))
	.title(({ f }) => f.name)
	.access({
		read: () => {
			accessCalls++;
			return { company: "own" };
		},
		fields: { secret: { read: false } },
	})
	.hooks({
		afterRead: () => {
			collectionOutputs++;
		},
	});
type Captured = {
	sql: string;
	params: unknown[];
	completed: boolean;
	failedCode?: unknown;
};
function physical(plan: unknown, bound: number) {
	let work = 0,
		heapFetches = 0,
		buffers = 0,
		temp = 0;
	const scans: unknown[] = [],
		sorts: unknown[] = [];
	const failures: string[] = [];
	const visit = (item: any) => {
		if (Array.isArray(item)) {
			for (const child of item) visit(child);
			return;
		}
		if (!item || typeof item !== "object") return;
		if (typeof item["Node Type"] === "string") {
			const n = (key: string) => {
				const value = item[key] ?? 0;
				if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
					throw Error("Invalid EXPLAIN number " + key);
				return value;
			};
			temp += n("Temp Read Blocks") + n("Temp Written Blocks");
			if (item["Node Type"].includes("Scan")) {
				const rows =
					(n("Actual Rows") +
						n("Rows Removed by Filter") +
						n("Rows Removed by Index Recheck")) *
					n("Actual Loops");
				const fetched = n("Heap Fetches");
				work += rows + fetched;
				heapFetches += fetched;
				buffers += n("Shared Hit Blocks") + n("Shared Read Blocks");
				scans.push({
					type: item["Node Type"],
					index: item["Index Name"],
					rows,
					heapFetches: fetched,
				});
				if (item["Node Type"] === "Seq Scan") failures.push("sequential scan");
			}
			if (item["Node Type"].includes("Sort")) {
				const child = item.Plans?.[0];
				if (
					!child ||
					typeof child["Actual Rows"] !== "number" ||
					typeof child["Actual Loops"] !== "number"
				)
					throw Error("Missing actual Sort input");
				const rows = child["Actual Rows"] * child["Actual Loops"];
				sorts.push({
					rows,
					method: item["Sort Method"],
					spaceType: item["Sort Space Type"],
					spaceUsed: item["Sort Space Used"],
				});
				if (rows > 4 * bound) failures.push("sort input budget");
				if (
					item["Sort Space Type"] === "Disk" ||
					/external|disk/i.test(String(item["Sort Method"]))
				)
					failures.push("sort spill");
			}
		}
		for (const value of Object.values(item)) visit(value);
	};
	visit(plan);
	if (!scans.length) throw Error("No actual scan receipt");
	if (work > 4 * bound) failures.push("physical work budget");
	if (buffers > 64 + 16 * bound) failures.push("shared buffer budget");
	if (temp) failures.push("temporary IO");
	return {
		work,
		heapFetches,
		buffers,
		temp,
		scans,
		sorts,
		limits: { work: 4 * bound, buffers: 64 + 16 * bound, temp: 0 },
		failures,
		limitation:
			"EXPLAIN scan/filter/recheck/Heap Fetches proxy; invisible dead index entries are not individually exposed",
	};
}

describe.skipIf(!databaseUrl)("finite IDs on owned native PostgreSQL", () => {
	const schema = `qfm31_ids_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
	const receipt: any = {
		scope:
			"owner-row finite acquisition; arbitrary RAW/related/hook work is not bounded by this contract",
		schema,
		plans: [],
		reads: [],
		queryCompletionBasis:
			"owned node-postgres query Promise fulfillment, before CRUD output hooks",
		cohorts: [],
		failures: [],
	};
	let client: pg.Client | undefined,
		outsider: pg.Client | undefined,
		created = false;
	let db: any,
		outsideDb: any,
		crud: any,
		capture = false;
	const captured: Captured[] = [];
	const persist = async () => {
		if (evidenceDirectory) {
			await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
			await writeFile(
				join(evidenceDirectory, "qfm31-finite-ids-postgres.json"),
				JSON.stringify(receipt, null, 2),
				{ mode: 0o600 },
			);
		}
	};
	beforeAll(async () => {
		const url = new URL(databaseUrl!);
		const name = decodeURIComponent(url.pathname.slice(1));
		if (
			!["postgres:", "postgresql:"].includes(url.protocol) ||
			url.search !== "" ||
			url.hash !== "" ||
			!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
			!name ||
			process.env.QUESTPIE_FINITE_IDS_OWNED_DATABASE !== name
		)
			throw Error("Requires root-supplied exact owned loopback database name");
		client = new pg.Client({
			connectionString: databaseUrl,
			connectionTimeoutMillis: 5000,
		});
		outsider = new pg.Client({
			connectionString: databaseUrl,
			connectionTimeoutMillis: 5000,
		});
		await client.connect();
		await outsider.connect();
		await client.query(`CREATE SCHEMA "${schema}"`);
		created = true;
		await client.query(`SET search_path TO "${schema}"`);
		await outsider.query(`SET search_path TO "${schema}"`);
		const dialect = new PgDialect(),
			built = records.build();
		// Registry-derived types/defaults plus REAL PK and NOT NULL. This is a plain
		// fixture with no omitted FK/check/unique constraints; it declares only id PK.
		const columns = Object.values(getTableColumns(built.table)).map(
			(column: any) => {
				let value = `"${column.name}" ${column.getSQLType()}${column.notNull ? " NOT NULL" : ""}${column.primary ? " PRIMARY KEY" : ""}`;
				if (is(column.default, SQL)) {
					const compiled = dialect.sqlToQuery(column.default);
					if (compiled.params.length)
						throw Error("Fixture SQL default must be parameter-free");
					value += ` DEFAULT ${compiled.sql}`;
				}
				return value;
			},
		);
		await client.query(
			`CREATE TABLE "${getTableName(built.table)}" (${columns.join(",")})`,
		);
		receipt.catalog = (
			await client.query(
				`SELECT i.indisprimary,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i WHERE i.indrelid=$1::regclass`,
				[getTableName(built.table)],
			)
		).rows;
		expect(
			receipt.catalog.some(
				(row: any) => row.indisprimary && row.indisvalid && row.indisready,
			),
		).toBe(true);
		receipt.requiredColumns = (
			await client.query(
				`SELECT attname,attnotnull FROM pg_attribute WHERE attrelid=$1::regclass AND attname IN('id','company','name') ORDER BY attname`,
				[getTableName(built.table)],
			)
		).rows;
		expect(receipt.requiredColumns).toHaveLength(3);
		expect(receipt.requiredColumns.every((row: any) => row.attnotnull)).toBe(
			true,
		);
		const ownedQuery = client.query.bind(client);
		client.query = ((...args: any[]) => {
			const config = args[0];
			const statement = typeof config === "string" ? config : config.text;
			const params = Array.isArray(args[1]) ? args[1] : (config.values ?? []);
			const observation: Captured | undefined = capture
				? { sql: statement, params: [...params], completed: false }
				: undefined;
			if (observation) captured.push(observation);
			return Reflect.apply(ownedQuery, undefined, args).then(
				(result: unknown) => {
					if (observation) observation.completed = true;
					return result;
				},
				(error: any) => {
					if (observation) observation.failedCode = error?.code ?? null;
					throw error;
				},
			);
		}) as typeof client.query;
		db = drizzle({ client });
		outsideDb = drizzle({ client: outsider });
		const app: any = { collections: {} };
		crud = built.generateCRUD(db, app);
		app.collections.finite_ids_pg = crud;
		await db.insert(built.table).values(
			Array.from({ length: 100 }, (_, i) => ({
				id: `requested-${i}`,
				company: "own",
				name: `Name${String(99 - i).padStart(3, "0")}`,
				payload: i % 2 ? null : { nested: [i, null] },
				instant: i % 2 ? null : new Date("2026-10-16T10:11:12.123Z"),
				secret: "not returned",
				optional: null,
			})),
		);
		await client.query(
			`INSERT INTO finite_ids_pg(id,company,name) SELECT 'foreign-'||g,'foreign','Foreign'||g FROM generate_series(1,6000) g`,
		);
		receipt.settings = (await client.query("SHOW enable_seqscan")).rows;
		expect(receipt.settings[0].enable_seqscan).toBe("on");
	});
	afterAll(async () => {
		const cleanupErrors: unknown[] = [];
		try {
			if (created && client) {
				await client.query("SET statement_timeout='5s'");
				await client.query(`DROP SCHEMA "${schema}" CASCADE`);
				receipt.schemaRemoved = true;
			}
		} catch (error: any) {
			receipt.schemaRemovalFailure = { code: error?.code ?? null };
			cleanupErrors.push(error);
		} finally {
			const closed = await Promise.allSettled([client?.end(), outsider?.end()]);
			receipt.clientsClosed = closed.map((item) => item.status);
			receipt.clientClosureFailures = closed.map((item) =>
				item.status === "rejected" ? { code: item.reason?.code ?? null } : null,
			);
			for (const item of closed)
				if (item.status === "rejected") cleanupErrors.push(item.reason);
			await persist();
		}
		if (cleanupErrors.length)
			throw new AggregateError(
				cleanupErrors,
				"Owned PostgreSQL cleanup failed",
			);
	});
	it("preserves decoded public CRUD semantics and actual bounded plans before and after Company growth", async () => {
		try {
			for (const stage of ["initial", "own-growth"]) {
				if (stage === "own-growth")
					await client!.query(
						`INSERT INTO finite_ids_pg(id,company,name) SELECT 'own-growth-'||g,'own','Growth'||g FROM generate_series(1,6000) g`,
					);
				await client!.query("ANALYZE finite_ids_pg");
				receipt.cohorts.push({
					stage,
					counts: (
						await client!.query(
							"SELECT company,count(*)::int AS n FROM finite_ids_pg GROUP BY company ORDER BY company",
						)
					).rows,
				});
				expect(receipt.cohorts.at(-1).counts).toEqual([
					{ company: "foreign", n: 6000 },
					{ company: "own", n: stage === "initial" ? 100 : 6100 },
				]);
				for (const count of [0, 1, 10, 65, 100]) {
					const ids = Array.from({ length: count }, (_, i) => `requested-${i}`);
					const options = {
						limit: Math.max(1, count),
						orderBy: { name: "asc" },
						where: { company: "own" },
					};
					const expected = count
						? await crud.findRows(
								{ ...options, where: { ...options.where, id: { in: ids } } },
								user,
							)
						: [];
					captured.length = 0;
					fieldOutputs = 0;
					collectionOutputs = 0;
					capture = true;
					let actual: any[];
					try {
						actual = await crud.findRows({ ...options, ids }, user);
					} finally {
						capture = false;
						receipt.reads.push({
							stage,
							count,
							queries: [...captured],
							fieldOutputs,
							collectionOutputs,
						});
					}
					expect(actual).toEqual(expected);
					expect(actual).toHaveLength(count);
					expect(fieldOutputs).toBe(count);
					expect(collectionOutputs).toBe(count);
					expect(captured).toHaveLength(count ? 1 : 0);
					if (count) {
						expect(captured[0]!.sql).toMatch(/cross join lateral/i);
						expect(captured[0]!.sql).not.toMatch(/\bcount\s*\(/i);
						expect(captured[0]!.sql.match(/limit\s+\$\d+/gi)).toHaveLength(2);
						expect(
							actual.find((row: any) => row.id === "requested-0")?.payload,
						).toEqual({ nested: [0, null] });
						expect(actual.some((row: any) => "secret" in row)).toBe(false);
						for (const row of actual) {
							expect(row.createdAt).toBeInstanceOf(Date);
							if (row.instant !== null)
								expect(row.instant).toBeInstanceOf(Date);
							expect(row.optional).toBe(null);
						}
						for (const query of captured) {
							const result = await client!.query(
								`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.sql}`,
								query.params,
							);
							const plan = result.rows[0]["QUERY PLAN"];
							const observation: any = { stage, count, query, plan };
							receipt.plans.push(observation);
							const analysis = physical(plan, count);
							observation.analysis = analysis;
							for (const failure of analysis.failures)
								receipt.failures.push(`${stage}/${count}: ${failure}`);
						}
					}
				}
			}
			const beforeAccess = accessCalls;
			capture = true;
			captured.length = 0;
			try {
				await expect(
					crud.findRows(
						{
							ids: Array.from({ length: 101 }, (_, i) => String(i)),
							limit: 100,
						},
						user,
					),
				).rejects.toThrow();
			} finally {
				capture = false;
			}
			expect(accessCalls).toBe(beforeAccess);
			expect(captured).toHaveLength(0);
			expect(
				(
					await crud.findRows(
						{ ids: ["foreign-1", "requested-99"], limit: 1 },
						user,
					)
				).map((row: any) => row.id),
			).toEqual(["requested-99"]);
			await withTransaction(db, async (tx: any) => {
				await tx
					.insert(records.build().table)
					.values({ id: "uncommitted", company: "own", name: "Uncommitted" });
				const explicit = await runWithContext({ db: outsideDb }, () =>
					crud.findRows(
						{ ids: ["uncommitted"], limit: 1 },
						{ ...user, db: tx },
					),
				);
				expect(explicit.map((row: any) => row.id)).toEqual(["uncommitted"]);
				expect(
					await crud.findRows(
						{ ids: ["uncommitted"], limit: 1 },
						{ ...user, db: outsideDb },
					),
				).toEqual([]);
				const ambient = await runWithContext({ db: tx }, () =>
					crud.findRows({ ids: ["uncommitted"], limit: 1 }, user),
				);
				expect(ambient).toEqual(explicit);
			});
			const negativeSql = "SELECT * FROM finite_ids_pg WHERE lower(id)=$1",
				params = [crypto.randomUUID()];
			const negative = (
				await client!.query(
					`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${negativeSql}`,
					params,
				)
			).rows[0]["QUERY PLAN"];
			receipt.negative = {
				sql: negativeSql,
				params,
				plan: negative,
			};
			const negativeAnalysis = physical(negative, 1);
			receipt.negative.analysis = negativeAnalysis;
			expect(
				negativeAnalysis.failures.some((failure) =>
					[
						"sequential scan",
						"physical work budget",
						"shared buffer budget",
					].includes(failure),
				),
			).toBe(true);
			receipt.completed = true;
			receipt.passed = receipt.failures.length === 0;
		} catch (error) {
			receipt.failure = {
				code:
					typeof error === "object" && error !== null && "code" in error
						? error.code
						: null,
			};
			throw error;
		} finally {
			await persist();
		}
		// Raw SQL/parameters/plans remain available before acquisition rejection.
		expect(receipt.failures).toEqual([]);
	}, 120_000);
});
