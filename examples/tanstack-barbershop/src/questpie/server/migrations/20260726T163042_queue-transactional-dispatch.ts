import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260726T163042_queue-transactional-dispatch.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "queueTransactionalDispatch20260726T163042",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_queue_dispatch" (
	"dispatch_id" uuid PRIMARY KEY,
	"job_name" text NOT NULL,
	"idempotency_key" text,
	"payload" jsonb,
	"options" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" uuid,
	"leased_until" timestamp with time zone,
	"adapter_job_id" text,
	"last_error" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`);
		await db.execute(
			sql`CREATE UNIQUE INDEX "uq_queue_dispatch_idempotency" ON "questpie_queue_dispatch" ("job_name","idempotency_key");`,
		);
		await db.execute(
			sql`CREATE INDEX "idx_queue_dispatch_ready" ON "questpie_queue_dispatch" ("status","available_at","leased_until");`,
		);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_queue_dispatch";`);
	},
	snapshot,
});
