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

/** Connection leases for zero-infrastructure, cross-instance channel presence. */
export const questpieChannelPresenceTable = pgTable(
	"questpie_channel_presence",
	{
		channelHash: text("channel_hash").notNull(),
		connectionId: text("connection_id").notNull(),
		principalId: text("principal_id").notNull(),
		channel: text("channel").notNull(),
		data: jsonb("data").notNull(),
		expiresAt: timestamp("expires_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		updatedAt: systemTimestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.channelHash, table.connectionId] }),
		index("idx_channel_presence_channel").on(table.channelHash),
		index("idx_channel_presence_expiry").on(table.expiresAt),
	],
);

/** Durable ownership and desired state for HA realtime control sessions. */
export const questpieRealtimeTopologyTable = pgTable(
	"questpie_realtime_topology",
	{
		sessionKey: text("session_key").primaryKey(),
		ownerId: text("owner_id").notNull(),
		ownerGeneration: bigserial("owner_generation", {
			mode: "number",
		}).notNull(),
		protocolVersion: integer("protocol_version").notNull(),
		tokenHash: text("token_hash").notNull(),
		identityHash: text("identity_hash").notNull(),
		leaseExpiresAt: timestamp("lease_expires_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		desiredRevision: bigint("desired_revision", { mode: "number" })
			.default(0)
			.notNull(),
		appliedRevision: bigint("applied_revision", { mode: "number" })
			.default(0)
			.notNull(),
		desiredTopology: jsonb("desired_topology").notNull(),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
		updatedAt: systemTimestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		index("idx_realtime_topology_owner_lease").on(
			table.ownerId,
			table.leaseExpiresAt,
		),
		index("idx_realtime_topology_lease").on(table.leaseExpiresAt),
	],
);
