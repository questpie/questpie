import { index } from "drizzle-orm/pg-core";
import { collection } from "questpie";

/**
 * Workflow log — structured dual-output log entries.
 *
 * Every log call from a workflow handler writes here (queryable in admin)
 * AND to the external logger (Datadog, Grafana, etc.).
 */
export default collection("wf_log")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Parent workflow instance ID. */
		instanceId: f.text(255).required(),

		/** Log level. */
		level: f
			.select([
				{ value: "debug", label: "Debug" },
				{ value: "info", label: "Info" },
				{ value: "warn", label: "Warning" },
				{ value: "error", label: "Error" },
			])
			.required(),

		/** Log message. */
		message: f.textarea(),

		/** Structured log data (JSONB). */
		data: f.json(),

		/** Step name context (if logged within a step). */
		stepName: f.text(255),
	}))
	.indexes(({ table }) => [
		index("idx_wf_log_instance").on(table.instanceId as any),
	])
	.access({
		create: false,
		update: false,
		delete: false,
		read: false,
	})
	.set("admin", { hidden: true, audit: false });
