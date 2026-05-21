import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

export default migration({
	id: "linkScheduleExecutionsToRunLinks20260519T145500",
	async up({ db }) {
		await db.execute(sql`
			ALTER TABLE "schedule_executions"
			ADD COLUMN IF NOT EXISTS "run" varchar(36)
		`);
		await db.execute(sql`
			CREATE INDEX IF NOT EXISTS "schedule_executions_run_idx"
			ON "schedule_executions" ("run")
		`);

		await db.execute(sql`
			WITH existing_matches AS (
				SELECT
					"scheduleExecution" AS "executionId",
					MIN("id") AS "runId",
					COUNT(*) AS "matchCount"
				FROM "run_links"
				WHERE "scheduleExecution" IS NOT NULL
				GROUP BY "scheduleExecution"
			)
			UPDATE "schedule_executions" se
			SET "run" = existing_matches."runId"
			FROM existing_matches
			WHERE se."id" = existing_matches."executionId"
				AND se."run" IS NULL
				AND existing_matches."matchCount" = 1
		`);

		await db.execute(sql`
			WITH chat_candidates AS (
				SELECT
					se."id" AS "executionId",
					cm."run" AS "runId"
				FROM "schedule_executions" se
				INNER JOIN "chat_messages" cm
					ON cm."id" = se."metadata"->>'messageId'
					AND (
						se."chatSession" IS NULL
						OR cm."chatSession" = se."chatSession"
					)
				WHERE se."run" IS NULL
					AND se."metadata"->>'messageId' IS NOT NULL
					AND cm."run" IS NOT NULL
			),
			chat_matches AS (
				SELECT
					"executionId",
					MIN("runId") AS "runId",
					COUNT(DISTINCT "runId") AS "matchCount"
				FROM chat_candidates
				GROUP BY "executionId"
			),
			chat_run_matches AS (
				SELECT
					"runId",
					COUNT(DISTINCT "executionId") AS "executionCount"
				FROM chat_candidates
				GROUP BY "runId"
			)
			UPDATE "schedule_executions" se
			SET "run" = chat_matches."runId"
			FROM chat_matches
			INNER JOIN chat_run_matches
				ON chat_run_matches."runId" = chat_matches."runId"
			WHERE se."id" = chat_matches."executionId"
				AND chat_matches."matchCount" = 1
				AND chat_run_matches."executionCount" = 1
		`);

		await db.execute(sql`
			WITH task_candidates AS (
				SELECT
					se."id" AS "executionId",
					rl."id" AS "runId"
				FROM "schedule_executions" se
				INNER JOIN "run_links" rl ON rl."task" = se."task"
				WHERE se."run" IS NULL
					AND se."task" IS NOT NULL
					AND COALESCE(se."metadata"->>'mode', 'task') <> 'chat'
			),
			task_matches AS (
				SELECT
					"executionId",
					MIN("runId") AS "runId",
					COUNT(DISTINCT "runId") AS "matchCount"
				FROM task_candidates
				GROUP BY "executionId"
			),
			task_run_matches AS (
				SELECT
					"runId",
					COUNT(DISTINCT "executionId") AS "executionCount"
				FROM task_candidates
				GROUP BY "runId"
			)
			UPDATE "schedule_executions" se
			SET "run" = task_matches."runId"
			FROM task_matches
			INNER JOIN task_run_matches
				ON task_run_matches."runId" = task_matches."runId"
			WHERE se."id" = task_matches."executionId"
				AND task_matches."matchCount" = 1
				AND task_run_matches."executionCount" = 1
		`);

		await db.execute(sql`
			UPDATE "run_links" rl
			SET
				"scheduleExecution" = COALESCE(rl."scheduleExecution", se."id"),
				"schedule" = COALESCE(rl."schedule", se."schedule"),
				"task" = COALESCE(rl."task", se."task"),
				"chatSession" = COALESCE(rl."chatSession", se."chatSession"),
				"chatMessage" = COALESCE(
					rl."chatMessage",
					NULLIF(se."metadata"->>'messageId', '')
				)
			FROM "schedule_executions" se
			WHERE rl."id" = se."run"
		`);
	},
	async down({ db }) {
		await db.execute(sql`DROP INDEX IF EXISTS "schedule_executions_run_idx"`);
		await db.execute(sql`
			ALTER TABLE "schedule_executions"
			DROP COLUMN IF EXISTS "run"
		`);
	},
});
