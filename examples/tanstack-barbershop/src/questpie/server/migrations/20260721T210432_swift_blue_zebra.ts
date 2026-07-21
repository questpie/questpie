import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260721T210432_swift_blue_zebra.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "swiftBlueZebra20260721T210432",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_channel_head" (
	"channel_hash" text PRIMARY KEY,
	"channel" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_event" (
	"channel_hash" text,
	"seq" bigint,
	"event_id" text NOT NULL,
	"channel" text NOT NULL,
	"event" text NOT NULL,
	"schema_identity" text NOT NULL,
	"payload" jsonb NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_event_pkey" PRIMARY KEY("channel_hash","seq")
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_dispatch" (
	"channel_hash" text PRIMARY KEY,
	"published_seq" bigint DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_presence" (
	"channel_hash" text,
	"connection_id" text,
	"principal_id" text NOT NULL,
	"channel" text NOT NULL,
	"data" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_presence_pkey" PRIMARY KEY("channel_hash","connection_id")
);`)
		await db.execute(sql`CREATE TABLE "questpie_realtime_topology" (
	"session_key" text PRIMARY KEY,
	"owner_id" text NOT NULL,
	"owner_generation" bigserial,
	"protocol_version" integer NOT NULL,
	"token_hash" text NOT NULL,
	"identity_hash" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"desired_revision" bigint DEFAULT 0 NOT NULL,
	"applied_revision" bigint DEFAULT 0 NOT NULL,
	"desired_topology" jsonb NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`DROP INDEX "idx_realtime_log_seq";`)
		await db.execute(sql`DROP INDEX "idx_realtime_log_resource";`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" ADD COLUMN "txid" xid8 DEFAULT pg_current_xact_id();`)
		await db.execute(sql`CREATE UNIQUE INDEX "uq_channel_event_event_id" ON "questpie_channel_event" ("event_id");`)
		await db.execute(sql`CREATE INDEX "idx_channel_event_created_at" ON "questpie_channel_event" ("created_at");`)
		await db.execute(sql`CREATE INDEX "idx_channel_presence_channel" ON "questpie_channel_presence" ("channel_hash");`)
		await db.execute(sql`CREATE INDEX "idx_channel_presence_expiry" ON "questpie_channel_presence" ("expires_at");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_topology_owner_lease" ON "questpie_realtime_topology" ("owner_id","lease_expires_at");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_topology_lease" ON "questpie_realtime_topology" ("lease_expires_at");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_channel_head";`)
		await db.execute(sql`DROP TABLE "questpie_channel_event";`)
		await db.execute(sql`DROP TABLE "questpie_channel_dispatch";`)
		await db.execute(sql`DROP TABLE "questpie_channel_presence";`)
		await db.execute(sql`DROP TABLE "questpie_realtime_topology";`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" DROP COLUMN "txid";`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_seq" ON "questpie_realtime_log" ("seq");`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_resource" ON "questpie_realtime_log" ("resource_type","resource");`)
	},
	snapshot,
})
