import { sql } from "drizzle-orm";
import type { OperationSnapshot } from "questpie/migration";
import { migration } from "questpie/services";

import snapshotJson from "./snapshots/20260519T135407_add_run_links_and_ai_module.json";

const snapshot = snapshotJson as OperationSnapshot;

export default migration({
	id: "addRunLinksAndAiModule20260519T135407",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "ai_run_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"run" varchar(36) NOT NULL,
	"type" varchar(255) NOT NULL,
	"level" varchar(50) DEFAULT 'info',
	"summary" varchar(255),
	"sequence" integer,
	"meta" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "ai_worker_leases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"worker" varchar(36) NOT NULL,
	"run" varchar(36) NOT NULL,
	"claimedAt" timestamp(3) with time zone NOT NULL,
	"expiresAt" timestamp(3) with time zone,
	"status" varchar(50) DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "ai_workers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"deviceId" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"volumeId" varchar(255),
	"status" varchar(50) DEFAULT 'offline',
	"capabilities" jsonb,
	"lastHeartbeat" timestamp(3) with time zone,
	"secretHash" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(sql`CREATE TABLE "run_links" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"legacyRunId" varchar(255),
	"aiRun" varchar(36),
	"task" varchar(36),
	"project" varchar(36),
	"workflowConfig" varchar(36),
	"workflowStep" varchar(255),
	"workflowInstanceId" varchar(255),
	"schedule" varchar(36),
	"scheduleExecution" varchar(36),
	"chatSession" varchar(36),
	"chatMessage" varchar(36),
	"initiatedBy" varchar(50),
	"provider" varchar(36),
	"model" varchar(36),
	"capability" varchar(36),
	"runtime" varchar(50),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"instructions" text,
	"summary" text,
	"error" text,
	"tokensInput" integer,
	"tokensOutput" integer,
	"cost" integer,
	"startedAt" timestamp(3) with time zone,
	"endedAt" timestamp(3) with time zone,
	"runtimeSessionRef" varchar(255),
	"resumedFromRun" varchar(36),
	"resumable" boolean DEFAULT false,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`);
		await db.execute(
			sql`CREATE INDEX "ai_run_events_run_idx" ON "ai_run_events" ("run");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_run_events_run_sequence_idx" ON "ai_run_events" ("run","sequence");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_runs_status_idx" ON "ai_runs" ("status");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_runs_worker_idx" ON "ai_runs" ("worker");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_runs_runtime_idx" ON "ai_runs" ("runtime");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_worker_leases_worker_idx" ON "ai_worker_leases" ("worker");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_worker_leases_run_idx" ON "ai_worker_leases" ("run");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_worker_leases_status_idx" ON "ai_worker_leases" ("status");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "ai_workers_device_id_unique" ON "ai_workers" ("deviceId");`,
		);
		await db.execute(
			sql`CREATE INDEX "ai_workers_status_idx" ON "ai_workers" ("status");`,
		);
		await db.execute(
			sql`CREATE UNIQUE INDEX "run_links_legacy_run_id_idx" ON "run_links" ("legacyRunId");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_ai_run_idx" ON "run_links" ("aiRun");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_status_idx" ON "run_links" ("status");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_task_idx" ON "run_links" ("task");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_project_idx" ON "run_links" ("project");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_schedule_execution_idx" ON "run_links" ("scheduleExecution");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_chat_message_idx" ON "run_links" ("chatMessage");`,
		);
		await db.execute(
			sql`CREATE INDEX "run_links_resumed_from_run_idx" ON "run_links" ("resumedFromRun");`,
		);
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "ai_run_events";`);
		await db.execute(sql`DROP TABLE "ai_runs";`);
		await db.execute(sql`DROP TABLE "ai_worker_leases";`);
		await db.execute(sql`DROP TABLE "ai_workers";`);
		await db.execute(sql`DROP TABLE "run_links";`);
	},
	snapshot,
});
