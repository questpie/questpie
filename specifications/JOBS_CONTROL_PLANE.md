# Jobs Control Plane (Design + Refactor Plan)

This document describes how to refactor QUESTPIE jobs into a unified "jobs control plane" that is decoupled from the queue transport. The goal is to keep job logic in code while managing scheduling, configuration, audit, and logs in the database as first-class collections.

## Goals

- Unify "seeds", cron jobs, on-demand tasks, and worker tasks under one job concept.
- Keep job handlers defined in code (`defineJob`), but manage runtime config in DB.
- Use queue adapter cron support to trigger a distributed scheduler tick.
- Store job history + logs as collections for admin UI + search.
- Provide a clean API: `cms.jobs.*` for management and `cms.queue.*` for transport.

## Non-Goals

- Replace or remove `QueueAdapter` or `pg-boss`.
- Introduce UI-specific fields into the CMS schema.
- Hard-code admin UI access rules (collections can be overridden by users).

## Current State (Repo Context)

- Job definitions are in code via `defineJob` and `QCMSBuilder.jobs(...)`.
- Queue transport is `QueueAdapter` (pg-boss now), with publish/schedule/worker.
- `cms.listenToJobs()` only starts workers; no DB-based scheduling or audit.
- Logger exists as `LoggerService`, but no job-specific log persistence.

## Proposed Architecture

### Layers

1) **Job Definition (code)**: `defineJob({ name, schema, handler, options })`
2) **Job Registry (code + DB sync)**: sync code definitions into DB collection.
3) **Job Store (DB collections)**: runtime config, schedule, history, logs.
4) **Scheduler Tick Job (queue-driven)**: cron in queue triggers DB polling.
5) **Worker Executor (queue)**: executes job handler + writes run/log audit.

### Transport vs Control Plane

- **Transport** remains `QueueAdapter` (publish, schedule, work).
- **Control plane** is a new jobs module backed by collections.
- **Primary job key** is `jobDef.name` (not the map key in `.jobs({...})`).

## New Types and Metadata (Code)

### Job strategy and metadata

```ts
export type JobStrategy = "on_demand" | "cron" | "interval" | "init" | "event";

export type JobScheduleDefaults = {
	cron?: string;
	intervalSeconds?: number;
	timezone?: string;
};

export type JobMeta = {
	description?: string;
	tags?: string[];
	defaultStrategy?: JobStrategy;
	defaultEnabled?: boolean;
	defaultSchedule?: JobScheduleDefaults;
	defaultPayload?: Record<string, unknown>;
	system?: boolean; // Hide internal jobs from UI by default
};
```

### Extend `JobDefinition`

`JobDefinition` stays where it is (queue module), but add `meta` for control-plane defaults:

```ts
export interface JobDefinition<TPayload, TResult, TName extends string> {
	name: TName;
	schema: z.ZodSchema<TPayload>;
	handler: (payload: TPayload, context: RequestContext) => Promise<TResult>;
	options?: { /* queue options (retry, priority, startAfter) */ };
	meta?: JobMeta;
}
```

Notes:
- `options` remain transport-related.
- Scheduling is controlled by DB records, not `options.cron`.
- `meta.defaultSchedule` is used to bootstrap DB entries.

## Queue Metadata (Worker Context)

The worker currently receives `{ id, data }`. For job run auditing and retries:

- Extend `QueueAdapter.work` to optionally pass metadata:
  - `attempt` / `retryCount`
  - `queuedAt`
  - `priority`
- Plumb `WorkerOptions.includeMetadata` into `startJobWorker`.
- Store queue job id into `job_run.queueJobId`.

## Collections (Default Schemas)

These are **collections**, not plain tables, so users can override fields and access.

### `job` collection (runtime config)

Suggested fields:

- `name` (string, unique, required)
- `description` (string, optional)
- `enabled` (boolean, default true)
- `strategy` (enum: `on_demand | cron | interval | init | event`)
- `cron` (string, optional)
- `intervalSeconds` (number, optional)
- `timezone` (string, optional, default "UTC")
- `defaultPayload` (json, optional)
- `maxConcurrency` (number, optional)
- `retryLimit`, `retryDelay`, `retryBackoff` (optional overrides)
- `lastRunAt` (timestamp, optional)
- `nextRunAt` (timestamp, optional, computed by scheduler)
- `system` (boolean, default false)
- `definitionHash` (string, optional)
- `retentionDays` (number, optional, for runs/logs cleanup)
- `createdAt`, `updatedAt`

### `job_run` collection (audit)

- `jobName` (string, indexed)
- `status` (enum: `queued | running | success | failed | canceled`)
- `scheduledFor` (timestamp, optional)
- `startedAt`, `finishedAt` (timestamp)
- `attempt` (number)
- `payload` (json)
- `error` (json/text)
- `durationMs` (number)
- `queueJobId` (string, optional)
- `workerId` (string, optional)
- `createdAt`

### `job_log` collection (log stream + search)

- `jobName` (string, indexed)
- `jobRunId` (relation to job_run)
- `level` (enum: `debug | info | warn | error`)
- `message` (string, full-text search)
- `meta` (json)
- `sequence` (number, optional)
- `createdAt`

### Optional `job_lock` collection (distributed scheduler lock)

- `key` (string, unique)
- `owner` (string)
- `lockUntil` (timestamp)

## Collection Definition Sketches (TypeScript)

These are draft shapes to guide implementation, not drop-in code.

```ts
import { defineCollection } from "#questpie/cms/exports/server.js";
import { sql } from "drizzle-orm";
import {
	boolean,
	integer,
	jsonb,
	text,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

export const jobsCollection = defineCollection("job")
	.options({ timestamps: true })
	.fields({
		name: varchar("name", { length: 120 }).notNull().unique(),
		description: text("description"),
		enabled: boolean("enabled").notNull().default(true),
		strategy: varchar("strategy", { length: 24 }).notNull(),
		cron: varchar("cron", { length: 255 }),
		intervalSeconds: integer("interval_seconds"),
		timezone: varchar("timezone", { length: 64 }).default("UTC"),
		defaultPayload: jsonb("default_payload").default({}),
		maxConcurrency: integer("max_concurrency"),
		retryLimit: integer("retry_limit"),
		retryDelay: integer("retry_delay"),
		retryBackoff: boolean("retry_backoff"),
		lastRunAt: timestamp("last_run_at", { mode: "date" }),
		nextRunAt: timestamp("next_run_at", { mode: "date" }),
		system: boolean("system").notNull().default(false),
		definitionHash: varchar("definition_hash", { length: 64 }),
	})
	.title(({ table }) => sql`${table.name}`);
```

```ts
export const jobRunsCollection = defineCollection("job_run")
	.options({ timestamps: true })
	.fields({
		jobName: varchar("job_name", { length: 120 }).notNull(),
		status: varchar("status", { length: 24 }).notNull(),
		scheduledFor: timestamp("scheduled_for", { mode: "date" }),
		startedAt: timestamp("started_at", { mode: "date" }),
		finishedAt: timestamp("finished_at", { mode: "date" }),
		attempt: integer("attempt").default(1),
		payload: jsonb("payload").default({}),
		error: jsonb("error"),
		durationMs: integer("duration_ms"),
		queueJobId: varchar("queue_job_id", { length: 100 }),
		workerId: varchar("worker_id", { length: 100 }),
	})
	.indexes(({ table }) => [sql`create index on ${table.jobName}`]);
```

```ts
export const jobLogsCollection = defineCollection("job_log")
	.options({ timestamps: true })
	.fields({
		jobName: varchar("job_name", { length: 120 }).notNull(),
		jobRunId: varchar("job_run_id", { length: 36 }).notNull(),
		level: varchar("level", { length: 12 }).notNull(),
		message: text("message").notNull(),
		meta: jsonb("meta").default({}),
		sequence: integer("sequence"),
	})
	.searchable({
		content: (record) => record.message,
		metadata: (record) => ({
			jobName: record.jobName,
			level: record.level,
			jobRunId: record.jobRunId,
		}),
	});
```

## Jobs Module

Create a new module similar to core module:

```
packages/cms/src/server/modules/jobs/
  jobs.module.ts
  collections/
    jobs.ts
    job-runs.ts
    job-logs.ts
    job-locks.ts (optional)
  migrations/
```

### Integration

Auto-include via `defineQCMS` (like core). `createJobsModule()` remains available
for explicit composition, but `defineQCMS` will include it by default.

Expected change:

```ts
export function defineQCMS<TName extends string>(config: { name: TName }) {
	return QCMSBuilder.empty(config.name)
		.use(createCoreModule())
		.use(createJobsModule());
}
```

## Suggested File Layout (Runtime Services)

```
packages/cms/src/server/integrated/jobs/
  index.ts
  types.ts
  registry.ts
  service.ts
  scheduler.ts
  logger.ts
```

Exports via `packages/cms/src/server/index.ts`.

## Job Registry + Job Service

### JobRegistry (sync)

Responsibilities:
- Upsert job records from code definitions.
- Populate default fields from `job.meta`.
- Track `definitionHash` for update detection.

Sync rules:
- If job not present, insert with defaults.
- If job exists, update only safe fields (`description`, `tags`, `definitionHash`) unless `force=true`.
- Respect user overrides for schedule and enablement.

Pseudocode:

```
for each jobDef:
  hash = hash(jobDef.name + jobDef.meta + jobDef.schema)
  record = find job by name
  if !record:
    insert with defaults from meta
  else if record.definitionHash != hash:
    update definitionHash and optional display fields
```

### JobService (runtime API)

Suggested methods:

```ts
type JobService = {
	syncDefinitions(options?: { force?: boolean }): Promise<void>;
	trigger(name: string, payload?: any, options?: PublishOptions): Promise<string | null>;
	enable(name: string): Promise<void>;
	disable(name: string): Promise<void>;
	updateSchedule(
		name: string,
		input: { cron?: string; intervalSeconds?: number; timezone?: string },
	): Promise<void>;
	list(): Promise<JobRecord[]>;
	listRuns(params?: { jobName?: string; status?: string }): Promise<JobRunRecord[]>;
	listLogs(params?: { jobName?: string; jobRunId?: string }): Promise<JobLogRecord[]>;
};
```

Expose as `cms.jobs` and keep `cms.queue` as transport-only.

## Job Scheduler Tick Definition

Scheduler tick is a normal job definition that runs every minute:

```ts
export const schedulerTickJob = defineJob({
	name: "questpie-scheduler-tick",
	schema: z.object({}),
	meta: { system: true, defaultStrategy: "cron" },
	handler: async () => {
		const cms = getCMSFromContext();
		await cms.jobs.runSchedulerTick();
	},
});
```

Queue adapter will schedule this job (cron) on startup.

## Scheduler Design (Queue-Driven)

### Key Idea

The scheduler is itself a job, triggered by queue cron. This gives distributed scheduling without running a separate daemon:

1) Queue adapter schedules `questpie-scheduler-tick` (e.g. every minute).
2) Tick job reads due jobs from `job` collection.
3) Applies locking to prevent duplicates.
4) Enqueues actual job runs via `queue.publish(...)`.
5) Writes `job_run` records as `queued`.

### Scheduler Tick Algorithm (Pseudo)

```
tick(now):
  lock "scheduler" (job_lock or advisory)
  jobs = select job where enabled and due(now)
  for each job:
    if maxConcurrency reached => skip
    create job_run(status="queued", scheduledFor=job.nextRunAt)
    queue.publish(job.name, payload, { singletonKey, retry overrides })
    update job.lastRunAt = now
    update job.nextRunAt = computeNextRun(job, now)
  release lock
```

### Due Selection (examples)

- `strategy=cron`: compute next run time; if `nextRunAt <= now` and enabled.
- `strategy=interval`: `lastRunAt + intervalSeconds <= now`.
- `strategy=init`: run once on boot unless `runOnce` already completed.
- `strategy=event`: run is created by event hook, not scheduler.

### Locking

- Use `singletonKey` when publish supports it (pg-boss).
- Optional `job_lock` for cross-worker scheduler tick safety.

## Next Run Computation

We need a reliable `computeNextRun`:

- For `cron`: use a small cron parser (or queue adapter helper if exposed).
- For `interval`: `now + intervalSeconds`.
- For `init`: set `nextRunAt` to `now` once, then disable after success.

If cron parsing is added, keep dependency pinned in `DEPENDENCIES.md`.

## Event Strategy

`strategy=event` is triggered by CMS hooks, not scheduler:

- Collection hooks call `cms.jobs.trigger("job-name", payload)`.
- Event jobs are still audited in `job_run` and `job_log`.

## Retention and Cleanup

Provide system jobs:

- `questpie-prune-job-runs`: delete runs older than N days.
- `questpie-prune-job-logs`: delete logs older than N days.

Use `job.retentionDays` or global defaults to configure retention.

## RequestContext Enrichment

`RequestContext` already allows extensions. Jobs should set:

```ts
context.job = {
	name,
	runId,
	attempt,
	scheduledFor,
};
context.logger = jobLogger;
```

Handlers can then use `context.logger` for structured job logs.

## Log Ingestion Strategy

Two-layer logging:

1) **Runtime logger** via `cms.logger` (stdout or external sink).
2) **Persisted logs** via `job_log` collection for UI + search.

Implementation idea:
- Create `JobLogger` that writes to both `cms.logger` and `job_log`.
- Inject into job handler via context (e.g. `context.logger`).
- Keep log payload small; store large blobs in `meta` or external storage.

## Worker Instrumentation (Runs + Logs)

Wrap existing worker execution (`packages/cms/src/server/integrated/queue/worker.ts`):

1) On job receive, create `job_run` with status `running`.
2) Create logger child:
   - `const logger = cms.logger.child({ jobName, jobRunId, attempt })`
3) Provide logger to handler (via context extension or job service).
4) Persist logs to `job_log` collection.
5) On completion, update `job_run` status + timestamps + error if any.

## Access Control Defaults (Collections)

Defaults should be strict (admin-only), but overridable:

- `job`: read/write for admin; no public access.
- `job_run`: read for admin; write only via system.
- `job_log`: read for admin; write only via system.

## Search Integration

`job_log` should be searchable by default using collection search:

- `content`: `message`
- `metadata`: `jobName`, `level`, `jobRunId`
- Title expression can be `message` or `jobName`.

This enables:
- UI search over logs
- Filtering by job or severity

## API Surface (new `cms.jobs`)

### Examples

- `cms.jobs.syncDefinitions()` (upsert code defs -> DB)
- `cms.jobs.trigger(name, payload, options?)`
- `cms.jobs.enable(name) / disable(name)`
- `cms.jobs.updateSchedule(name, { cron, intervalSeconds })`
- `cms.jobs.list()` / `cms.jobs.listRuns()` / `cms.jobs.listLogs()`

### Separation of Responsibility

- `cms.queue.*` remains the transport API (publish/schedule).
- `cms.jobs.*` is the control plane and management API.

## Runtime Config

Suggested new config block (runtime only):

```ts
build({
  queue: { adapter: pgBossAdapter(...) },
  jobs: {
    schedulerCron: "*/1 * * * *",
    schedulerJobName: "questpie-scheduler-tick",
  },
})
```

If omitted, default cron is every minute.

## Relations (Optional)

If you want strict relations:

- `job_run` can store `jobId` (relation to `job.id`) in addition to `jobName`.
- `job_log` can store `jobRunId` (relation to `job_run.id`).

This is optional but enables richer joins in admin UI.

## Admin UI

Because these are collections, users can:

- Override access rules (admin-only or custom roles).
- Extend fields (tags, team, SLAs, etc.).
- Use built-in admin search to filter logs and runs.

## Backwards Compatibility

- Existing `defineJob` and `cms.queue.*` remain valid.
- Jobs control plane only activates when jobs module is enabled.
- `cms.listenToJobs()` continues to function without scheduler.

## Testing Strategy

- Unit test: `computeNextRun` for cron/interval/init.
- Integration test: scheduler tick enqueues job run and writes `job_run`.
- Integration test: worker writes `job_run` and `job_log` and closes run on success/failure.

## Refactor Steps (Detailed)

1) **Define collections** for `job`, `job_run`, `job_log`, `job_lock`.
2) **Create jobs module** with migrations and `.use` integration.
3) **Add JobRegistry + JobService** (sync, trigger, schedule config).
4) **Add scheduler tick job** (cron via queue adapter).
5) **Add worker instrumentation** (create run, logs, error capture).
6) **Expose admin UI views** (optional initial defaults).

## Integration Touchpoints (Files)

- `packages/cms/src/server/integrated/queue/worker.ts` (wrap handler)
- `packages/cms/src/server/integrated/queue/types.ts` (extend JobDefinition metadata)
- `packages/cms/src/server/config/cms.ts` (register new jobs service)
- `packages/cms/src/server/config/qcms-builder.ts` (module include)
- `packages/cms/src/server/modules/jobs/*` (new module)

## Open Questions / Decisions

- Should scheduler tick job run every minute by default, or configurable?
- How to handle `init` strategy: boot hook or scheduler mode?
- Required log retention policy for `job_log` collection?

## Summary

This plan keeps the current queue system intact, but adds a robust control plane:

- Jobs are defined in code, configured in DB, scheduled via queue cron.
- Runs + logs are first-class collections, enabling admin UI + access control.
- Scheduler tick is distributed and provider-friendly.
