import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import {
	generateDrizzleJson,
	generateMigration,
} from "drizzle-kit/api-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import type { QueueAdapter } from "../../src/server/modules/core/integrated/queue/adapter.js";
import {
	pruneQueueDispatches,
	reconcileQueueDispatchExecutions,
} from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";

// Real node-postgres plans for the statements the store itself issues: the
// statement log supplies the text and parameters, and no planner option is set.
const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

const RECEIPT_ROWS = 20_000;
const EXPIRED_RECEIPT_ROWS = 40;
const RECONCILE_ROWS = 5;
const PRUNE_BATCH = 10;

type Statement = { text: string; params: unknown[] };
type PlanNode = Record<string, any>;

const planNodes = (node: PlanNode): PlanNode[] => [
	node,
	...((node.Plans ?? []) as PlanNode[]).flatMap(planNodes),
];

const brokerStub = {
	capabilities: { executionTerminalState: true },
	inspectExecutionState: async () => "active",
} as unknown as QueueAdapter;

describe.skipIf(!runPostgresContract)(
	"queue dispatch plans on PostgreSQL",
	() => {
		const schema = `qd_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
		const statements: Statement[] = [];
		let client: pg.Client;
		let db: any;

		const explain = async (statement: Statement): Promise<PlanNode> => {
			const result = await client.query(
				`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`,
				statement.params,
			);
			return result.rows[0]["QUERY PLAN"][0].Plan;
		};

		beforeAll(async () => {
			client = new pg.Client({ connectionString: databaseUrl });
			await client.connect();
			await client.query(`CREATE SCHEMA "${schema}"`);
			await client.query(`SET search_path TO "${schema}"`);

			// The DDL a consumer's generated migration contains, indexes included.
			const empty = {
				id: "00000000-0000-0000-0000-000000000000",
				dialect: "postgres" as const,
				prevIds: [],
				version: "8" as const,
				ddl: [],
				renames: [],
			};
			const current = await generateDrizzleJson(
				{ questpie_queue_dispatch: questpieQueueDispatchTable },
				"00000000-0000-0000-0000-000000000001",
			);
			for (const ddl of await generateMigration(empty, current)) {
				if (ddl.trim()) await client.query(ddl);
			}

			// Mostly young non-secret receipts, as in a long-lived installation.
			await client.query(
				`INSERT INTO "questpie_queue_dispatch"
					("dispatch_id", "job_name", "idempotency_key", "status", "adapter_job_id", "accepted_at", "created_at")
				SELECT md5('receipt:' || n)::uuid, 'receipt', 'receipt:' || n, 'accepted', 'broker-' || n,
					now() - (n % 5000) * interval '1 minute',
					now() - (n % 5000) * interval '1 minute'
				FROM generate_series(1, ${RECEIPT_ROWS}) AS n`,
			);
			await client.query(
				`INSERT INTO "questpie_queue_dispatch"
					("dispatch_id", "job_name", "idempotency_key", "status", "adapter_job_id", "accepted_at", "created_at")
				SELECT md5('expired:' || n)::uuid, 'receipt', 'expired:' || n, 'accepted', 'broker-expired-' || n,
					now() - interval '8 days' - n * interval '1 minute',
					now() - interval '8 days' - n * interval '1 minute'
				FROM generate_series(1, ${EXPIRED_RECEIPT_ROWS}) AS n`,
			);
			await client.query(
				`INSERT INTO "questpie_queue_dispatch"
					("dispatch_id", "job_name", "idempotency_key", "status", "secret_payload", "adapter_job_id", "accepted_at", "created_at")
				SELECT md5('secret:' || n)::uuid, 'secret', 'secret:' || n, 'accepted', true, 'broker-secret-' || n,
					now() - n * interval '13 hours',
					now() - n * interval '13 hours'
				FROM generate_series(1, ${RECONCILE_ROWS}) AS n`,
			);
			await client.query(`ANALYZE "questpie_queue_dispatch"`);

			db = drizzle({
				client,
				logger: {
					logQuery: (text: string, params: unknown[]) =>
						statements.push({ text, params }),
				},
			});
		});

		afterAll(async () => {
			await client.query(`DROP SCHEMA "${schema}" CASCADE`);
			await client.end();
		});

		beforeEach(() => {
			statements.length = 0;
		});

		it("holds enough rows that a sequential scan is the expensive plan", async () => {
			const result = await client.query(
				`SELECT relpages FROM pg_class WHERE oid = 'questpie_queue_dispatch'::regclass`,
			);
			expect(Number(result.rows[0].relpages)).toBeGreaterThan(100);
		});

		it("serves both reconcile selects from the reconcile index", async () => {
			await expect(
				reconcileQueueDispatchExecutions({ adapter: brokerStub, db }),
			).resolves.toEqual({ inspected: RECONCILE_ROWS, terminal: 0 });
			const selects = statements.filter((statement) =>
				/^select/i.test(statement.text),
			);
			expect(selects).toHaveLength(2);

			for (const select of selects) {
				const plan = await explain(select);
				const nodes = planNodes(plan);
				expect(nodes.map((node) => node["Node Type"])).not.toContain(
					"Seq Scan",
				);
				const scan = nodes.find(
					(node) => node["Index Name"] === "idx_queue_dispatch_reconcile",
				);
				expect(scan).toBeDefined();
				// The paged select carries keyset OR ranges, which PostgreSQL may
				// serve as a bitmap scan of the same index.
				expect(scan!["Node Type"]).toMatch(/Index (Only )?Scan$/);
				expect(scan!["Actual Rows"]).toBeLessThanOrEqual(RECONCILE_ROWS);
				expect(scan!["Rows Removed by Filter"] ?? 0).toBe(0);
				expect(
					plan["Shared Hit Blocks"] + plan["Shared Read Blocks"],
				).toBeLessThanOrEqual(16);
			}
		});

		it("serves a prune batch from the prune index and the primary key", async () => {
			await expect(
				pruneQueueDispatches(db, { batchSize: PRUNE_BATCH, maxBatches: 1 }),
			).resolves.toEqual({ deleted: PRUNE_BATCH, batches: 1 });
			expect(statements).toHaveLength(1);

			// EXPLAIN ANALYZE executes the statement: it deletes the next batch.
			const nodes = planNodes(await explain(statements[0]!));
			expect(nodes.map((node) => node["Node Type"])).not.toContain("Seq Scan");
			const batch = nodes.find(
				(node) => node["Index Name"] === "idx_queue_dispatch_prune",
			);
			expect(batch).toBeDefined();
			expect(batch!["Node Type"]).toBe("Index Scan");
			expect(batch!["Actual Rows"]).toBeLessThanOrEqual(PRUNE_BATCH);
			expect(batch!["Rows Removed by Filter"] ?? 0).toBe(0);
			expect(
				nodes.some(
					(node) => node["Index Name"] === "questpie_queue_dispatch_pkey",
				),
			).toBe(true);

			const remaining = await client.query(
				`SELECT count(*)::int AS count FROM "questpie_queue_dispatch" WHERE "idempotency_key" LIKE 'expired:%'`,
			);
			expect(remaining.rows[0].count).toBe(
				EXPIRED_RECEIPT_ROWS - 2 * PRUNE_BATCH,
			);
		});
	},
);
