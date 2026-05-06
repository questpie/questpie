import { collection } from "questpie";
import { index, uniqueIndex } from "questpie/drizzle-pg-core";

/**
 * Workflow Instance Collection
 *
 * Stores the state and metadata for each workflow execution.
 * Each trigger creates one instance. Status transitions:
 * pending → running → suspended → running → completed|failed|cancelled|timed_out
 */
export const wfInstanceCollection = collection("wf_instance")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		/** Workflow definition name (e.g., "user-onboarding"). */
		name: f.text(255).required(),
		/** Current status of the instance. */
		status: f.text(50).required(),
		/** Validated input payload (JSON). */
		input: f.json().default({}),
		/** Handler return value on completion (JSON). */
		output: f.json(),
		/** Error details on failure (JSON: { message, stack, compensationErrors? }). */
		error: f.json(),
		/** Current retry attempt number. */
		attempt: f.number().default(0),
		/** Parent instance ID (set when invoked as child workflow). */
		parentInstanceId: f.text(255),
		/** Parent step name that invoked this child. */
		parentStepName: f.text(255),
		/** Idempotency key for duplicate prevention. */
		idempotencyKey: f.text(255),
		/** Current execution lease owner. Prevents duplicate queue deliveries from running the same instance concurrently. */
		lockOwner: f.text(255),
		/** When the current execution lease was acquired. */
		lockedAt: f.datetime(),
		/** When the current execution lease expires if the worker stops heartbeating. */
		lockExpiresAt: f.datetime(),
		/** Absolute timeout timestamp. */
		timeoutAt: f.datetime(),
		/** When execution first started. */
		startedAt: f.datetime(),
		/** When last suspended. */
		suspendedAt: f.datetime(),
		/** When completed/failed/cancelled. */
		completedAt: f.datetime(),
	}))
	.indexes(({ table }) => [
		index("idx_wfi_name").on(table.name),
		index("idx_wfi_status").on(table.status),
		index("idx_wfi_parent").on(table.parentInstanceId),
		uniqueIndex("idx_wfi_idempotency").on(table.idempotencyKey),
		index("idx_wfi_status_lock").on(table.status, table.lockExpiresAt),
		index("idx_wfi_created").on(table.createdAt),
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
