import { defineCollection } from "#questpie/cms/exports/server.js";
import { index, jsonb, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const jobRunsCollection = defineCollection("job_run")
	.options({ timestamps: true })
	.fields({
		jobName: varchar("job_name", { length: 120 }).notNull(),
		status: varchar("status", { length: 24 }).notNull(),
		queuedAt: timestamp("queued_at", { mode: "date" }),
		startedAt: timestamp("started_at", { mode: "date" }),
		finishedAt: timestamp("finished_at", { mode: "date" }),
		error: text("error"),
		payload: jsonb("payload"),
		queueJobId: varchar("queue_job_id", { length: 100 }),
		workerId: varchar("worker_id", { length: 100 }),
	})
	.indexes(({ table }) => [
		index("job_name_created_at_idx").on(table.jobName, table.createdAt.desc()),
	]);
