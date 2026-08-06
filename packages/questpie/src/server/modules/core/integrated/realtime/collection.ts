import { sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
	boolean,
	customType,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

import { systemTimestamp } from "#questpie/server/db/system-columns.js";

const xid8 = customType<{ data: string; driverData: string | bigint }>({
	dataType() {
		return "xid8";
	},
	fromDriver(value) {
		return String(value);
	},
});

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
	// Keep Bun SQL from inferring primitive/array PostgreSQL parameter types while
	// still allowing each driver to serialize the JSON value exactly once.
	toDriver: (value) => new JsonDriverValue(value),
	// Bun SQL, PGlite, and node-postgres already decode native jsonb values.
	// Parsing strings again corrupts legitimate JSON-looking string payloads
	// ("123" -> 123, "true" -> true, and so on).
	fromDriver: (value) => value,
});

/**
 * Realtime outbox log table
 * Stores changes for subscriptions and backfill.
 */
export const questpieRealtimeLogTable = pgTable(
	"questpie_realtime_log",
	{
		seq: bigserial("seq", { mode: "number" }).primaryKey(),
		txid: xid8("txid").default(sql`pg_current_xact_id()`),
		resourceType: text("resource_type").notNull(),
		resource: text("resource").notNull(),
		operation: text("operation").notNull(),
		recordId: text("record_id"),
		locale: text("locale"),
		payload: jsonbSafe("payload").default({}),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
		/** First cleanup observation after this transaction fell below snapshot xmin. */
		settledAt: systemTimestamp("settled_at"),
	},
	(t) => [
		index("idx_realtime_log_created_at").on(t.createdAt),
		index("idx_realtime_log_settled_at").on(t.settledAt),
		// The drain cursor is `(txid, seq)`, not `seq` — see RealtimeService.
		// Without this index every drain would sort the whole retained log.
		index("idx_realtime_log_txid_seq").on(t.txid, t.seq),
	],
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
		payload: jsonbSafe("payload").notNull(),
		wireJson: text("wire_json").notNull(),
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

/**
 * Durable authority cut for one opaque subject on one resolved channel.
 *
 * This generation is deliberately separate from the public channel event
 * sequence. Notice brokers may wake reconciliation, but delivery checks this
 * row while holding a database lock before writing a protected frame.
 */
export const questpieChannelAuthorityFenceTable = pgTable(
	"questpie_channel_authority_fence",
	{
		channelHash: text("channel_hash").notNull(),
		subject: text("subject").notNull(),
		generation: bigint("generation", { mode: "number" }).default(0).notNull(),
		appliedGeneration: bigint("applied_generation", { mode: "number" })
			.default(0)
			.notNull(),
		updatedAt: systemTimestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		primaryKey({ columns: [table.channelHash, table.subject] }),
		index("idx_channel_authority_fence_updated").on(table.updatedAt),
	],
);

/** Durable command identity that makes retried revocations idempotent. */
export const questpieChannelAuthorityRevocationTable = pgTable(
	"questpie_channel_authority_revocation",
	{
		idempotencyHash: text("idempotency_hash").primaryKey(),
		channelHash: text("channel_hash").notNull(),
		subject: text("subject").notNull(),
		generation: bigint("generation", { mode: "number" }).default(0).notNull(),
		applied: boolean("applied").default(false).notNull(),
		createdAt: systemTimestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("idx_channel_authority_revocation_target").on(
			table.channelHash,
			table.subject,
		),
	],
);

/** Connection leases for zero-infrastructure, cross-instance channel presence. */
export const questpieChannelPresenceTable = pgTable(
	"questpie_channel_presence",
	{
		channelHash: text("channel_hash").notNull(),
		connectionId: text("connection_id").notNull(),
		principalId: text("principal_id").notNull(),
		channel: text("channel").notNull(),
		data: jsonbSafe("data").notNull(),
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
		desiredTopology: jsonbSafe("desired_topology").notNull(),
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
