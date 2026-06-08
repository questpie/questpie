import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "addApiKeyConfigId20260604T111500",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "apikey" ADD COLUMN IF NOT EXISTS "configId" varchar(255) DEFAULT 'default' NOT NULL;`,
		);
	},
	async down() {},
});
