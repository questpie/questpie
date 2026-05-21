import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "dropLegacyExecutionInfra20260519T161500",
	async up({ db }) {
		await db.execute(sql`DROP TABLE IF EXISTS "worker_leases";`);
		await db.execute(sql`DROP TABLE IF EXISTS "run_events";`);
		await db.execute(sql`DROP TABLE IF EXISTS "join_tokens";`);
		await db.execute(sql`DROP TABLE IF EXISTS "workers";`);
		await db.execute(sql`DROP TABLE IF EXISTS "runs";`);
	},
	async down() {},
});
