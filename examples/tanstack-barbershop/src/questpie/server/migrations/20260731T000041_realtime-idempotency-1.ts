import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260731T000041_realtime-idempotency-1.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "realtimeIdempotency120260731T000041",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_channel_authority_fence" (
	"channel_hash" text,
	"subject" text,
	"generation" bigint DEFAULT 0 NOT NULL,
	"applied_generation" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "questpie_channel_authority_fence_pkey" PRIMARY KEY("channel_hash","subject")
);`)
		await db.execute(sql`CREATE TABLE "questpie_channel_authority_revocation" (
	"idempotency_hash" text PRIMARY KEY,
	"channel_hash" text NOT NULL,
	"subject" text NOT NULL,
	"generation" bigint DEFAULT 0 NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE INDEX "idx_channel_authority_fence_updated" ON "questpie_channel_authority_fence" ("updated_at");`)
		await db.execute(sql`CREATE INDEX "idx_channel_authority_revocation_target" ON "questpie_channel_authority_revocation" ("channel_hash","subject");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_channel_authority_fence";`)
		await db.execute(sql`DROP TABLE "questpie_channel_authority_revocation";`)
	},
	snapshot,
})
