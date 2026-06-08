import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260606T003509_v2_schema.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "v2Schema20260606T003509",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "agent_memory" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"type" varchar(50) DEFAULT 'episodic' NOT NULL,
	"scopeType" varchar(50) DEFAULT 'company' NOT NULL,
	"scopeRef" varchar(255),
	"content" text NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"confidence" integer,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"supersedes" varchar(36),
	"sourceRun" varchar(36),
	"source" varchar(50) DEFAULT 'reflection' NOT NULL,
	"contentHash" varchar(255),
	"lastAccessedAt" timestamp(3) with time zone,
	"accessCount" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "document_store" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"store" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"data" jsonb,
	"createdByApp" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "memory_settings" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"scopeType" varchar(50) DEFAULT 'company' NOT NULL,
	"scopeRef" varchar(255),
	"agentMayWrite" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`DROP TABLE IF EXISTS "capabilities";`)
		await db.execute(sql`DROP TABLE IF EXISTS "join_tokens";`)
		await db.execute(sql`DROP TABLE IF EXISTS "knowledge";`)
		await db.execute(sql`DROP TABLE IF EXISTS "run_events";`)
		await db.execute(sql`DROP TABLE IF EXISTS "runs";`)
		await db.execute(sql`DROP TABLE IF EXISTS "worker_leases";`)
		await db.execute(sql`DROP TABLE IF EXISTS "workers";`)
		await db.execute(sql`DROP TABLE IF EXISTS "workflow_configs";`)
		await db.execute(sql`ALTER TABLE "apikey" ADD COLUMN IF NOT EXISTS "configId" varchar(255) DEFAULT 'default' NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "title" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "path" varchar(255) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "scopeType" varchar(50) DEFAULT 'company';`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "project" varchar(36);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "task" varchar(36);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "run" varchar(36);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "kind" varchar(50);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "contentType" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "body" text;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "renderer" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "source" varchar(50);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "sourceRef" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "contentHash" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "metadata" jsonb;`)
		await db.execute(sql`ALTER TABLE "schedule_executions" ADD COLUMN IF NOT EXISTS "run" varchar(36);`)
		await db.execute(sql`ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "appId" varchar(255);`)
		await db.execute(sql`ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "appFn" varchar(255);`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "key";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "filename";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "mime_type";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "size";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "visibility";`)
		await db.execute(sql`ALTER TABLE "schedules" DROP COLUMN IF EXISTS "workflowConfig";`)
		await db.execute(sql`ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "preferredWorker";`)
		await db.execute(sql`ALTER TABLE "models" DROP COLUMN IF EXISTS "capabilities";`)
		await db.execute(sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflowConfig";`)
		await db.execute(sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflowStep";`)
		await db.execute(sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "capability";`)
		await db.execute(sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "workflowConfig";`)
		await db.execute(sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "workflowStep";`)
		await db.execute(sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "capability";`)
		await db.execute(sql`ALTER TABLE "chat_messages" ALTER COLUMN "runStatus" SET DATA TYPE varchar(50) USING "runStatus"::varchar(50);`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_path_idx" ON "assets" ("path");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_scope_type_idx" ON "assets" ("scopeType");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_project_idx" ON "assets" ("project");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_task_idx" ON "assets" ("task");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_run_idx" ON "assets" ("run");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_kind_idx" ON "assets" ("kind");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "assets_content_hash_idx" ON "assets" ("contentHash");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_status_idx" ON "agent_memory" ("status");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_scope_idx" ON "agent_memory" ("scopeType","scopeRef");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_type_idx" ON "agent_memory" ("type");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_content_hash_idx" ON "agent_memory" ("contentHash");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_source_run_idx" ON "agent_memory" ("sourceRun");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "agent_memory_supersedes_idx" ON "agent_memory" ("supersedes");`)
		await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "document_store_store_key_idx" ON "document_store" ("store","key");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "document_store_store_idx" ON "document_store" ("store");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "document_store_data_gin_idx" ON "document_store" USING gin ("data");`)
		await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "memory_settings_scope_idx" ON "memory_settings" ("scopeType","scopeRef");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "memory_settings_scope_type_idx" ON "memory_settings" ("scopeType");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "schedule_executions_run_idx" ON "schedule_executions" ("run");`)
	},
	async down({ db }) {
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "capabilities" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"description" text,
	"defaultModel" varchar(36),
	"allowedProviders" jsonb,
	"allowedTools" jsonb,
	"contextRefs" jsonb,
	"promptRefs" jsonb,
	"runtimeHints" jsonb,
	"project" varchar(36),
	"enabled" boolean DEFAULT true,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "join_tokens" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"secretHash" varchar(255) NOT NULL,
	"description" varchar(255),
	"createdBy" varchar(255),
	"expiresAt" timestamp(3) with time zone,
	"usedAt" timestamp(3) with time zone,
	"usedByWorker" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "knowledge" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" varchar(255),
	"path" varchar(255) NOT NULL,
	"scopeType" varchar(50) DEFAULT 'company',
	"project" varchar(36),
	"task" varchar(36),
	"run" varchar(36),
	"kind" varchar(50),
	"contentType" varchar(255),
	"body" text,
	"renderer" varchar(255),
	"source" varchar(50),
	"sourceRef" varchar(255),
	"contentHash" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "run_events" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"run" varchar(36) NOT NULL,
	"type" varchar(255) NOT NULL,
	"level" varchar(50) DEFAULT 'info',
	"summary" varchar(255),
	"sequence" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "runs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"task" varchar(36),
	"project" varchar(36),
	"worker" varchar(36),
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"runtime" varchar(50),
	"provider" varchar(36),
	"model" varchar(36),
	"capability" varchar(36),
	"initiatedBy" varchar(50),
	"instructions" text,
	"summary" text,
	"error" text,
	"tokensInput" integer,
	"tokensOutput" integer,
	"startedAt" timestamp(3) with time zone,
	"endedAt" timestamp(3) with time zone,
	"runtimeSessionRef" varchar(255),
	"resumedFromRun" varchar(36),
	"preferredWorker" varchar(36),
	"resumable" boolean DEFAULT false,
	"targeting" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "worker_leases" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"worker" varchar(36) NOT NULL,
	"run" varchar(36) NOT NULL,
	"claimedAt" timestamp(3) with time zone NOT NULL,
	"expiresAt" timestamp(3) with time zone,
	"status" varchar(50) DEFAULT 'active',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "workers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"deviceId" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'offline',
	"capabilities" jsonb,
	"lastHeartbeat" timestamp(3) with time zone,
	"machineSecretHash" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE IF NOT EXISTS "workflow_configs" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"description" text,
	"steps" jsonb NOT NULL,
	"defaultCapability" varchar(36),
	"project" varchar(36),
	"enabled" boolean DEFAULT true,
	"version" integer DEFAULT 1,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`DROP TABLE IF EXISTS "agent_memory";`)
		await db.execute(sql`DROP TABLE IF EXISTS "document_store";`)
		await db.execute(sql`DROP TABLE IF EXISTS "memory_settings";`)
		await db.execute(sql`DROP INDEX "assets_path_idx";`)
		await db.execute(sql`DROP INDEX "assets_scope_type_idx";`)
		await db.execute(sql`DROP INDEX "assets_project_idx";`)
		await db.execute(sql`DROP INDEX "assets_task_idx";`)
		await db.execute(sql`DROP INDEX "assets_run_idx";`)
		await db.execute(sql`DROP INDEX "assets_kind_idx";`)
		await db.execute(sql`DROP INDEX "assets_content_hash_idx";`)
		await db.execute(sql`DROP INDEX "schedule_executions_run_idx";`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "key" varchar(255) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "filename" varchar(255) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "size" integer NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "visibility" varchar(20) DEFAULT 'public' NOT NULL;`)
		await db.execute(sql`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "preferredWorker" varchar(36);`)
		await db.execute(sql`ALTER TABLE "models" ADD COLUMN IF NOT EXISTS "capabilities" jsonb;`)
		await db.execute(sql`ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "workflowConfig" varchar(36);`)
		await db.execute(sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "workflowConfig" varchar(36);`)
		await db.execute(sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "workflowStep" varchar(255);`)
		await db.execute(sql`ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "capability" varchar(36);`)
		await db.execute(sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "workflowConfig" varchar(36);`)
		await db.execute(sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "workflowStep" varchar(255);`)
		await db.execute(sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "capability" varchar(36);`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "title";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "path";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "scopeType";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "project";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "task";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "run";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "kind";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "contentType";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "body";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "renderer";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "source";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "sourceRef";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "contentHash";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "metadata";`)
		await db.execute(sql`ALTER TABLE "schedules" DROP COLUMN IF EXISTS "appId";`)
		await db.execute(sql`ALTER TABLE "schedules" DROP COLUMN IF EXISTS "appFn";`)
		await db.execute(sql`ALTER TABLE "apikey" DROP COLUMN IF EXISTS "configId";`)
		await db.execute(sql`ALTER TABLE "schedule_executions" DROP COLUMN IF EXISTS "run";`)
		await db.execute(sql`ALTER TABLE "chat_messages" ALTER COLUMN "runStatus" SET DATA TYPE varchar(255) USING "runStatus"::varchar(255);`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_scope_type_idx" ON "knowledge" ("scopeType");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_project_idx" ON "knowledge" ("project");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_task_idx" ON "knowledge" ("task");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_run_idx" ON "knowledge" ("run");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_kind_idx" ON "knowledge" ("kind");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "knowledge_content_hash_idx" ON "knowledge" ("contentHash");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "run_events_run_idx" ON "run_events" ("run");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "run_events_run_sequence_idx" ON "run_events" ("run","sequence");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "runs_status_idx" ON "runs" ("status");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "runs_worker_idx" ON "runs" ("worker");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "runs_task_idx" ON "runs" ("task");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "runs_project_idx" ON "runs" ("project");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "runs_runtime_idx" ON "runs" ("runtime");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "worker_leases_worker_idx" ON "worker_leases" ("worker");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "worker_leases_run_idx" ON "worker_leases" ("run");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "worker_leases_status_idx" ON "worker_leases" ("status");`)
		await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "workers_device_id_unique" ON "workers" ("deviceId");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "workers_status_idx" ON "workers" ("status");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "capabilities_project_idx" ON "capabilities" ("project");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "capabilities_enabled_idx" ON "capabilities" ("enabled");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "join_tokens_expires_at_idx" ON "join_tokens" ("expiresAt");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_configs_project_idx" ON "workflow_configs" ("project");`)
		await db.execute(sql`CREATE INDEX IF NOT EXISTS "workflow_configs_enabled_idx" ON "workflow_configs" ("enabled");`)
	},
	snapshot,
})
