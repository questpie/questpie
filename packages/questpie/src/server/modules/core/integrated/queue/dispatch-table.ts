import { sql } from "drizzle-orm";
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

class JsonDriverValue {
	constructor(private readonly value: unknown) {}

	toJSON(): unknown {
		return this.value;
	}

	toPostgres(): string {
		return JSON.stringify(this.value);
	}
}

const jsonbSafe = customType<{ data: unknown; driverData: unknown }>({
	dataType: () => "jsonb",
	toDriver: (value) => new JsonDriverValue(value),
	fromDriver: (value) => value,
});

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
	],
);
