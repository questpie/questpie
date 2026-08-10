import { job, withTransaction } from "questpie";
import { sql } from "questpie/drizzle";
import { z } from "zod";

import { AUDIT_LOG_COLLECTION } from "../collections/audit-log.js";
import { getAuditRetention, isRecord } from "../config/runtime.js";
import type { CanonicalAuditEvent, PersistedAuditEvent } from "../policy.js";
import { toCanonicalAuditEvent } from "../policy.js";

/**
 * Audit log cleanup job.
 * Runs daily (via cron) to delete entries older than the configured retention period.
 */
export const auditCleanupJob = job({
	name: "audit-cleanup",
	schema: z.object({}),
	handler: async (ctx) => {
		const { app, db } = ctx as typeof ctx & {
			app?: unknown;
			db: { execute(statement: unknown): Promise<unknown> };
		};
		const retention = getAuditRetention({ app });
		if (!retention || retention.days === null) return;

		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - retention.days);

		await withTransaction(db, async (tx) => {
			let statement = sql`DELETE FROM ${sql.identifier(AUDIT_LOG_COLLECTION)} WHERE created_at < ${cutoff}`;
			if (retention.legalHold) {
				const expired = await tx.execute(
					sql`SELECT id, created_at AS "createdAt", action, "resourceType", resource, "resourceId", "userId", "userName", changes, metadata FROM ${sql.identifier(AUDIT_LOG_COLLECTION)} WHERE created_at < ${cutoff} FOR UPDATE SKIP LOCKED`,
				);
				const rows =
					isRecord(expired) && Array.isArray(expired.rows)
						? (expired.rows as PersistedAuditEvent[])
						: [];
				const deletableIds: string[] = [];
				for (const row of rows) {
					const canonical: CanonicalAuditEvent = toCanonicalAuditEvent(row);
					if (!(await retention.legalHold(canonical)))
						deletableIds.push(row.id);
				}
				if (deletableIds.length === 0) return;
				statement = sql`DELETE FROM ${sql.identifier(AUDIT_LOG_COLLECTION)} WHERE id IN (${sql.join(deletableIds.map((id) => sql`${id}`))})`;
			}

			const result = await tx.execute(statement);

			const deletedCount =
				isRecord(result) && typeof result.rowCount === "number"
					? result.rowCount
					: 0;

			if (deletedCount > 0 && isRecord(app) && isRecord(app.logger)) {
				const info = app.logger.info;
				if (typeof info === "function") {
					info.call(
						app.logger,
						`[Audit] Cleaned up ${deletedCount} audit log entries older than ${retention.days} days`,
					);
				}
			}
		});
	},
	options: {
		cron: "0 3 * * *", // Daily at 3 AM
	},
});
