import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20261021T125516_queue-dispatch-ownership.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "queueDispatchOwnership20261021T125516",
	async up({ db }) {
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "adapter_identity" text;`)
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "adapter_identity";`)
	},
	snapshot,
})
