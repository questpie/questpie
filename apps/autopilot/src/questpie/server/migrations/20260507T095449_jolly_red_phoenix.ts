import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260507T095449_jolly_red_phoenix.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "jollyRedPhoenix20260507T095449",
	async up({ db }) {
		await db.execute(sql`CREATE EXTENSION IF NOT EXISTS "pg_trgm";`)
		await db.execute(sql`CREATE TABLE "account" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"accountId" varchar(255) NOT NULL,
	"providerId" varchar(255) NOT NULL,
	"accessToken" varchar(500),
	"refreshToken" varchar(500),
	"accessTokenExpiresAt" timestamp(3) with time zone,
	"refreshTokenExpiresAt" timestamp(3) with time zone,
	"scope" varchar(255),
	"idToken" varchar(500),
	"password" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "apikey" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255),
	"start" varchar(255),
	"prefix" varchar(255),
	"key" varchar(500) NOT NULL,
	"userId" varchar(255) NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp(3) with time zone,
	"enabled" boolean DEFAULT true,
	"rateLimitEnabled" boolean DEFAULT true,
	"rateLimitTimeWindow" integer,
	"rateLimitMax" integer,
	"requestCount" integer DEFAULT 0,
	"remaining" integer,
	"lastRequest" timestamp(3) with time zone,
	"expiresAt" timestamp(3) with time zone,
	"permissions" text,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "assets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"width" integer,
	"height" integer,
	"alt" varchar(500),
	"caption" text,
	"key" varchar(255) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"visibility" varchar(20) DEFAULT 'public' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "session" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL,
	"ipAddress" varchar(45),
	"userAgent" varchar(500),
	"impersonatedBy" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "user" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"emailVerified" boolean NOT NULL,
	"image" varchar(500),
	"avatar" varchar(36),
	"role" varchar(50),
	"banned" boolean DEFAULT false,
	"banReason" varchar(255),
	"banExpires" timestamp(3) with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "verification" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"identifier" varchar(255) NOT NULL,
	"value" varchar(255) NOT NULL,
	"expiresAt" timestamp(3) with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_locks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"resourceType" varchar(50) NOT NULL,
	"resource" varchar(255) NOT NULL,
	"resourceId" varchar(255) NOT NULL,
	"user" varchar(36) NOT NULL,
	"sessionId" varchar(64) NOT NULL,
	"expiresAt" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_preferences" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_saved_views" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"userId" varchar(255) NOT NULL,
	"collectionName" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"configuration" jsonb NOT NULL,
	"isDefault" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "admin_audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"action" varchar(50) NOT NULL,
	"resourceType" varchar(50) NOT NULL,
	"resource" varchar(255) NOT NULL,
	"resourceId" varchar(255),
	"resourceLabel" varchar(500),
	"userId" varchar(255),
	"userName" varchar(255),
	"locale" varchar(10),
	"changes" jsonb,
	"metadata" jsonb,
	"title" varchar(1000),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "wf_event" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"eventName" varchar(255) NOT NULL,
	"data" jsonb,
	"matchCriteria" jsonb,
	"sourceType" varchar(50) NOT NULL,
	"sourceInstanceId" varchar(255),
	"sourceStepName" varchar(255),
	"consumedCount" integer DEFAULT 0,
	"expiresAt" timestamp(3) with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "wf_instance" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"input" jsonb DEFAULT '{}',
	"output" jsonb,
	"error" jsonb,
	"attempt" integer DEFAULT 0,
	"parentInstanceId" varchar(255),
	"parentStepName" varchar(255),
	"idempotencyKey" varchar(255),
	"lockOwner" varchar(255),
	"lockedAt" timestamp(3) with time zone,
	"lockExpiresAt" timestamp(3) with time zone,
	"timeoutAt" timestamp(3) with time zone,
	"startedAt" timestamp(3) with time zone,
	"suspendedAt" timestamp(3) with time zone,
	"completedAt" timestamp(3) with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "wf_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"instanceId" varchar(255) NOT NULL,
	"stepName" varchar(255),
	"level" varchar(20) NOT NULL,
	"message" varchar(255) NOT NULL,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "wf_step" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"instanceId" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"attempt" integer DEFAULT 0,
	"maxAttempts" integer DEFAULT 1,
	"scheduledAt" timestamp(3) with time zone,
	"eventName" varchar(255),
	"matchCriteria" jsonb,
	"matchHash" varchar(50),
	"childInstanceId" varchar(255),
	"hasCompensation" boolean DEFAULT false,
	"startedAt" timestamp(3) with time zone,
	"completedAt" timestamp(3) with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "activity" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"actor" varchar(255),
	"type" varchar(255) NOT NULL,
	"summary" varchar(255),
	"task" varchar(36),
	"run" varchar(36),
	"project" varchar(36),
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "capabilities" (
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
		await db.execute(sql`CREATE TABLE "chat_messages" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"chatSession" varchar(36) NOT NULL,
	"role" varchar(50) NOT NULL,
	"content" text,
	"run" varchar(36),
	"runStatus" varchar(255),
	"model" varchar(36),
	"provider" varchar(36),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "chat_sessions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" varchar(255),
	"status" varchar(50) DEFAULT 'active',
	"scopeType" varchar(50) DEFAULT 'company',
	"project" varchar(36),
	"task" varchar(36),
	"runtimeSessionRef" varchar(255),
	"preferredWorker" varchar(36),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "environments" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"project" varchar(36),
	"variables" jsonb,
	"secretRefs" jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "join_tokens" (
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
		await db.execute(sql`CREATE TABLE "knowledge" (
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
		await db.execute(sql`CREATE TABLE "models" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"provider" varchar(36) NOT NULL,
	"modelId" varchar(255) NOT NULL,
	"runtime" varchar(50),
	"maxTokens" integer,
	"capabilities" jsonb,
	"config" jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "projects" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"path" varchar(255),
	"gitProvider" varchar(50),
	"gitRemote" varchar(255),
	"defaultBranch" varchar(255) DEFAULT 'main',
	"providerConfig" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "providers" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"type" varchar(50),
	"apiEndpoint" varchar(255),
	"secretRef" varchar(255),
	"config" jsonb,
	"project" varchar(36),
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "run_events" (
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
		await db.execute(sql`CREATE TABLE "runs" (
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
		await db.execute(sql`CREATE TABLE "schedule_executions" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"schedule" varchar(36) NOT NULL,
	"task" varchar(36),
	"chatSession" varchar(36),
	"status" varchar(50) DEFAULT 'triggered',
	"skipReason" varchar(255),
	"error" text,
	"triggeredAt" timestamp(3) with time zone,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "schedules" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"description" text,
	"cron" varchar(255) NOT NULL,
	"timezone" varchar(255) DEFAULT 'UTC',
	"mode" varchar(50),
	"workflowConfig" varchar(36),
	"taskTemplate" jsonb,
	"chatPrompt" text,
	"concurrencyPolicy" varchar(50) DEFAULT 'allow',
	"enabled" boolean DEFAULT true,
	"lastRunAt" timestamp(3) with time zone,
	"nextRunAt" timestamp(3) with time zone,
	"createdBy" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "scripts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"description" text,
	"runner" varchar(50),
	"content" text,
	"project" varchar(36),
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "secrets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(255) NOT NULL,
	"scope" varchar(255),
	"encryptedValue" varchar(255),
	"iv" varchar(255),
	"authTag" varchar(255),
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "task_relations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"sourceTask" varchar(36) NOT NULL,
	"targetTask" varchar(36) NOT NULL,
	"relationType" varchar(50) NOT NULL,
	"dedupeKey" varchar(255),
	"originRun" varchar(36),
	"createdBy" varchar(255),
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "tasks" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"title" varchar(255) NOT NULL,
	"description" text,
	"type" varchar(50),
	"status" varchar(50) DEFAULT 'backlog',
	"priority" varchar(50) DEFAULT 'medium',
	"project" varchar(36),
	"scopeType" varchar(50) DEFAULT 'company',
	"workflowConfig" varchar(36),
	"workflowStep" varchar(255),
	"capability" varchar(36),
	"model" varchar(36),
	"queue" varchar(255),
	"startAfter" timestamp(3) with time zone,
	"scheduledBy" varchar(255),
	"createdBy" varchar(255),
	"context" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "worker_leases" (
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
		await db.execute(sql`CREATE TABLE "workers" (
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
		await db.execute(sql`CREATE TABLE "workflow_configs" (
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
		await db.execute(sql`CREATE TABLE "questpie_realtime_log" (
	"seq" bigserial PRIMARY KEY,
	"resource_type" text NOT NULL,
	"resource" text NOT NULL,
	"operation" text NOT NULL,
	"record_id" text,
	"locale" text,
	"payload" jsonb DEFAULT '{}',
	"created_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_search" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"collection_name" text NOT NULL,
	"record_id" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"metadata" jsonb DEFAULT '{}',
	"fts_vector" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(content, '')), 'B')) STORED NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_search_entry" UNIQUE("collection_name","record_id","locale")
);`)
		await db.execute(sql`CREATE TABLE "questpie_search_facets" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"search_id" text NOT NULL,
	"collection_name" text NOT NULL,
	"locale" text NOT NULL,
	"facet_name" text NOT NULL,
	"facet_value" text NOT NULL,
	"numeric_value" numeric,
	"created_at" timestamp DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE UNIQUE INDEX "admin_preferences_user_key_idx" ON "admin_preferences" ("userId","key");`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_type_idx" ON "admin_audit_log" ("resource","resourceType");`)
		await db.execute(sql`CREATE INDEX "audit_log_user_id_idx" ON "admin_audit_log" ("userId");`)
		await db.execute(sql`CREATE INDEX "audit_log_created_at_idx" ON "admin_audit_log" ("created_at");`)
		await db.execute(sql`CREATE INDEX "audit_log_resource_id_idx" ON "admin_audit_log" ("resource","resourceId");`)
		await db.execute(sql`CREATE INDEX "idx_wfe_event_name" ON "wf_event" ("eventName");`)
		await db.execute(sql`CREATE INDEX "idx_wfe_created" ON "wf_event" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_wfe_expires" ON "wf_event" ("expiresAt");`)
		await db.execute(sql`CREATE INDEX "idx_wfi_name" ON "wf_instance" ("name");`)
		await db.execute(sql`CREATE INDEX "idx_wfi_status" ON "wf_instance" ("status");`)
		await db.execute(sql`CREATE INDEX "idx_wfi_parent" ON "wf_instance" ("parentInstanceId");`)
		await db.execute(sql`CREATE UNIQUE INDEX "idx_wfi_idempotency" ON "wf_instance" ("idempotencyKey");`)
		await db.execute(sql`CREATE INDEX "idx_wfi_status_lock" ON "wf_instance" ("status","lockExpiresAt");`)
		await db.execute(sql`CREATE INDEX "idx_wfi_created" ON "wf_instance" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_wfl_instance" ON "wf_log" ("instanceId");`)
		await db.execute(sql`CREATE UNIQUE INDEX "idx_wfs_instance_name" ON "wf_step" ("instanceId","name");`)
		await db.execute(sql`CREATE INDEX "idx_wfs_instance" ON "wf_step" ("instanceId");`)
		await db.execute(sql`CREATE INDEX "idx_wfs_status" ON "wf_step" ("status");`)
		await db.execute(sql`CREATE INDEX "idx_wfs_scheduled" ON "wf_step" ("scheduledAt");`)
		await db.execute(sql`CREATE INDEX "idx_wfs_event_status" ON "wf_step" ("eventName","status");`)
		await db.execute(sql`CREATE INDEX "idx_wfs_match_hash" ON "wf_step" ("matchHash","status");`)
		await db.execute(sql`CREATE INDEX "chat_messages_chat_session_idx" ON "chat_messages" ("chatSession");`)
		await db.execute(sql`CREATE INDEX "chat_sessions_status_idx" ON "chat_sessions" ("status");`)
		await db.execute(sql`CREATE INDEX "chat_sessions_project_idx" ON "chat_sessions" ("project");`)
		await db.execute(sql`CREATE INDEX "knowledge_scope_type_idx" ON "knowledge" ("scopeType");`)
		await db.execute(sql`CREATE INDEX "knowledge_project_idx" ON "knowledge" ("project");`)
		await db.execute(sql`CREATE INDEX "knowledge_task_idx" ON "knowledge" ("task");`)
		await db.execute(sql`CREATE INDEX "knowledge_run_idx" ON "knowledge" ("run");`)
		await db.execute(sql`CREATE INDEX "knowledge_kind_idx" ON "knowledge" ("kind");`)
		await db.execute(sql`CREATE INDEX "knowledge_content_hash_idx" ON "knowledge" ("contentHash");`)
		await db.execute(sql`CREATE UNIQUE INDEX "models_provider_model_unique" ON "models" ("provider","modelId");`)
		await db.execute(sql`CREATE UNIQUE INDEX "projects_slug_unique" ON "projects" ("slug");`)
		await db.execute(sql`CREATE INDEX "projects_git_provider_idx" ON "projects" ("gitProvider");`)
		await db.execute(sql`CREATE INDEX "run_events_run_idx" ON "run_events" ("run");`)
		await db.execute(sql`CREATE INDEX "run_events_run_sequence_idx" ON "run_events" ("run","sequence");`)
		await db.execute(sql`CREATE INDEX "runs_status_idx" ON "runs" ("status");`)
		await db.execute(sql`CREATE INDEX "runs_worker_idx" ON "runs" ("worker");`)
		await db.execute(sql`CREATE INDEX "runs_task_idx" ON "runs" ("task");`)
		await db.execute(sql`CREATE INDEX "runs_project_idx" ON "runs" ("project");`)
		await db.execute(sql`CREATE INDEX "runs_runtime_idx" ON "runs" ("runtime");`)
		await db.execute(sql`CREATE INDEX "schedule_executions_schedule_idx" ON "schedule_executions" ("schedule");`)
		await db.execute(sql`CREATE UNIQUE INDEX "task_relations_unique" ON "task_relations" ("sourceTask","targetTask","relationType");`)
		await db.execute(sql`CREATE INDEX "task_relations_source_task_idx" ON "task_relations" ("sourceTask");`)
		await db.execute(sql`CREATE INDEX "task_relations_target_task_idx" ON "task_relations" ("targetTask");`)
		await db.execute(sql`CREATE INDEX "tasks_status_idx" ON "tasks" ("status");`)
		await db.execute(sql`CREATE INDEX "tasks_project_idx" ON "tasks" ("project");`)
		await db.execute(sql`CREATE INDEX "tasks_priority_idx" ON "tasks" ("priority");`)
		await db.execute(sql`CREATE INDEX "tasks_start_after_idx" ON "tasks" ("startAfter");`)
		await db.execute(sql`CREATE INDEX "worker_leases_worker_idx" ON "worker_leases" ("worker");`)
		await db.execute(sql`CREATE INDEX "worker_leases_run_idx" ON "worker_leases" ("run");`)
		await db.execute(sql`CREATE INDEX "worker_leases_status_idx" ON "worker_leases" ("status");`)
		await db.execute(sql`CREATE UNIQUE INDEX "workers_device_id_unique" ON "workers" ("deviceId");`)
		await db.execute(sql`CREATE INDEX "workers_status_idx" ON "workers" ("status");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_created_at" ON "questpie_realtime_log" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_search_fts" ON "questpie_search" USING gin ("fts_vector");`)
		await db.execute(sql`CREATE INDEX "idx_search_trigram" ON "questpie_search" USING gin ("title" gin_trgm_ops);`)
		await db.execute(sql`CREATE INDEX "idx_search_collection_locale" ON "questpie_search" ("collection_name","locale");`)
		await db.execute(sql`CREATE INDEX "idx_search_record_id" ON "questpie_search" ("record_id");`)
		await db.execute(sql`CREATE INDEX "idx_facets_agg" ON "questpie_search_facets" ("collection_name","locale","facet_name","facet_value");`)
		await db.execute(sql`CREATE INDEX "idx_facets_search_id" ON "questpie_search_facets" ("search_id");`)
		await db.execute(sql`CREATE INDEX "idx_facets_collection" ON "questpie_search_facets" ("collection_name");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "account";`)
		await db.execute(sql`DROP TABLE "apikey";`)
		await db.execute(sql`DROP TABLE "assets";`)
		await db.execute(sql`DROP TABLE "session";`)
		await db.execute(sql`DROP TABLE "user";`)
		await db.execute(sql`DROP TABLE "verification";`)
		await db.execute(sql`DROP TABLE "admin_locks";`)
		await db.execute(sql`DROP TABLE "admin_preferences";`)
		await db.execute(sql`DROP TABLE "admin_saved_views";`)
		await db.execute(sql`DROP TABLE "admin_audit_log";`)
		await db.execute(sql`DROP TABLE "wf_event";`)
		await db.execute(sql`DROP TABLE "wf_instance";`)
		await db.execute(sql`DROP TABLE "wf_log";`)
		await db.execute(sql`DROP TABLE "wf_step";`)
		await db.execute(sql`DROP TABLE "activity";`)
		await db.execute(sql`DROP TABLE "capabilities";`)
		await db.execute(sql`DROP TABLE "chat_messages";`)
		await db.execute(sql`DROP TABLE "chat_sessions";`)
		await db.execute(sql`DROP TABLE "environments";`)
		await db.execute(sql`DROP TABLE "join_tokens";`)
		await db.execute(sql`DROP TABLE "knowledge";`)
		await db.execute(sql`DROP TABLE "models";`)
		await db.execute(sql`DROP TABLE "projects";`)
		await db.execute(sql`DROP TABLE "providers";`)
		await db.execute(sql`DROP TABLE "run_events";`)
		await db.execute(sql`DROP TABLE "runs";`)
		await db.execute(sql`DROP TABLE "schedule_executions";`)
		await db.execute(sql`DROP TABLE "schedules";`)
		await db.execute(sql`DROP TABLE "scripts";`)
		await db.execute(sql`DROP TABLE "secrets";`)
		await db.execute(sql`DROP TABLE "task_relations";`)
		await db.execute(sql`DROP TABLE "tasks";`)
		await db.execute(sql`DROP TABLE "worker_leases";`)
		await db.execute(sql`DROP TABLE "workers";`)
		await db.execute(sql`DROP TABLE "workflow_configs";`)
		await db.execute(sql`DROP TABLE "questpie_realtime_log";`)
		await db.execute(sql`DROP TABLE "questpie_search";`)
		await db.execute(sql`DROP TABLE "questpie_search_facets";`)
	},
	snapshot,
})
