import { job } from "questpie";
import { sql } from "questpie/drizzle";
import { z } from "zod";

import { AUDIT_LOG_COLLECTION } from "../collections/audit-log.js";
import type {
	AuditDeliveryMode,
	AuditRetentionPolicy,
	CanonicalAuditEvent,
	PersistedAuditEvent,
} from "../policy.js";
import { toCanonicalAuditEvent } from "../policy.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function auditPolicy(app: unknown): Record<string, unknown> | undefined {
	if (!isRecord(app) || !isRecord(app.state)) return undefined;
	const direct = app.state.audit;
	if (isRecord(direct)) return direct;
	const config = app.state.config;
	return isRecord(config) && isRecord(config.audit) ? config.audit : undefined;
}

function retentionPolicy(app: unknown): AuditRetentionPolicy | undefined {
	const retention = auditPolicy(app)?.retention;
	return isRetentionPolicy(retention) ? retention : undefined;
}

function isRetentionPolicy(value: unknown): value is AuditRetentionPolicy {
	if (!isRecord(value)) return false;
	if (
		value.days !== null &&
		!(
			typeof value.days === "number" &&
			Number.isFinite(value.days) &&
			value.days > 0
		)
	) {
		return false;
	}
	return value.legalHold === undefined || typeof value.legalHold === "function";
}

function deliveryMode(app: unknown): AuditDeliveryMode {
	return auditPolicy(app)?.delivery === "required" ? "required" : "best-effort";
}

/**
 * Audit log cleanup job.
 * Runs daily (via cron) to delete entries older than the configured retention period.
 */
export const auditCleanupJob = job({
	name: "audit-cleanup",
	schema: z.object({}),
	handler: async (ctx) => {
		const { app, db, logger } = ctx as typeof ctx & {
			app?: unknown;
			db: { execute(statement: unknown): Promise<unknown> };
			logger?: { error(message: string, details?: unknown): void };
		};
		const retention = retentionPolicy(app);
		if (!retention || retention.days === null) return;

		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - retention.days);

		try {
			let statement = sql`DELETE FROM ${sql.identifier(AUDIT_LOG_COLLECTION)} WHERE created_at < ${cutoff}`;
			if (retention.legalHold) {
				const expired = await db.execute(
					sql`SELECT id, created_at AS "createdAt", action, resource_type AS "resourceType", resource, resource_id AS "resourceId", user_id AS "userId", user_name AS "userName", changes, metadata FROM ${sql.identifier(AUDIT_LOG_COLLECTION)} WHERE created_at < ${cutoff}`,
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

			const result = await db.execute(statement);

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
		} catch (error) {
			if (deliveryMode(app) === "required") throw error;
			logger?.error("[Audit] Failed to clean up expired audit events", {
				error:
					error instanceof Error
						? { name: error.name, message: error.message }
						: { message: String(error) },
				operation: "cleanup",
				resource: AUDIT_LOG_COLLECTION,
			});
		}
	},
	options: {
		cron: "0 3 * * *", // Daily at 3 AM
	},
});
