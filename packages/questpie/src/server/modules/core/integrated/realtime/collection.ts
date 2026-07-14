import {
	bigint,
	bigserial,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

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
	(t) => [index("idx_realtime_log_created_at").on(t.createdAt)],
);

/** Per-resolved-channel sequence head. Updating this row serializes publishers. */
export const questpieChannelHeadTable = pgTable("questpie_channel_head", {
	channelHash: text("channel_hash").primaryKey(),
	channel: text("channel").notNull(),
	lastSeq: bigint("last_seq", { mode: "number" }).default(0).notNull(),
	updatedAt: systemTimestamp("updated_at").defaultNow().notNull(),
});

/** Durable ordered channel event ledger. */
export const questpieChannelEventTable = pgTable(
	"questpie_channel_event",
	{
		channelHash: text("channel_hash").notNull(),
		seq: bigint("seq", { mode: "number" }).notNull(),
		eventId: text("event_id").notNull(),
		channel: text("channel").notNull(),
		event: text("event").notNull(),
		schemaIdentity: text("schema_identity").notNull(),
		payload: jsonb("payload").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.channelHash, table.seq] }),
		uniqueIndex("uq_channel_event_event_id").on(table.eventId),
		index("idx_channel_event_created_at").on(table.createdAt),
	],
);

/** Durable shared-provider cursor and per-channel coordinator lease. */
export const questpieChannelDispatchTable = pgTable(
	"questpie_channel_dispatch",
	{
		channelHash: text("channel_hash").primaryKey(),
		publishedSeq: bigint("published_seq", { mode: "number" })
			.default(0)
			.notNull(),
		leaseOwner: text("lease_owner"),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}),
		updatedAt: systemTimestamp("updated_at").defaultNow().notNull(),
	},
);
