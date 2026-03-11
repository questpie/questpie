import { index } from "drizzle-orm/pg-core";
import { collection } from "questpie";

/**
 * Workflow event — structured event log for workflow lifecycle.
 *
 * System events are auto-recorded at each state transition.
 * Used for debugging, auditing, and the admin step timeline.
 */
export default collection("wf_event")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Parent workflow instance ID. */
		instanceId: f.text(255).required(),

		/** Event type. */
		type: f
			.select([
				{ value: "triggered", label: "Triggered" },
				{ value: "step_completed", label: "Step Completed" },
				{ value: "step_failed", label: "Step Failed" },
				{ value: "suspended", label: "Suspended" },
				{ value: "resumed", label: "Resumed" },
				{ value: "completed", label: "Completed" },
				{ value: "failed", label: "Failed" },
				{ value: "cancelled", label: "Cancelled" },
				{ value: "timed_out", label: "Timed Out" },
			])
			.required(),

		/** Related step name (if applicable). */
		stepName: f.text(255),

		/** Event-specific data (JSONB). */
		data: f.json(),
	}))
	.indexes(({ table }) => [
		index("idx_wf_event_instance").on(table.instanceId as any),
	])
	.access({
		create: false,
		update: false,
		delete: false,
		read: false,
	})
	.set("admin", { hidden: true, audit: false });
