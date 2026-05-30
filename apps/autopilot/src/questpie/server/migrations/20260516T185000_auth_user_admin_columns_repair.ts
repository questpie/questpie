import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "authUserAdminColumnsRepair20260516T185000",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" varchar(50);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "role" TYPE varchar(50) USING "role"::varchar(50);`,
		);
		await db.execute(sql`ALTER TABLE "user" ALTER COLUMN "role" DROP DEFAULT;`);
		await db.execute(
			sql`ALTER TABLE "user" ALTER COLUMN "role" DROP NOT NULL;`,
		);

		await db.execute(
			sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" boolean DEFAULT false;`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" timestamp(3) with time zone;`,
		);
	},
	async down() {},
});
