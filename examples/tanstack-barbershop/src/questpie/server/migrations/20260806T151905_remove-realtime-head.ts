import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260806T151905_remove-realtime-head.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "removeRealtimeHead20260806T151905",
	async up({ db }) {
		await db.execute(sql`DROP TABLE "questpie_realtime_head";`)
	},
	async down({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_realtime_head" (
	"id" text PRIMARY KEY,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
	},
	snapshot,
})
