import { type SQL, type SQLWrapper, sql } from "drizzle-orm";
import {
	boolean,
	customType,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

import { systemTimestamp } from "#questpie/server/db/system-columns.js";

const jsonbSafe = customType<{ data: unknown; driverData: unknown }>({
	dataType: () => "jsonb",
	// Bind as text before casting: works with postgres-js after Drizzle replaces
	// its JSON serializers, and keeps Bun SQL from JSON-encoding a string twice.
	toDriver: (value) => sql`${JSON.stringify(value)}::text::jsonb`,
	fromDriver: (value) => value,
});

type DispatchColumns<TKey extends string> = Record<TKey, SQLWrapper>;

/**
 * Rows whose broker execution state reconciliation still owns. The index
 * predicate and the reconcile query share this text, constants inlined, so
 * PostgreSQL can prove the partial index applies under any plan mode.
 */
export function queueDispatchReconcilePredicate(
	table: DispatchColumns<"secretPayload" | "status" | "adapterJobId">,
): SQL {
	return sql`${table.secretPayload} = true AND ${table.status} = 'accepted' AND ${table.adapterJobId} IS NOT NULL`;
}

/**
 * Rows retention may delete once old enough: terminal rows, and accepted rows
 * of non-secret jobs, where the adapter owns execution and the row is only the
 * idempotency receipt. Shared with the prune query for the same reason.
 */
export function queueDispatchPrunablePredicate(
	table: DispatchColumns<"secretPayload" | "status">,
): SQL {
	return sql`(${table.status} IN ('completed', 'failed') OR (${table.status} = 'accepted' AND ${table.secretPayload} = false))`;
}

/** Time a prunable row was handed off or reached its terminal state. */
export function queueDispatchFinishedAt(
	table: DispatchColumns<"completedAt" | "failedAt" | "acceptedAt">,
): SQL {
	return sql`COALESCE(${table.completedAt}, ${table.failedAt}, ${table.acceptedAt})`;
}

/**
 * Internal durable handoff for queue backends that cannot join the current
 * PostgreSQL transaction. This is deliberately not the realtime outbox.
 */
export const questpieQueueDispatchTable = pgTable(
	"questpie_queue_dispatch",
	{
		dispatchId: uuid("dispatch_id").primaryKey(),
		jobName: text("job_name").notNull(),
		idempotencyKey: text("idempotency_key"),
		payload: jsonbSafe("payload"),
		secretPayload: boolean("secret_payload").default(false).notNull(),
		wrappedSecretKey: jsonbSafe("wrapped_secret_key"),
		options: jsonbSafe("options"),
		status: text("status").default("pending").notNull(),
		attempts: integer("attempts").default(0).notNull(),
		availableAt: timestamp("available_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		leaseToken: uuid("lease_token"),
		leasedUntil: timestamp("leased_until", {
			withTimezone: true,
			mode: "date",
		}),
		adapterJobId: text("adapter_job_id"),
		lastError: text("last_error"),
		acceptedAt: timestamp("accepted_at", {
			withTimezone: true,
			mode: "date",
		}),
		completedAt: timestamp("completed_at", {
			withTimezone: true,
			mode: "date",
		}),
		failedAt: timestamp("failed_at", {
			withTimezone: true,
			mode: "date",
		}),
		executionClaimToken: uuid("execution_claim_token"),
		executionClaimedUntil: timestamp("execution_claimed_until", {
			withTimezone: true,
			mode: "date",
		}),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
		updatedAt: systemTimestamp("updated_at")
			.defaultNow()
			.$onUpdate(() => sql`CURRENT_TIMESTAMP`)
			.notNull(),
	},
	(table) => [
		uniqueIndex("uq_queue_dispatch_idempotency").on(
			table.jobName,
			table.idempotencyKey,
		),
		index("idx_queue_dispatch_ready").on(
			table.status,
			table.availableAt,
			table.leasedUntil,
		),
		index("idx_queue_dispatch_reconcile")
			.on(table.createdAt, table.dispatchId)
			.where(queueDispatchReconcilePredicate(table)),
		index("idx_queue_dispatch_prune")
			.on(queueDispatchFinishedAt(table))
			.where(queueDispatchPrunablePredicate(table)),
	],
);
