import { index, uniqueIndex } from "drizzle-orm/pg-core";
import { collection } from "questpie";

/**
 * Workflow instance — tracks the lifecycle of a single workflow execution.
 *
 * Created when a workflow is triggered, updated as steps execute,
 * and finalized when the workflow completes, fails, or times out.
 */
export default collection("wf_instance")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Workflow definition name (e.g. "order-processing"). */
		workflowName: f.text(255).required(),

		/** Current instance status. */
		status: f
			.select([
				{ value: "pending", label: "Pending" },
				{ value: "running", label: "Running" },
				{ value: "completed", label: "Completed" },
				{ value: "failed", label: "Failed" },
				{ value: "suspended", label: "Suspended" },
				{ value: "cancelled", label: "Cancelled" },
				{ value: "timed_out", label: "Timed Out" },
			])
			.required()
			.default("pending"),

		/** Validated input payload (JSONB). */
		input: f.json(),

		/** Handler return value on completion (JSONB). */
		output: f.json(),

		/** Error message on failure. */
		error: f.textarea(),

		/** Current attempt number (1-based). */
		attempt: f.number().default(1),

		/** Maximum retry attempts. */
		maxAttempts: f.number().default(3),

		/** Absolute timeout deadline. */
		timeoutAt: f.datetime(),

		/** When a suspended workflow should resume. */
		suspendedUntil: f.datetime(),

		/** When the workflow finished (completed/failed/cancelled/timed_out). */
		completedAt: f.datetime(),

		/** Idempotency key for deduplication. */
		idempotencyKey: f.text(255),

		/** Delayed start — don't execute before this time. */
		startAfter: f.datetime(),
	}))
	.indexes(({ table }) => [
		index("idx_wf_instance_workflow").on(table.workflowName as any),
		index("idx_wf_instance_status").on(table.status as any),
		index("idx_wf_instance_suspended").on(table.suspendedUntil as any),
	])
	.title(({ f }) => f.workflowName)
	.access({
		create: false,
		update: false,
		delete: false,
		read: false,
	})
	.set("admin", { hidden: true, audit: false });
