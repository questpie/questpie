import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260721T220739_calm_purple_griffin.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "calmPurpleGriffin20260721T220739",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_realtime_head" (
	"id" text PRIMARY KEY,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp(3) DEFAULT now() NOT NULL
);`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_realtime_head";`)
	},
	snapshot,
})
