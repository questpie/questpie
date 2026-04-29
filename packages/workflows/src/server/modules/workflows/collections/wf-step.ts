import { collection } from "questpie";
import { index, uniqueIndex } from "questpie/drizzle-pg-core";

/**
 * Workflow Step Collection
 *
 * Stores the execution record for each step within a workflow instance.
 * Used for replay memoization — completed steps return cached results.
 * Step types: run, sleep, sleepUntil, waitForEvent, invoke, sendEvent.
 */
export const wfStepCollection = collection("wf_step")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Parent workflow instance ID. */
		instanceId: f.text(255).required(),
		/** Step name (unique within an instance). */
		name: f.text(255).required(),
		/** Step type: run|sleep|sleepUntil|waitForEvent|invoke|sendEvent. */
		type: f.text(50).required(),
		/** Step status: pending|running|completed|failed|sleeping|waiting. */
		status: f.text(50).required(),
		/** Step result (JSON) — cached for replay. */
		result: f.json(),
		/** Error details (JSON). */
		error: f.json(),
		/** Current retry attempt. */
		attempt: f.number().default(0),
		/** Maximum retry attempts for this step. */
		maxAttempts: f.number().default(1),
		/** When the step is scheduled to resume (sleep/sleepUntil). */
		scheduledAt: f.datetime(),
		/** Event name being waited for (waitForEvent). */
		eventName: f.text(255),
		/** JSONB match criteria for event matching. */
		matchCriteria: f.json(),
		/** Deterministic hash of matchCriteria for O(1) event lookup. */
		matchHash: f.text(50),
		/** Child workflow instance ID (invoke). */
		childInstanceId: f.text(255),
		/** Whether this step has an inline compensate callback. */
		hasCompensation: f.boolean().default(false),
		/** When step execution started. */
		startedAt: f.datetime(),
		/** When step completed or failed. */
		completedAt: f.datetime(),
	}))
	.indexes(({ table }) => [
		uniqueIndex("idx_wfs_instance_name").on(table.instanceId, table.name),
		index("idx_wfs_instance").on(table.instanceId),
		index("idx_wfs_status").on(table.status),
		index("idx_wfs_scheduled").on(table.scheduledAt),
		// Note: Partial index for fast event matching
		// (WHERE status = 'waiting') requires a raw SQL migration.
		// Standard index on event_name + status as fallback:
		index("idx_wfs_event_status").on(table.eventName, table.status),
		index("idx_wfs_match_hash").on(table.matchHash, table.status),
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
