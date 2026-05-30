import { sql } from "drizzle-orm";
import { migration } from "questpie/services";

function rowsFromResult(result: unknown): unknown[] {
	if (Array.isArray(result)) {
		return result;
	}

	const rows = (result as { rows?: unknown[] })?.rows;
	return Array.isArray(rows) ? rows : [];
}

export default migration({
	id: "backfillLegacyRunsIntoRunLinks20260519T142100",
	async up({ db }) {
		const activeRuns = rowsFromResult(
			await db.execute(sql`
				SELECT "id", "status"
				FROM "runs"
				WHERE "status" IN ('pending', 'claimed', 'running')
				LIMIT 1
			`),
		);

		if (activeRuns.length > 0) {
			const activeRun = activeRuns[0] as { id?: string; status?: string };
			throw new Error(
				`Cannot backfill legacy runs into run_links while active legacy runs exist. Drain, cancel, or requeue legacy runs before rerunning this migration. First active run: ${activeRun.id ?? "unknown"} (${activeRun.status ?? "unknown"}).`,
			);
		}

		await db.execute(sql`
			INSERT INTO "run_links" (
				"id",
				"legacyRunId",
				"aiRun",
				"task",
				"project",
				"provider",
				"model",
				"capability",
				"initiatedBy",
				"runtime",
				"resumedFromRun",
				"status",
				"instructions",
				"summary",
				"error",
				"tokensInput",
				"tokensOutput",
				"cost",
				"startedAt",
				"endedAt",
				"runtimeSessionRef",
				"resumable",
				"metadata",
				"created_at",
				"updated_at"
			)
			SELECT
				r."id",
				r."id",
				NULL,
				r."task",
				r."project",
				r."provider",
				r."model",
				r."capability",
				r."initiatedBy",
				r."runtime",
				r."resumedFromRun",
				r."status",
				r."instructions",
				r."summary",
				r."error",
				r."tokensInput",
				r."tokensOutput",
				NULL,
				r."startedAt",
				r."endedAt",
				r."runtimeSessionRef",
				r."resumable",
				CASE
					WHEN r."metadata" IS NULL
						AND r."preferredWorker" IS NULL
						AND r."targeting" IS NULL
					THEN NULL
					ELSE jsonb_set(
						COALESCE(r."metadata", '{}'::jsonb),
						'{legacy}',
						COALESCE(r."metadata"->'legacy', '{}'::jsonb)
							|| jsonb_strip_nulls(jsonb_build_object(
								'preferredWorker', r."preferredWorker",
								'targeting', r."targeting"
							)),
						true
					)
				END,
				r."created_at",
				r."updated_at"
			FROM "runs" r
			ON CONFLICT DO NOTHING
		`);
	},
	async down({ db }) {
		await db.execute(sql`
			DELETE FROM "run_links"
			WHERE "aiRun" IS NULL
				AND "legacyRunId" IS NOT NULL
				AND "id" = "legacyRunId"
		`);
	},
});
