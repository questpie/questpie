import { index } from "drizzle-orm/pg-core";
import { collection } from "questpie";

/**
 * Workflow step — caches step results for replay-based execution.
 *
 * Each row represents one step execution within a workflow instance.
 * On replay, completed steps return their cached result without re-executing.
 */
export default collection("wf_step")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Parent workflow instance ID. */
		instanceId: f.text(255).required(),

		/** Unique step name within the workflow handler. */
		stepName: f.text(255).required(),

		/** Step execution order (0-based). Used for non-determinism detection. */
		stepIndex: f.number().required(),

		/** Current step status. */
		status: f
			.select([
				{ value: "completed", label: "Completed" },
				{ value: "sleeping", label: "Sleeping" },
				{ value: "failed", label: "Failed" },
			])
			.required(),

		/** Cached step result (JSONB). Returned on replay. */
		result: f.json(),

		/** Error message if step failed. */
		error: f.textarea(),

		/** When a sleeping step should resume. */
		sleepUntil: f.datetime(),

		/** When the step finished executing. */
		completedAt: f.datetime(),
	}))
	.indexes(({ table }) => [
		index("idx_wf_step_instance").on(table.instanceId as any),
		index("idx_wf_step_instance_name").on(
			table.instanceId as any,
			table.stepName as any,
		),
		index("idx_wf_step_sleeping").on(table.sleepUntil as any),
	])
	.access({
		create: false,
		update: false,
		delete: false,
		read: false,
	})
	.set("admin", { hidden: true, audit: false });
