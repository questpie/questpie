import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "dropCapabilities20260529T003000",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "capability";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "capability";`,
		);
		await db.execute(
			sql`ALTER TABLE "models" DROP COLUMN IF EXISTS "capabilities";`,
		);
		await db.execute(sql`DROP TABLE IF EXISTS "capabilities";`);
	},
	async down() {},
});
