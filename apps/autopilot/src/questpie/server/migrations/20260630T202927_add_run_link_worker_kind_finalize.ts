import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260630T202927_add_run_link_worker_kind_finalize.json"

const snapshot = snapshotJson as OperationSnapshot

// NOTE: `migrate:generate` over-captured ~90 ops of PRE-EXISTING drift here
// (columns already added by hand-written migrations that carry no snapshot —
// systemPrompt/harness fields/producerLease/etc. — plus a framework-wide
// `timestamp`→`timestamp(3)` re-type and assets DROP NOT NULLs). That drift is
// owned by prior migrations and is unrelated to this change, so the up/down
// below are trimmed to ONLY this step's additions (run_links worker/kind/
// finalizedAt/retryPolicy + the worker and partial-pending indexes). The
// regenerated `snapshot` is kept as-is so it re-baselines the snapshot chain and
// future `migrate:generate` runs stop re-surfacing that pre-existing drift.
// (Applying the absorbed `timestamp(3)` change, if desired, is a separate
// pre-existing-hygiene migration, not part of T1.)
export default migration({
	id: "addRunLinkWorkerKindFinalize20260630T202927",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "worker" varchar(36);`,
		)
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "kind" varchar(50);`,
		)
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "finalizedAt" timestamp(3) with time zone;`,
		)
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "retryPolicy" varchar(50) DEFAULT 'none';`,
		)
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "run_links_worker_idx" ON "run_links" ("worker");`,
		)
		await db.execute(
			sql`CREATE INDEX IF NOT EXISTS "run_links_pending_idx" ON "run_links" ("created_at") WHERE "status" = 'pending';`,
		)
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX IF EXISTS "run_links_pending_idx";`)
		await db.execute(sql`DROP INDEX IF EXISTS "run_links_worker_idx";`)
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "retryPolicy";`,
		)
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "finalizedAt";`,
		)
		await db.execute(sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "kind";`)
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "worker";`,
		)
	},
	snapshot,
})
