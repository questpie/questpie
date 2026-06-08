import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "addAiRunsSystemPrompt20260607T120000",
	async up({ db }) {
		await db.execute(
			sql`ALTER TABLE "ai_runs" ADD COLUMN IF NOT EXISTS "systemPrompt" text;`,
		);
	},
	async down() {},
});
