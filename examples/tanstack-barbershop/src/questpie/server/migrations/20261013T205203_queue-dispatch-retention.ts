import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20261013T205203_queue-dispatch-retention.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "queueDispatchRetention20261013T205203",
	async up({ db }) {
		await db.execute(sql`CREATE INDEX "idx_queue_dispatch_reconcile" ON "questpie_queue_dispatch" ("created_at","dispatch_id") WHERE "secret_payload" = true AND "status" = 'accepted' AND "adapter_job_id" IS NOT NULL;`)
		await db.execute(sql`CREATE INDEX "idx_queue_dispatch_prune" ON "questpie_queue_dispatch" (COALESCE("completed_at", "failed_at", "accepted_at")) WHERE ("status" IN ('completed', 'failed') OR ("status" = 'accepted' AND "secret_payload" = false));`)
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX "idx_queue_dispatch_reconcile";`)
		await db.execute(sql`DROP INDEX "idx_queue_dispatch_prune";`)
	},
	snapshot,
})
