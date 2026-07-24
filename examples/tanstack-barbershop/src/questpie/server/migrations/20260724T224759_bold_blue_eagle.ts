import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260724T224759_bold_blue_eagle.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "boldBlueEagle20260724T224759",
	async up({ db }) {
		await db.execute(sql`CREATE TABLE "questpie_storage_object_key" (
	"key" text PRIMARY KEY,
	"created_at" timestamp(3) DEFAULT now() NOT NULL
);`)
	},
	async down({ db }) {
		await db.execute(sql`DROP TABLE "questpie_storage_object_key";`)
	},
	snapshot,
})
