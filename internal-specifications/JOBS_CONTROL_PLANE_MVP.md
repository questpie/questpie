# Jobs Control Plane - MVP (Phase 1)

**Goal**: Minimal viable jobs system that leverages queue adapter capabilities and avoids redundant abstractions.

## Philosophy

- **Queue adapter (pg-boss/bullmq) is the source of truth** for scheduling, retry, concurrency, locking.
- **Code is the source of truth** for job definitions, handlers, and default configuration.
- **DB collections are optional enhancements** for audit trail and admin UI visibility.
- **No dual configuration** - don't configure the same thing in code and DB.

## What Queue Adapter Already Provides

### pg-boss / bullmq Built-ins:
- ✅ Cron scheduling (`options.cron`)
- ✅ Retry logic with backoff
- ✅ Priority queues
- ✅ Concurrency control (`teamSize`, singleton keys)
- ✅ Distributed locking
- ✅ Job metadata (attempt, queuedAt, priority)
- ✅ Job lifecycle hooks (onComplete, onFailed)
- ✅ Native monitoring/introspection

**Conclusion**: Don't rebuild what the queue adapter already does well.

## Module Structure

Jobs control plane is a **custom module** in `packages/cms`:

```
packages/cms/src/server/modules/jobs/
  index.ts                    # Module exports
  jobs.module.ts              # Module definition
  collections/
    job-runs.collection.ts    # job_run collection
  functions/
    trigger-job.function.ts   # Admin UI trigger function
  services/
    jobs.service.ts           # cms.jobs.trigger() implementation
```

**Module creation**:
```ts
// jobs.module.ts
import { defineQCMS } from "#questpie/cms/server";
import { jobRunsCollection } from "./collections/job-runs.collection";
import { triggerJobFunction } from "./functions/trigger-job.function";

export const jobsModule = defineQCMS({ name: "jobs-control-plane" })
  .collections({
    jobRun: jobRunsCollection,
  })
  .functions({
    triggerJob: triggerJobFunction,
  });
```

**Usage in main CMS**:
```ts
// In your CMS definition
import { jobsModule } from "@questpie/cms/server/modules/jobs";

const cms = defineQCMS({ name: "my-cms" })
  .use(jobsModule) // is by default included in core
  .jobs({
    sendWelcomeEmail,
    // ... other jobs
  });
```

## Phase 1 Scope (MVP)

### 1. Code-First Job Definitions ✅

Keep existing `defineJob` pattern - this is good:

```ts
export const sendWelcomeEmail = defineJob({
  name: "send-welcome-email",
  schema: z.object({ userId: z.string() }),
  handler: async (payload, ctx) => {
    // ...
  },
  options: {
    retryLimit: 3,
    retryDelay: 60,
    priority: 5,
    cron: "0 9 * * *", // Daily at 9am - queue adapter schedules it
  },
});
```

**No changes needed** - queue adapter handles scheduling from `options.cron`.

### 2. Job Run Collection (For Admin UI Trigger)

**Use case**: Trigger jobs from admin UI + show execution history with queue wait times.

**Minimal schema**:

```ts
export const jobRunsCollection = defineCollection("job_run")
  .options({ timestamps: true })
  .fields({
    jobName: varchar("job_name", { length: 120 }).notNull(),
    status: varchar("status", { length: 24 }).notNull(), // queued | running | success | failed
    queuedAt: timestamp("queued_at", { mode: "date" }), // When job was requested
    startedAt: timestamp("started_at", { mode: "date" }), // When worker picked it up
    finishedAt: timestamp("finished_at", { mode: "date" }),
    error: text("error"),
    payload: jsonb("payload"), // Store input for debugging/retry
    queueJobId: varchar("queue_job_id", { length: 100 }), // Link to pg-boss job
    workerId: varchar("worker_id", { length: 100 }), // Process ID for multi-worker safety
  })
  .indexes(({ table }) => [
    sql`create index on ${table} (job_name, created_at desc)`,
  ]);
```

**Flow for manual trigger (Admin UI or API)**:

```ts
// 1. Create run record with "queued" status
const run = await cms.db.insert(jobRuns).values({
  jobName: "send-welcome-email",
  status: "queued",
  queuedAt: new Date(),
  payload: { userId: "123" },
}).returning();

// 2. Enqueue to transport layer
const queueJobId = await cms.queue.publish("send-welcome-email", { userId: "123" });

// 3. Update run with queue job ID
await cms.db.update(jobRuns).set({ queueJobId }).where(eq(jobRuns.id, run.id));
```

**Flow in worker**:

```ts
// Generate unique worker ID (portable across containers/serverless)
const WORKER_ID = crypto.randomUUID();

// In worker.ts
await adapter.work(jobDef.name, async (job) => {
  // Find existing run record (if triggered via admin) or create new one (if via cron)
  let run = await findRunByQueueJobId(job.id);
  if (!run) {
    run = await createJobRun({ 
      jobName: jobDef.name, 
      status: "queued", 
      queuedAt: new Date(),
      payload: job.data,
      queueJobId: job.id,
    });
  }
  
  // Update to running with worker ID for multi-instance safety
  await updateJobRun(run.id, { 
    status: "running", 
    startedAt: new Date(),
    workerId: WORKER_ID // Track which process is executing
  });
  
  try {
    await jobDef.handler(job.data, context);
    await updateJobRun(run.id, { status: "success", finishedAt: new Date() });
  } catch (error) {
    await updateJobRun(run.id, { status: "failed", finishedAt: new Date(), error: error.message });
    throw error;
  }
});
```

**Note**: If you don't need admin UI trigger, you can skip job_run collection entirely. Queue adapter has its own tables.

### 3. Manual Trigger API

Two options depending on whether you use job_run collection:

**Option A: Direct queue (no audit)**
```ts
// Simple wrapper over queue.publish()
await cms.queue.publish("send-welcome-email", { userId: "123" });
```

**Option B: With audit trail (for admin UI)**
```ts
// Create run record + enqueue
cms.jobs.trigger = async (name: string, payload: any, options?: PublishOptions) => {
  // 1. Create run record
  const run = await cms.db.insert(jobRuns).values({
    jobName: name,
    status: "queued",
    queuedAt: new Date(),
    payload,
  }).returning();
  
  // 2. Enqueue to transport
  const queueJobId = await cms.queue.publish(name, payload, options);
  
  // 3. Link queue job to run record
  await cms.db.update(jobRuns).set({ queueJobId }).where(eq(jobRuns.id, run.id));
  
  return run.id;
};
```

**Admin UI function (using defineFunction)**:
```ts
// packages/cms/src/server/modules/jobs/functions/trigger-job.ts
import { defineFunction } from "#questpie/cms/server/functions";
import { z } from "zod";

export const triggerJobFunction = defineFunction({
  name: "trigger-job",
  input: z.object({
    jobName: z.string(),
    payload: z.any(),
  }),
  output: z.object({
    runId: z.string(),
    status: z.literal("queued"),
  }),
  handler: async (input, ctx) => {
    const runId = await ctx.cms.jobs.trigger(input.jobName, input.payload);
    return { runId, status: "queued" };
  },
});
```

**Available via**: `POST /api/cms/functions/trigger-job`

### 4. Worker Registration + Schedule Initialization

`cms.listenToJobs()` should register both workers AND cron schedules on startup:

```ts
await cms.listenToJobs({
  teamSize: 10, // Concurrency per job
});
```

**What happens on startup**:
1. For each job with `options.cron`, call `queue.schedule(jobName, cron)` to ensure schedule is active
2. Register worker for each job to process enqueued tasks
3. Queue adapter deduplicates schedules (idempotent)

**Implementation**:
```ts
export async function startJobWorker(queueClient, jobs, createContext, options) {
  await queueClient._start();
  const adapter = queueClient._adapter;
  
  for (const [jobName, jobDef] of Object.entries(jobs)) {
    // 1. Register cron schedule if defined
    if (jobDef.options?.cron) {
      await adapter.schedule(jobDef.name, jobDef.options.cron, {});
      console.log(`[QUESTPIE Jobs] Scheduled ${jobDef.name}: ${jobDef.options.cron}`);
    }
    
    // 2. Register worker
    await adapter.work(jobDef.name, async (job) => {
      // ... handler execution
    });
    console.log(`[QUESTPIE Jobs] Worker registered for: ${jobDef.name}`);
  }
}
```

Queue adapter handles:
- Polling for jobs
- Cron execution (pg-boss/bullmq native)
- Retry logic
- Concurrency limits
- Schedule deduplication
- **Stalled job detection** (pg-boss has built-in expiration/retry)

**Reliability considerations (multi-worker safe)**:
```ts
// Generate unique worker ID (random UUID - portable across all environments)
const WORKER_ID = crypto.randomUUID();

// Alternative: Include hostname for debugging (if available)
// const WORKER_ID = `${os.hostname?.() || 'worker'}-${crypto.randomUUID()}`;

// 1. On worker startup - clean up orphaned runs from dead workers
export async function recoverStalledRuns(db: DB, currentWorkerId: string) {
  const stalledThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
  
  // Only mark jobs as failed if:
  // - They're still "running"
  // - Started more than 10 min ago
  // - workerId is NOT this worker (other workers may still be alive)
  await db.update(jobRuns)
    .set({ 
      status: "failed", 
      finishedAt: new Date(),
      error: `Worker crashed or timed out (stalled job recovery, was on ${jobRuns.workerId})`
    })
    .where(
      and(
        eq(jobRuns.status, "running"),
        lt(jobRuns.startedAt, stalledThreshold),
        ne(jobRuns.workerId, currentWorkerId) // Don't touch own jobs on restart
      )
    );
}

// 2. Graceful shutdown - mark ONLY this worker's jobs
process.on("SIGTERM", async () => {
  console.log(`[QUESTPIE Jobs] Graceful shutdown initiated for worker ${WORKER_ID}...`);
  
  // Only mark jobs belonging to THIS worker
  await db.update(jobRuns)
    .set({ 
      status: "failed",
      finishedAt: new Date(),
      error: `Worker shutdown (job interrupted on ${WORKER_ID})`
    })
    .where(
      and(
        eq(jobRuns.status, "running"),
        eq(jobRuns.workerId, WORKER_ID)
      )
    );
  
  process.exit(0);
});

// 3. In worker - set workerId when starting job
await adapter.work(jobDef.name, async (job) => {
  let run = await findRunByQueueJobId(job.id);
  if (!run) {
    run = await createJobRun({ 
      jobName: jobDef.name, 
      status: "queued",
      payload: job.data,
      queueJobId: job.id,
    });
  }
  
  // Update to running with THIS worker's ID
  await updateJobRun(run.id, { 
    status: "running", 
    startedAt: new Date(),
    workerId: WORKER_ID // Track which process is executing
  });
  
  // ... rest of handler
});

// 4. Transport layer retry still works independently
// pg-boss will retry the job, creating a new job_run with new workerId
```

**Important**: Queue adapter (pg-boss/bullmq) handles stalled jobs at transport level:
- pg-boss: `expireInSeconds` option + automatic retry
- bullmq: `lockDuration` + stalled job checker

Your DB `job_run` is audit only - transport layer is source of truth for execution state.

## What We're NOT Building

### ❌ Scheduler Tick Job
**Why**: Queue adapter already schedules cron jobs from `options.cron`. No need for DB-driven scheduler.

**Exception**: Only needed if you want runtime schedule changes without deploy. For MVP, redeploy to change schedule is fine.

### ❌ Job Configuration Collection
**Why**: Job config lives in code (`defineJob`). No dual configuration.

**Exception**: Only needed for multi-tenant SaaS where users configure their own job schedules.

### ❌ Job Logs Collection
**Why**: Use stdout logs + external tool (Loki, Datadog, CloudWatch). Queue adapters also have built-in logging.

**Exception**: Only if you need searchable logs in admin UI.

### ❌ Job Registry / Sync
**Why**: No DB config to sync. Code is the source of truth.

**Exception**: Only if you add job config collection (not in MVP).

### ❌ Job Locks Collection
**Why**: Queue adapter has distributed locking (pg-boss singleton keys, bullmq locking).

### ❌ Retention / Cleanup Jobs
**Why**: Manual DB cleanup is fine for MVP. Queue adapters auto-clean old jobs.

**Exception**: Only if job_run table grows too large.

### ❌ Event Strategy / Hooks
**Why**: Manual trigger is sufficient. Call `cms.queue.publish()` from collection hooks if needed.

### ❌ MaxConcurrency in DB
**Why**: Queue adapter `teamSize` option handles this.

### ❌ Enable/Disable in DB
**Why**: Use feature flags in code or environment variables.

```ts
// In code
export const myJob = defineJob({
  name: "my-job",
  enabled: process.env.ENABLE_MY_JOB === "true", // Runtime config
  // ...
});
```

## Architecture Diagram (MVP)

```
┌─────────────────────────────────────────────────────────────┐
│                     Code (Source of Truth)                   │
│  defineJob({ name, handler, options: { cron, retry } })     │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Queue Adapter (pg-boss / bullmq)               │
│  • Scheduling (from options.cron)                           │
│  • Retry logic                                              │
│  • Concurrency (teamSize)                                   │
│  • Distributed locking                                      │
│  • Job metadata                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                 Worker (cms.listenToJobs)                   │
│  • Registers cron schedules on startup                      │
│  • Executes handlers                                        │
│  • [Optional] Writes to job_run collection for audit       │
└─────────────────────────────────────────────────────────────┘
                         ▲
                         │
                         │ (optional trigger)
┌─────────────────────────────────────────────────────────────┐
│              Jobs Control Plane Module (optional)           │
│  • job_run collection (audit + admin UI)                   │
│  • triggerJob function (admin UI → queue)                  │
│  • cms.jobs.trigger() service                               │
└─────────────────────────────────────────────────────────────┘
```

**No scheduler tick. No DB-driven config. Simple.**
**Jobs module is optional** - only needed for admin UI trigger + audit.

## Implementation Steps

### Step 0: Decide if you need Jobs Module
**Skip jobs module entirely if**:
- You only need cron schedules (use `options.cron`)
- You don't need admin UI trigger
- You're OK with queue adapter's built-in monitoring

**Use jobs module if**:
- You want admin UI to trigger jobs
- You want audit trail in CMS collections
- You want job history searchable in admin UI

### Step 1: Add Job Run Collection (If using jobs module)
- Create `job_run` collection with `queued | running | success | failed` status
- Add `queuedAt`, `startedAt`, `finishedAt` timestamps
- Add `queueJobId` to link with transport layer

### Step 2: Instrument Worker + Schedule Registration + Recovery
- **On startup**: Run stalled job recovery (mark stuck "running" jobs as "failed")
- **On startup**: Register cron schedules from `options.cron` with queue adapter
- **In worker handler**: Find or create run record at start
- **In worker handler**: Update status: `queued` → `running` → `success`/`failed`
- **On graceful shutdown**: Mark in-progress runs as "interrupted"
- Handle errors gracefully (audit write failure shouldn't crash job)

### Step 3: Add Trigger API
```ts
// In cms.ts
class QCMS {
  // ...
  get jobs() {
    return {
      trigger: async (name: string, payload: any, options?: PublishOptions) => {
        // Create run record with "queued" status
        const run = await this.db.insert(jobRuns).values({
          joAdd Reliability Checks
```ts
// On worker startup
export async function startJobWorker(...) {
  // 1. Recover stalled runs from previous crashes
  await recoverStalledRuns(cms.db);
  
  // 2. Setup graceful shutdown
  process.on("SIGTERM", () => handleGracefulShutdown(cms.db));
  process.on("SIGINT", () => handleGracefulShutdown(cms.db));
  
  // 3. Start workers and register schedules
  // ... existing code
}
```

### Step 6: Done
That's it. Simple flow: Admin UI → Create run → Enqueue → Worker updates status.

**Crash recovery**: Stalled jobs are marked as failed on next worker startup
          queuedAt: new Date(),
          payload,
        }).returning();
        
        // Enqueue to transport
        const queueJobId = await this.queue.publish(name, payload, options);
        
        // Link queue job to run record
        await this.db.update(jobRuns)
          .set({ queueJobId })
          .where(eq(jobRuns.id, run.id));
        
        return run.id;
      },
    };
  }
}
```

### Step 4: Add Trigger Function (Optional)
```ts
// functions/trigger-job.function.ts
export const triggerJobFunction = defineFunction({
  name: "trigger-job",
  input: z.object({
    jobName: z.string(),
    payload: z.any(),
  }),
  output: z.object({
    runId: z.string(),
    status: z.literal("queued"),
  }),
  handler: async (input, ctx) => {
    const runId = await ctx.cms.jobs.trigger(input.jobName, input.payload);
    return { runId, status: "queued" };
  },
});

// Register in module
export const jobsModule = defineQCMS({ name: "jobs-control-plane" })
  .collections({ jobRun: jobRunsCollection })
  .functions({ triggerJob: triggerJobFunction });
```

**Available via**: `POST /api/cms/functions/trigger-job`

### Step 5: Done
That's it. Simple flow: Admin UI → Create run → Enqueue → Worker updates status.

## When to Add More Features

### Scenario 1: Need Runtime Schedule Changes
- Add `job` collection with `cron`, `enabled` fields
- Add scheduler tick job that reads DB and enqueues
- Sync code definitions to DB on boot

### Scenario 2: Need Searchable Logs
- Add `job_log` collection
- Stream logs from handler context
- Add search indexes

### Scenario 3: Multi-Tenant SaaS
- Add per-tenant job configs
- Add user-facing job management UI
- Add event-driven job triggers
 Your `job_run` table will show final status after all retries exhausted.

**Q: What happens if worker crashes mid-job?**
A: Transport layer (pg-boss/bullmq) detects stalled jobs and retries them. On next worker startup, `recoverStalledRuns()` marks orphaned DB records as failed (only for stalled workers, not current worker). Job will be re-executed by transport layer retry.

**Q: Can I run multiple worker processes?**
A: Yes! Each worker gets unique `workerId` (hostname + PID). Graceful shutdown only affects that worker's jobs. Recovery logic checks workerId to avoid marking jobs from other live workers.

**Q: Can I run multiple worker processes?**
A: Yes! Each worker gets unique `workerId` (hostname + PID). Graceful shutdown only affects that worker's jobs. Recovery logic checks workerId to avoid marking jobs from other live workers.
**But for internal CMS MVP**: Current simple approach is sufficient.

## FAQ

**Q: How do I enable/disable a job without deploy?**
A: Use environment variables or feature flags. Redeploy to change config.

**Q: How do I see job execution history?**
A: Option 1: Check queue adapter dashboard (pg-boss has web UI). Option 2: Add job_run collection.

**Q: How do I schedule jobs at runtime?**
A: For MVP, use `options.cron` in code. `cms.listenToJobs()` will register the schedule on startup. For dynamic schedules, use `queue.schedule()` with explicit date.

**Q: What happens if I change a cron schedule?**
A: Redeploy the worker. On startup, `cms.listenToJobs()` will re-register the schedule (queue adapter updates it).

**Q: How do I handle job failures?**
A: Queue adapter retry logic handles it. Check adapter logs or dashboard.

**Q: How do I limit concurrency per job?**
A: Use `teamSize` option in `listenToJobs()` or queue adapter config.

**Q: Can I trigger jobs manually?**
A: Yes. Option 1: Direct `cms.queue.publish(jobName, payload)` (no audit). Option 2: Use `cms.jobs.trigger()` which creates job_run record first (with audit + admin UI support).

## Summary

**Phase 1 is about NOT building things:**
- ❌ No DB-driven scheduler (queue adapter has cron)
- ❌ No job config collection (code is source of truth)
- ❌ No logs collection (use external tools)
- ❌ No registry sync (nothing to sync)
- ✅ Job_run collection with `queued` status (for admin UI trigger + audit)
- ✅ Keep existing defineJob + listenToJobs
- ✅ Simple trigger API that creates run record before enqueue

**Result**: Minimal code, maximum leverage of queue adapter capabilities, no redundant abstractions.
3-5 hours (job_run collection + worker wrap + trigger API + reliability).

Compare to original spec: ~40+ hours saved.

**Reliability approach**: Lean on transport layer for execution reliability (retry, stalled detection). DB audit is reconciled on worker startup
**Total implementation effort**: 2-4 hours (job_run collection + worker wrap + trigger API).

Compare to original spec: ~40+ hours saved.
