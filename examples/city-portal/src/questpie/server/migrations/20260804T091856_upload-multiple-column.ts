import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260804T091856_upload-multiple-column.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "uploadMultipleColumn20260804T091856",
	async up({ db }) {
		await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN "attachments" jsonb;`)
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN "attachments";`)
	},
	snapshot,
})
