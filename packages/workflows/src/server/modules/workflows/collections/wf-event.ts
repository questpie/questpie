import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

/**
 * Workflow Event Collection
 *
 * Stores events emitted by workflows, hooks, or external sources.
 * Used for matching against `step.waitForEvent()` waiters via
 * JSONB containment queries.
 */
export const wfEventCollection = collection("wf_event")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Event name (e.g., "profile.completed"). */
		eventName: f.text(255).required(),
		/** Event data payload (JSON). */
		data: f.json(),
		/** JSONB match criteria for targeting specific waiters. */
		matchCriteria: f.json(),
		/** Source type: workflow|hook|external. */
		sourceType: f.text(50).required(),
		/** Source workflow instance ID (if from a workflow step). */
		sourceInstanceId: f.text(255),
		/** Source step name (if from a workflow step). */
		sourceStepName: f.text(255),
		/** Number of waiters that consumed this event. */
		consumedCount: f.number().default(0),
		/** When this event expires (cleaned up by maintenance job). */
		expiresAt: f.datetime(),
	}))
	.indexes(({ table }) => [
		index("idx_wfe_event_name").on(table.eventName),
		index("idx_wfe_created").on(table.createdAt),
		index("idx_wfe_expires").on(table.expiresAt),
	])
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
