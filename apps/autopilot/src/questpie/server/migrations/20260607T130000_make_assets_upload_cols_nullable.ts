import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "makeAssetsUploadColsNullable20260607T130000",
	async up({ db }) {
		// Server-managed .upload() columns are populated by the storage upload
		// route; text-body asset rows (docs/skills/mini-app sources/artifacts)
		// have no blob, so these must be nullable. visibility is intentionally
		// untouched — it stays NOT NULL DEFAULT 'public' (the beforeChange
		// visibility stamp + per-row read rule depend on it).
		// ALTER COLUMN ... DROP NOT NULL is idempotent (no error if already nullable).
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "key" DROP NOT NULL;`);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "filename" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" DROP NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "size" DROP NOT NULL;`,
		);
	},
	async down({ db }) {
		// Reversible only if no bodyless rows exist; SET NOT NULL errors if any
		// key/filename/mime_type/size is NULL (acceptable for a down migration).
		await db.execute(sql`ALTER TABLE "assets" ALTER COLUMN "key" SET NOT NULL;`);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "filename" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "mime_type" SET NOT NULL;`,
		);
		await db.execute(
			sql`ALTER TABLE "assets" ALTER COLUMN "size" SET NOT NULL;`,
		);
	},
});
