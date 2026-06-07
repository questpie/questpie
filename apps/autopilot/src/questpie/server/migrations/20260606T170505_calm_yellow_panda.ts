import { migration } from "questpie/services"
import type { OperationSnapshot } from "questpie/migration"
import { sql } from "drizzle-orm"
import snapshotJson from "./snapshots/20260606T170505_calm_yellow_panda.json"

const snapshot = snapshotJson as OperationSnapshot

export default migration({
	id: "calmYellowPanda20260606T170505",
	async up({ db }) {
		// Re-add the synthetic upload columns that 20260606T003509_v2_schema DROPPED:
		// that migration was generated while assets.ts still called .upload() BEFORE
		// .fields() (which replaces the field map, so the upload columns were absent
		// from the schema snapshot and emitted as DROPs). assets.ts now orders
		// .fields() before .upload(), so these columns belong in the table again.
		// IF NOT EXISTS keeps this idempotent. NOT NULL is safe here because a fresh
		// migrate runs this on an empty assets table (migrations precede seeds); the
		// follow-up 20260607T130000 migration then relaxes key/filename/mime_type/size
		// to NULLABLE (the framework treats server-managed upload fields as optional so
		// the unified collection also accepts text-body rows). visibility stays NOT NULL.
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "key" varchar(255) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "filename" varchar(255) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "mime_type" varchar(100) NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "size" integer NOT NULL;`)
		await db.execute(sql`ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "visibility" varchar(20) DEFAULT 'public' NOT NULL;`)
	},
	async down({ db }) {
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "key";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "filename";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "mime_type";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "size";`)
		await db.execute(sql`ALTER TABLE "assets" DROP COLUMN IF EXISTS "visibility";`)
	},
	snapshot,
})
