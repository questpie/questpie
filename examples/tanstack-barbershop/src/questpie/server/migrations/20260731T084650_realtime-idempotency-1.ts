import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260731T084650_realtime-idempotency-1.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "realtimeIdempotency120260731T084650",
	async up({ db }) {
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "secret_payload" boolean DEFAULT false NOT NULL;`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "wrapped_secret_key" jsonb;`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "completed_at" timestamp with time zone;`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "failed_at" timestamp with time zone;`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "execution_claim_token" uuid;`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" ADD COLUMN "execution_claimed_until" timestamp with time zone;`)
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "secret_payload";`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "wrapped_secret_key";`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "completed_at";`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "failed_at";`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "execution_claim_token";`)
		await db.execute(sql`ALTER TABLE "questpie_queue_dispatch" DROP COLUMN "execution_claimed_until";`)
	},
	snapshot,
})
