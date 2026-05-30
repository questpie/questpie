import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "dropWorkflowConfigs20260529T001500",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflowConfig";`,
		);
		await db.execute(
			sql`ALTER TABLE "tasks" DROP COLUMN IF EXISTS "workflowStep";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "workflowConfig";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "workflowStep";`,
		);
		await db.execute(
			sql`ALTER TABLE "schedules" DROP COLUMN IF EXISTS "workflowConfig";`,
		);
		await db.execute(sql`DROP TABLE IF EXISTS "workflow_configs";`);
	},
	async down() {},
});
