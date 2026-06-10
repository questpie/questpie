import { bigserial, index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { systemTimestamp } from "#questpie/server/db/system-columns.js";

/**
 * Realtime outbox log table
 * Stores changes for subscriptions and backfill.
 */
export const questpieRealtimeLogTable = pgTable(
	"questpie_realtime_log",
	{
		seq: bigserial("seq", { mode: "number" }).primaryKey(),
		resourceType: text("resource_type").notNull(),
		resource: text("resource").notNull(),
		operation: text("operation").notNull(),
		recordId: text("record_id"),
		locale: text("locale"),
		payload: jsonb("payload").default({}),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_realtime_log_seq").on(t.seq),
		index("idx_realtime_log_resource").on(t.resourceType, t.resource),
		index("idx_realtime_log_created_at").on(t.createdAt),
	],
);
