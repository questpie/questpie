import { index, uniqueIndex } from "drizzle-orm/pg-core";
import { collection } from "questpie";

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
		index("idx_wfi_name").on(table.name as any),
		index("idx_wfi_status").on(table.status as any),
		index("idx_wfi_parent").on(table.parentInstanceId as any),
		uniqueIndex("idx_wfi_idempotency").on(table.idempotencyKey as any),
		index("idx_wfi_created").on(table.createdAt as any),
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
