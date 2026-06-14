import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "addHarnessResumableFields20260614T120000",
	async up({ db }) {
		// chat_sessions: harness session tracking + active stream
		await db.execute(
			sql`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "harnessSessionId" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "harnessResumeState" jsonb;`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "activeStreamId" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "activeRun" varchar(36);`,
		);

		// chat_messages: UIMessage persistence
		await db.execute(
			sql`ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "uiMessageId" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "uiMessage" jsonb;`,
		);

		// run_links: harness session + stream + producer lease
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "activeStreamId" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "harnessSessionId" varchar(255);`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "harnessResumeState" jsonb;`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "uiMessages" jsonb;`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" ADD COLUMN IF NOT EXISTS "producerLease" jsonb;`,
		);
	},
	async down({ db }) {
		await db.execute(
			sql`ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "harnessSessionId";`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "harnessResumeState";`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "activeStreamId";`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "activeRun";`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "uiMessageId";`,
		);
		await db.execute(
			sql`ALTER TABLE "chat_messages" DROP COLUMN IF EXISTS "uiMessage";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "activeStreamId";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "harnessSessionId";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "harnessResumeState";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "uiMessages";`,
		);
		await db.execute(
			sql`ALTER TABLE "run_links" DROP COLUMN IF EXISTS "producerLease";`,
		);
	},
});
