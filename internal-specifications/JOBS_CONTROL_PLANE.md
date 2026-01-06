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
	runOnce?: boolean; // For init strategy: run only once ever
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
- `deletedFromCode` (boolean, default false, set when job no longer exists in code)
- `retentionDays` (number, optional, for runs/logs cleanup)
- `retentionCount` (number, optional, keep last N runs)
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
- `triggeredBy` (json: `{ type: "scheduler" | "manual" | "hook", userId?: string, hookName?: string }`)
- `createdAt`

### `job_log` collection (log stream + search)

- `jobName` (string, indexed)
- `jobRunId` (relation to job_run)
- `level` (enum: `debug | info | warn | error`)
- `message` (string, full-text search)
- `meta` (json)
- `sequence` (number, optional)
- `createdAt`

**Index strategy:**
- Compound index on `(jobName, createdAt)` for efficient filtering + time-range queries
- Compound index on `(jobRunId, sequence)` for ordered log retrieval
- Full-text index on `message` for search

**Performance considerations:**
- Logs are written via **batch insert** using native Drizzle table (`job_log_collection.table`)
- Buffer up to 100 log lines or flush every 5 seconds
- Bypass collection API for write performance
- Read via collection API for access control + search

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
- Mark jobs as `deletedFromCode` when definition no longer exists.

Sync rules:
- If job not present, insert with defaults.
- If job exists, update only safe fields (`description`, `tags`, `definitionHash`) unless `force=true`.
- Respect user overrides for schedule and enablement.
- If code definition is removed, set `deletedFromCode=true` (keep strategy for audit/UI info).

Pseudocode:

```
codeJobNames = set of job names from definitions
dbJobs = all jobs from DB

for each jobDef:
  hash = hash(jobDef.name + jobDef.meta + jobDef.schema)
  record = find job by name
  if !record:
    insert with defaults from meta, deletedFromCode=false
  else if record.definitionHash != hash:
    update definitionHash, description, tags, deletedFromCode=false

for each dbJob not in codeJobNames:
  update dbJob.deletedFromCode = true
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
  jobs = select job where enabled and due(now) and !deletedFromCode
  for each job:
    if maxConcurrency reached => skip
    create job_run(status="queued", scheduledFor=job.nextRunAt, triggeredBy={type:"scheduler"})
    queue.publish(job.name, payload, { singletonKey, retry overrides })
    update job.lastRunAt = now
    update job.nextRunAt = computeNextRun(job, now)
  release lock
```

### MaxConcurrency Enforcement

To prevent race conditions in distributed scheduler:

**Option 1: Count active runs (simple)**
```ts
const activeRuns = await db.select().from(jobRuns)
  .where(and(
    eq(jobRuns.jobName, job.name),
    eq(jobRuns.status, "running")
  ))
  .count();

if (activeRuns >= job.maxConcurrency) {
  skip;
}
```

**Option 2: Atomic counter (recommended for high concurrency)**
```ts
// Add to job collection:
activeRunCount: integer("active_run_count").default(0)

// On job start (in worker):
await db.update(job).set({ activeRunCount: sql`active_run_count + 1` });

// On job finish:
await db.update(job).set({ activeRunCount: sql`active_run_count - 1` });

// Scheduler check:
if (job.activeRunCount >= job.maxConcurrency) skip;
```

**Option 3: Queue adapter singleton key**
- Use `singletonKey` based on job name (pg-boss native support)
- Limits to 1 instance per key, but less flexible than per-job config

### Due Selection (examples)

- `strategy=cron`: compute next run time; if `nextRunAt <= now` and enabled.
- `strategy=interval`: `lastRunAt + intervalSeconds <= now`.
- `strategy=init`: run once on boot/sync if `meta.runOnce=true` and never completed before.
- `strategy=event`: run is created by event hook, not scheduler.

### Locking

- Use `singletonKey` when publish supports it (pg-boss).
- Optional `job_lock` for cross-worker scheduler tick safety.

## Next Run Computation

We need a reliable `computeNextRun`:

- For `cron`: use a small cron parser (or queue adapter helper if exposed).
- For `interval`: `now + intervalSeconds`.
- For `init`: if `meta.runOnce=true`, set `nextRunAt` to `now` on first sync, then set to `null` after success.

If cron parsing is added, keep dependency pinned in `DEPENDENCIES.md`.

## Event Strategy

`strategy=event` is triggered by CMS hooks, not scheduler:

- Collection hooks call `cms.jobs.trigger("job-name", payload, { triggeredBy: { type: "hook", hookName: "afterChange", operation: 'create', collection: 'collectionName' } })` // this should maybe run from context ?po.
- Event jobs are still audited in `job_run` and `job_log`.
- `triggeredBy` metadata captures hook context for debugging.

## Retention and Cleanup

Provide system jobs with configurable strategies (similar to Bull):

### Time-based retention
- `questpie-prune-job-runs`: delete runs older than `job.retentionDays` (default 30 days).
- `questpie-prune-job-logs`: delete logs older than `job.retentionDays` (default 7 days).

### Count-based retention
- Keep last N runs: delete runs where `job_run.createdAt` is older than Nth newest for that job.
- Use `job.retentionCount` (e.g., keep last 100 runs).

### Implementation
```ts
// Cleanup job runs (time-based)
DELETE FROM job_run 
WHERE job_name = ? 
  AND finished_at < NOW() - INTERVAL '? days'
  AND status IN ('success', 'failed');

// Cleanup job runs (count-based)
DELETE FROM job_run
WHERE id NOT IN (
  SELECT id FROM job_run
  WHERE job_name = ?
  ORDER BY created_at DESC
  LIMIT ?
);

// Cleanup orphaned logs
DELETE FROM job_log
WHERE job_run_id NOT IN (SELECT id FROM job_run);
```

Both cleanup jobs run as scheduled system jobs (e.g., daily at 2 AM).

Use `job.retentionDays` or global defaults to configure retention.

## RequestContext Enrichment

`RequestContext` already allows extensions. Jobs should set:

```ts
export interface JobExecutionContext {
	name: string;
	runId: string;
	attempt: number;
	scheduledFor?: Date;
	triggeredBy: { type: "scheduler" | "manual" | "hook"; hookName?: string; userId?: string };
}

export interface JobRequestContext extends RequestContext {
	job: JobExecutionContext;
	logger: JobLogger;
}
```

Handlers can then use `context.logger` for structured job logs and `context.job` for execution metadata.

## Log Ingestion Strategy

Two-layer logging:

1) **Runtime logger** via `cms.logger` (stdout or external sink).
2) **Persisted logs** via `job_log` collection for UI + search.

Implementation idea:
- Create `JobLogger` that writes to both `cms.logger` and in-memory buffer.
- Batch flush to `job_log` using native Drizzle table (`jobLogsCollection.table`):
  - Buffer up to 100 log entries or flush every 5 seconds.
  - Bypass collection API for write performance (direct INSERT).
- Reading logs uses collection API for access control + search.
- Keep log payload small; store large blobs in `meta` or external storage.

Example:
```ts
class JobLogger {
	private buffer: LogEntry[] = [];
	private flushTimer: Timer;

	log(level, message, meta) {
		cms.logger[level](message, meta); // Real-time stdout
		this.buffer.push({ level, message, meta, sequence: this.buffer.length });
		if (this.buffer.length >= 100) this.flush();
	}

	async flush() {
		if (this.buffer.length === 0) return;
		await db.insert(jobLogsCollection.table).values(this.buffer);
		this.buffer = [];
	}
}
```

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

### Unit Tests
- `computeNextRun` for cron/interval/init strategies (edge cases: DST, leap seconds, timezone changes).
- `JobRegistry.sync` deletion detection and hash updates.
- `JobLogger` buffer flushing (100 entries, 5 second timeout).

### Integration Tests
- **Scheduler tick**: enqueues job run, writes `job_run` with `status=queued`, updates `lastRunAt`/`nextRunAt`.
- **Worker execution**: creates run, writes logs via batch, updates run status on success/failure.
- **MaxConcurrency**: multiple workers respect concurrency limit (use atomic counter test).
- **Event triggers**: hook creates job run with correct `triggeredBy` metadata.
- **Retention cleanup**: time-based and count-based pruning work correctly.

### Failure Scenarios
- **Transaction rollback**: if worker fails after creating run but before queue publish, run status is `queued` (eventually timeout).
- **Concurrent scheduler ticks**: distributed lock prevents duplicate enqueues.
- **Queue adapter failure**: if `queue.publish` fails after `job_run` create, run stays `queued` (manual retry or timeout).
- **Log buffer loss**: on worker crash, buffered logs are lost (acceptable trade-off for performance).

### Adapter Compatibility
- Test with pg-boss adapter (current).
- Verify scheduler tick works with queue adapter cron.
- Test singleton key behavior for maxConcurrency.

## Refactor Steps (Detailed)

1) **Define collections** for `job`, `job_run`, `job_log`, `job_lock`.
   - Add compound indexes for `job_log` (`jobName + createdAt`, `jobRunId + sequence`).
   - Add `deletedFromCode`, `retentionCount` to `job` schema.
2) **Create jobs module** with migrations and `.use` integration.
3) **Add JobRegistry + JobService** (sync with deletion detection, trigger with `triggeredBy`, schedule config).
4) **Add scheduler tick job** (cron via queue adapter).
   - Implement maxConcurrency enforcement (atomic counter or count query).
5) **Add worker instrumentation** (create run, batch log buffer, error capture, `triggeredBy` tracking).
6) **Implement cleanup jobs** (time-based and count-based retention).
7) **Add `JobLogger` with batch insert** via native Drizzle table.
8) **Expose admin UI views** (optional initial defaults).

## Integration Touchpoints (Files)

- `packages/cms/src/server/integrated/queue/worker.ts` (wrap handler)
- `packages/cms/src/server/integrated/queue/types.ts` (extend JobDefinition metadata)
- `packages/cms/src/server/config/cms.ts` (register new jobs service)
- `packages/cms/src/server/config/qcms-builder.ts` (module include)
- `packages/cms/src/server/modules/jobs/*` (new module)

## Open Questions / Decisions

- Should scheduler tick job run every minute by default, or configurable?
- How to handle `init` strategy: boot hook or scheduler mode? → **Decided: `meta.runOnce=true` + scheduler check**
- Required log retention policy for `job_log` collection? → **Decided: configurable via `retentionDays` and `retentionCount`**
- MaxConcurrency: count query or atomic counter? → **Decided: atomic counter for performance**
- Cron parsing library? → **Pin in DEPENDENCIES.md** (e.g., `cron-parser` or queue adapter native)

## Additional Improvements

### Job Dependencies (Future)
- Allow jobs to depend on other jobs (DAG execution).
- Store as `dependencies: string[]` in `job` collection.
- Scheduler checks if all dependencies completed successfully before enqueue.

### Job Timeouts (Future)
- Add `timeoutSeconds` to job config.
- Worker wraps handler in timeout promise.
- On timeout, mark run as `failed` with error `Job exceeded timeout of Xs`.

### Job Priority (Future)
- Add `priority` field to `job` collection.
- Pass priority to queue adapter on publish.
- Scheduler sorts by priority when enqueuing.

### Dead Letter Queue
- Add `dlq` collection for failed jobs that exceeded retry limit.
- Allows manual inspection and re-trigger from UI.

## Summary

This plan keeps the current queue system intact, but adds a robust control plane:

- Jobs are defined in code, configured in DB, scheduled via queue cron.
- Runs + logs are first-class collections, enabling admin UI + access control.
- Scheduler tick is distributed and provider-friendly.
- Cleanup strategies (time + count-based) keep DB size manageable.
- Batch logging via native Drizzle table bypasses collection overhead.
- `deletedFromCode` flag provides audit trail for removed jobs.
- **Breaking change is acceptable** - this is a major feature addition.
