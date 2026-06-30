import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const runLinks = collection("run_links")
	.fields(({ f }) => ({
		legacyRunId: f.text().label({ en: "Legacy Run ID" }),
		aiRun: f.relation("ai_runs").label({ en: "AI Run" }),
		worker: f.relation("ai_workers").label({ en: "Worker" }),
		task: f.relation("tasks").label({ en: "Task" }),
		project: f.relation("projects").label({ en: "Project" }),
		workflowInstanceId: f.text().label({ en: "Workflow Instance" }),
		schedule: f.relation("schedules").label({ en: "Schedule" }),
		scheduleExecution: f
			.relation("schedule_executions")
			.label({ en: "Schedule Execution" }),
		chatSession: f.relation("chat_sessions").label({ en: "Chat Session" }),
		chatMessage: f.relation("chat_messages").label({ en: "Chat Message" }),
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
		kind: f
			.select([
				{ value: "chat", label: { en: "Chat" } },
				{ value: "task", label: { en: "Task" } },
				{ value: "schedule", label: { en: "Schedule" } },
				{ value: "workflow", label: { en: "Automation" } },
				{ value: "mcp", label: { en: "MCP" } },
				{ value: "manual", label: { en: "Manual" } },
			])
			.label({ en: "Kind" }),
		provider: f.relation("providers").label({ en: "Provider" }),
		model: f.relation("models").label({ en: "Model" }),
		runtime: f
			.select([
				{ value: "claude-code", label: { en: "Claude Code" } },
				{ value: "codex", label: { en: "Codex" } },
			])
			.label({ en: "Runtime" }),
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
		instructions: f.textarea().label({ en: "Instructions" }),
		summary: f.textarea().label({ en: "Summary" }),
		error: f.textarea().label({ en: "Error" }),
		tokensInput: f.number().label({ en: "Tokens Input" }),
		tokensOutput: f.number().label({ en: "Tokens Output" }),
		cost: f.number().label({ en: "Cost" }),
		startedAt: f.datetime().label({ en: "Started At" }),
		endedAt: f.datetime().label({ en: "Ended At" }),
		finalizedAt: f.datetime().label({ en: "Finalized At" }),
		retryPolicy: f
			.select([
				{ value: "none", label: { en: "None" } },
				{ value: "auto", label: { en: "Auto" } },
			])
			.default("none")
			.label({ en: "Retry Policy" }),
		runtimeSessionRef: f.text().label({ en: "Runtime Session" }),
		resumedFromRun: f.relation("run_links").label({ en: "Resumed From" }),
		resumable: f.boolean().default(false).label({ en: "Resumable" }),
		activeStreamId: f.text().label({ en: "Active Stream ID" }),
		harnessSessionId: f.text().label({ en: "Harness Session ID" }),
		harnessResumeState: f.json().label({ en: "Harness Resume State" }),
		uiMessages: f.json().label({ en: "UI Messages" }),
		producerLease: f.json().label({ en: "Producer Lease" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.summary)
	.admin(({ c }) => ({
		label: { en: "Executions" },
		icon: c.icon("ph:play"),
		hidden: true,
		audit: false,
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.task, f.status, f.project, f.runtime, f.startedAt, f.endedAt],
			searchable: [f.instructions, f.summary, f.error],
			filterable: [f.status, f.project, f.runtime, f.initiatedBy],
			defaultSort: { field: f.startedAt, direction: "desc" },
		}),
	)
	.indexes(({ table }) => [
		uniqueIndex("run_links_legacy_run_id_idx").on(table.legacyRunId as any),
		index("run_links_ai_run_idx").on(table.aiRun as any),
		index("run_links_status_idx").on(table.status as any),
		index("run_links_task_idx").on(table.task as any),
		index("run_links_project_idx").on(table.project as any),
		index("run_links_schedule_execution_idx").on(
			table.scheduleExecution as any,
		),
		index("run_links_chat_message_idx").on(table.chatMessage as any),
		index("run_links_resumed_from_run_idx").on(table.resumedFromRun as any),
		index("run_links_worker_idx").on(table.worker as any),
		// Partial index for the cheap oldest-pending candidate scan in claimRun.
		index("run_links_pending_idx")
			.on(table.createdAt as any)
			.where(sql`"status" = 'pending'`),
	]);
