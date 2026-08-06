import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260805T180812_realtime-settlement-retention.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "realtimeSettlementRetention20260805T180812",
	async up({ db }) {
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" ADD COLUMN "settled_at" timestamp(3);`)
		await db.execute(sql`CREATE INDEX "idx_realtime_log_settled_at" ON "questpie_realtime_log" ("settled_at");`)
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX "idx_realtime_log_settled_at";`)
		await db.execute(sql`ALTER TABLE "questpie_realtime_log" DROP COLUMN "settled_at";`)
	},
	snapshot,
})
