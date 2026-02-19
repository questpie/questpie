import { lt, sql } from "drizzle-orm";
import { job } from "questpie";
import { z } from "zod";

/**
 * Audit log cleanup job.
 * Runs daily (via cron) to delete entries older than the configured retention period.
 */
export const auditCleanupJob = job({
	name: "audit-cleanup",
	schema: z.object({
		retentionDays: z.number().int().positive().default(90),
	}),
	handler: async ({ payload, app, db }) => {
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - payload.retentionDays);

		const result = await db.execute(
			sql`DELETE FROM admin_audit_log WHERE created_at < ${cutoff}`,
		);

		const deletedCount =
			typeof result?.rowCount === "number" ? result.rowCount : 0;

		if (deletedCount > 0) {
			(app as any)?.logger?.info?.(
				`[Audit] Cleaned up ${deletedCount} audit log entries older than ${payload.retentionDays} days`,
			);
		}
	},
	options: {
		cron: "0 3 * * *", // Daily at 3 AM
	},
});
