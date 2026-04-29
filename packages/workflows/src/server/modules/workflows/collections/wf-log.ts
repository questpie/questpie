import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

/**
 * Workflow Log Collection
 *
 * Stores structured log entries for workflow execution.
 * Dual output: each entry also goes to the external logger.
 * Batch-inserted per step to minimize DB round trips.
 */
export const wfLogCollection = collection("wf_log")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Parent workflow instance ID. */
		instanceId: f.text(255).required(),
		/** Step name (null for workflow-level logs). */
		stepName: f.text(255),
		/** Log level: debug|info|warn|error|system. */
		level: f.text(20).required(),
		/** Log message. */
		message: f.text().required(),
		/** Structured context data (JSON). */
		data: f.json(),
	}))
	.indexes(({ table }) => [index("idx_wfl_instance").on(table.instanceId)])
	.access({
		create: false,
		update: false,
		delete: false,
		read: false,
	})
	.set("admin", {
		hidden: true,
		audit: false,
	});
