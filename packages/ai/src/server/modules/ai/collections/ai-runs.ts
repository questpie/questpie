import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiRunsCollection = collection("ai_runs")
	.fields(({ f }) => ({
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
			])
			.label({ en: "Runtime" }),
		worker: f.relation("ai_workers").label({ en: "Worker" }),
		prompt: f.textarea().label({ en: "Prompt" }),
		summary: f.textarea().label({ en: "Summary" }),
		error: f.textarea().label({ en: "Error" }),
		runtimeSessionRef: f.text().label({ en: "Runtime Session Ref" }),
		tokensInput: f.number().label({ en: "Tokens Input" }),
		tokensOutput: f.number().label({ en: "Tokens Output" }),
		cost: f.number().label({ en: "Cost" }),
		startedAt: f.datetime().label({ en: "Started At" }),
		endedAt: f.datetime().label({ en: "Ended At" }),
		meta: f.json().label({ en: "Meta" }),
	}))
	.indexes(({ table }) => [
		index("ai_runs_status_idx").on(table.status as any),
		index("ai_runs_worker_idx").on(table.worker as any),
		index("ai_runs_runtime_idx").on(table.runtime as any),
	])
	.set("admin", {
		label: { en: "AI Runs" },
		icon: { type: "icon", props: { name: "ph:play" } },
	})
	.set("adminList", {
		view: "collection-table",
		showSearch: true,
		showFilters: true,
		showToolbar: true,
	});
