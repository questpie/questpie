import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const scheduleExecutions = collection("schedule_executions")
	.fields(({ f }) => ({
		schedule: f.relation("schedules").label({ en: "Schedule" }).required(),
		task: f.relation("tasks").label({ en: "Task" }),
		chatSession: f.relation("chat_sessions").label({ en: "Chat Session" }),
		status: f
			.select([
				{ value: "triggered", label: { en: "Triggered" } },
				{ value: "skipped", label: { en: "Skipped" } },
				{ value: "failed", label: { en: "Failed" } },
			])
			.label({ en: "Status" })
			.default("triggered"),
		skipReason: f.text().label({ en: "Skip Reason" }),
		error: f.textarea().label({ en: "Error" }),
		triggeredAt: f.datetime().label({ en: "Triggered At" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.set("admin", { hidden: true, audit: false })
	.indexes(({ table }) => [
		index("schedule_executions_schedule_idx").on(table.schedule as any),
	]);
