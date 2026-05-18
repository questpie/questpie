import { index } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const runs = collection("runs")
	.fields(({ f }) => ({
		task: f.relation("tasks").label({ en: "Task" }),
		project: f.relation("projects").label({ en: "Project" }),
		worker: f.relation("workers").label({ en: "Worker" }),
		status: f
			.select([
				{ value: "pending", label: { en: "Pending" } },
				{ value: "claimed", label: { en: "Claimed" } },
				{ value: "running", label: { en: "Running" } },
				{ value: "completed", label: { en: "Completed" } },
				{ value: "failed", label: { en: "Failed" } },
				{ value: "cancelled", label: { en: "Cancelled" } },
			])
			.required()
			.default("pending")
			.label({ en: "Status" }),
		runtime: f
			.select([
				{ value: "claude-code", label: { en: "Claude Code" } },
				{ value: "codex", label: { en: "Codex" } },
				{ value: "opencode", label: { en: "OpenCode" } },
			])
			.label({ en: "Runtime" }),
		provider: f.relation("providers").label({ en: "Provider" }),
		model: f.relation("models").label({ en: "Model" }),
		capability: f.relation("capabilities").label({ en: "Capability" }),
		initiatedBy: f
			.select([
				{ value: "chat", label: { en: "Chat" } },
				{ value: "task", label: { en: "Task" } },
				{ value: "schedule", label: { en: "Schedule" } },
				{ value: "workflow", label: { en: "Automation" } },
				{ value: "manual", label: { en: "Manual" } },
				{ value: "mcp", label: { en: "MCP" } },
			])
			.label({ en: "Started By" }),
		instructions: f.textarea().label({ en: "Instructions" }),
		summary: f.textarea().label({ en: "Summary" }),
		error: f.textarea().label({ en: "Error" }),
		tokensInput: f.number().label({ en: "Tokens Input" }),
		tokensOutput: f.number().label({ en: "Tokens Output" }),
		startedAt: f.datetime().label({ en: "Started At" }),
		endedAt: f.datetime().label({ en: "Ended At" }),
		runtimeSessionRef: f.text().label({ en: "Runtime Session" }),
		resumedFromRun: f.relation("runs").label({ en: "Resumed From" }),
		preferredWorker: f.relation("workers").label({ en: "Preferred Device" }),
		resumable: f.boolean().default(false).label({ en: "Resumable" }),
		targeting: f.json().label({ en: "Targeting" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.summary)
	.admin(({ c }) => ({
		label: { en: "Executions" },
		icon: c.icon("ph:play"),
		hidden: true,
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.task, f.status, f.project, f.worker, f.startedAt, f.endedAt],
			searchable: [f.instructions, f.summary, f.error],
			filterable: [f.status, f.project, f.worker, f.initiatedBy],
			defaultSort: { field: f.startedAt, direction: "desc" },
		}),
	)
	.indexes(({ table }) => [
		index("runs_status_idx").on(table.status as any),
		index("runs_worker_idx").on(table.worker as any),
		index("runs_task_idx").on(table.task as any),
		index("runs_project_idx").on(table.project as any),
		index("runs_runtime_idx").on(table.runtime as any),
	]);
