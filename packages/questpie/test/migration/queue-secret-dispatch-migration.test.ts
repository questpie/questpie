import { describe, expect, test } from "bun:test";

import {
	generateDrizzleJson,
	generateMigration,
} from "drizzle-kit/api-postgres";
import { sql } from "drizzle-orm";
import {
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import pg from "pg";

import { systemTimestamp } from "../../src/server/db/system-columns.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";

const legacyQueueDispatchTable = pgTable(
	"questpie_queue_dispatch",
	{
		dispatchId: uuid("dispatch_id").primaryKey(),
		jobName: text("job_name").notNull(),
		idempotencyKey: text("idempotency_key"),
		payload: jsonb("payload"),
		options: jsonb("options"),
		status: text("status").default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		availableAt: timestamp("available_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		leaseToken: uuid("lease_token"),
		leasedUntil: timestamp("leased_until", {
			withTimezone: true,
			mode: "date",
		}),
		adapterJobId: text("adapter_job_id"),
		lastError: text("last_error"),
		acceptedAt: timestamp("accepted_at", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
		updatedAt: systemTimestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [
		uniqueIndex("uq_queue_dispatch_idempotency").on(
			table.jobName,
			table.idempotencyKey,
		),
		index("idx_queue_dispatch_ready").on(
			table.status,
			table.availableAt,
			table.leasedUntil,
		),
	],
);

describe("Queue secret dispatch schema upgrade", () => {
	test("adds crypto-erasure, secret classification, and execution claim columns to the existing ledger", async () => {
		const previous = await generateDrizzleJson(
			{ questpie_queue_dispatch: legacyQueueDispatchTable },
			"00000000-0000-0000-0000-000000000001",
		);
		const current = await generateDrizzleJson(
			{ questpie_queue_dispatch: questpieQueueDispatchTable },
			"00000000-0000-0000-0000-000000000002",
		);
		const migration = (await generateMigration(previous, current)).join("\n");

		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "wrapped_secret_key" jsonb',
		);
		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "completed_at" timestamp with time zone',
		);
		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "failed_at" timestamp with time zone',
		);
		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "secret_payload" boolean DEFAULT false NOT NULL',
		);
		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "execution_claim_token" uuid',
		);
		expect(migration).toContain(
			'ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "execution_claimed_until" timestamp with time zone',
		);
		expect(migration).not.toContain("DROP TABLE");
	});

	test.skipIf(!process.env.QUESTPIE_QUEUE_SECRET_POSTGRES_URL)(
		"applies the additive upgrade to a populated legacy PostgreSQL table",
		async () => {
			const previous = await generateDrizzleJson(
				{ questpie_queue_dispatch: legacyQueueDispatchTable },
				"00000000-0000-0000-0000-000000000001",
			);
			const current = await generateDrizzleJson(
				{ questpie_queue_dispatch: questpieQueueDispatchTable },
				"00000000-0000-0000-0000-000000000002",
			);
			const migration = (await generateMigration(previous, current)).join("\n");
			const client = new pg.Client({
				connectionString: process.env.QUESTPIE_QUEUE_SECRET_POSTGRES_URL,
			});
			await client.connect();
			try {
				await client.query("BEGIN");
				await client.query(`
					CREATE TEMP TABLE questpie_queue_dispatch (
						dispatch_id uuid PRIMARY KEY,
						job_name text NOT NULL,
						idempotency_key text,
						payload jsonb,
						options jsonb,
						status text DEFAULT 'pending' NOT NULL,
						attempts integer DEFAULT 0 NOT NULL,
						available_at timestamptz DEFAULT now() NOT NULL,
						lease_token uuid,
						leased_until timestamptz,
						adapter_job_id text,
						last_error text,
						accepted_at timestamptz,
						created_at timestamptz DEFAULT now() NOT NULL,
						updated_at timestamptz DEFAULT now() NOT NULL
					)
				`);
				await client.query(`
					INSERT INTO questpie_queue_dispatch (
						dispatch_id, job_name, idempotency_key, payload, options
					) VALUES (
						'00000000-0000-4000-8000-000000000001',
						'legacy-mail',
						'legacy:v1',
						'{"legacy":"payload"}'::jsonb,
						'{"retryLimit":1}'::jsonb
					)
				`);
				await client.query(
					migration.replaceAll("--> statement-breakpoint", ""),
				);
				const result = await client.query(`
					SELECT
						dispatch_id,
						secret_payload,
						wrapped_secret_key,
						execution_claim_token,
						execution_claimed_until,
						completed_at,
						failed_at
					FROM questpie_queue_dispatch
				`);

				expect(result.rows).toEqual([
					{
						dispatch_id: "00000000-0000-4000-8000-000000000001",
						secret_payload: false,
						wrapped_secret_key: null,
						execution_claim_token: null,
						execution_claimed_until: null,
						completed_at: null,
						failed_at: null,
					},
				]);
			} finally {
				await client.query("ROLLBACK").catch(() => {});
				await client.end();
			}
		},
	);
});
