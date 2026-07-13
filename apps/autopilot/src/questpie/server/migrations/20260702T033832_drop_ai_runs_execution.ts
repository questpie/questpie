import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260702T033832_drop_ai_runs_execution.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "dropAiRunsExecution20260702T033832",
	async up({ db }) {
		await db.execute(sql`DROP TABLE "ai_run_events";`)
		await db.execute(sql`DROP TABLE "ai_runs";`)
		await db.execute(sql`DROP INDEX "run_links_ai_run_idx";`)
		await db.execute(sql`ALTER TABLE "run_links" DROP COLUMN "aiRun";`)
		await db.execute(sql`ALTER TABLE "ai_worker_leases" ALTER COLUMN "run" SET DATA TYPE varchar(255) USING "run"::varchar(255);`)
	},
	async down({ db }) {
		await db.execute(sql`CREATE TABLE "ai_run_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"run" varchar(36) NOT NULL,
	"type" varchar(255) NOT NULL,
	"level" varchar(50) DEFAULT 'info',
	"summary" varchar(255),
	"sequence" integer,
	"meta" jsonb,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "ai_runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"runtime" varchar(50),
	"worker" varchar(36),
	"prompt" text,
	"summary" text,
	"error" text,
	"runtimeSessionRef" varchar(255),
	"tokensInput" integer,
	"tokensOutput" integer,
	"cost" integer,
	"startedAt" timestamp(3) with time zone,
	"endedAt" timestamp(3) with time zone,
	"meta" jsonb,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	"systemPrompt" text
);`)
		await db.execute(sql`ALTER TABLE "run_links" ADD COLUMN "aiRun" varchar(36);`)
		await db.execute(sql`ALTER TABLE "ai_worker_leases" ALTER COLUMN "run" SET DATA TYPE varchar(36) USING "run"::varchar(36);`)
		await db.execute(sql`CREATE INDEX "ai_run_events_run_idx" ON "ai_run_events" ("run");`)
		await db.execute(sql`CREATE INDEX "ai_run_events_run_sequence_idx" ON "ai_run_events" ("run","sequence");`)
		await db.execute(sql`CREATE INDEX "ai_runs_status_idx" ON "ai_runs" ("status");`)
		await db.execute(sql`CREATE INDEX "ai_runs_worker_idx" ON "ai_runs" ("worker");`)
		await db.execute(sql`CREATE INDEX "ai_runs_runtime_idx" ON "ai_runs" ("runtime");`)
		await db.execute(sql`CREATE INDEX "run_links_ai_run_idx" ON "run_links" ("aiRun");`)
	},
	snapshot,
})
