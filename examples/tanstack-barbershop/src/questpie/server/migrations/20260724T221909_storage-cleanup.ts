import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260724T221909_storage-cleanup.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "storageCleanup20260724T221909",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_storage_cleanup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"lease_token" uuid,
	"last_error" text,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);`)
		await db.execute(sql`CREATE INDEX "idx_storage_cleanup_available" ON "questpie_storage_cleanup" ("available_at","leased_until","created_at");`)
		await db.execute(sql`CREATE INDEX "idx_storage_cleanup_key" ON "questpie_storage_cleanup" ("key");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_storage_cleanup";`)
	},
	snapshot,
})
