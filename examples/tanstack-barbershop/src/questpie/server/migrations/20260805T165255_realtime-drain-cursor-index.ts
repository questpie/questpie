import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260805T165255_realtime-drain-cursor-index.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "realtimeDrainCursorIndex20260805T165255",
	async up({ db }) {
		await db.execute(sql`CREATE INDEX "idx_realtime_log_txid_seq" ON "questpie_realtime_log" ("txid","seq");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX "idx_realtime_log_txid_seq";`)
	},
	snapshot,
})
