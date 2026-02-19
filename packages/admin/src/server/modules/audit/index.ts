import { q } from "questpie";
import type {
	ComponentReference,
	ServerTimelineWidget,
	WidgetFetchContext,
} from "../../augmentation.js";
import { auditLogCollection } from "./collections/audit-log.collection.js";
import { auditCleanupJob } from "./jobs/audit-cleanup.job.js";
import {
	createCollectionAuditHooks,
	createGlobalAuditHooks,
} from "./hooks.js";

export { auditLogCollection } from "./collections/audit-log.collection.js";
export { auditCleanupJob } from "./jobs/audit-cleanup.job.js";
export {
	computeChanges,
	createCollectionAuditHooks,
	createGlobalAuditHooks,
	extractLabel,
} from "./hooks.js";

/**
 * Options for the audit module.
 */
export interface AuditModuleOptions {
	/**
	 * Number of days to retain audit log entries.
	 * @default 90
	 */
	retentionDays?: number;
}

/**
 * Create an audit module with optional configuration.
 *
 * Collections with `audit: false` in their `.options()` are automatically skipped.
 * All internal admin collections (preferences, locks, saved views, auth tables)
 * already have this set. To disable auditing for your own collection:
 *
 * ```ts
 * const myCollection = q.collection("temp_data")
 *   .fields(...)
 *   .options({ audit: false });
 * ```
 *
 * @example
 * ```ts
 * import { createAuditModule } from "@questpie/admin/server";
 *
 * const audit = createAuditModule({ retentionDays: 30 });
 *
 * const app = q({ name: "my-app" })
 *   .use(adminModule)
 *   .use(audit)
 *   .build({ ... });
 * ```
 */
export function createAuditModule(options?: AuditModuleOptions) {
	const collectionHooks = createCollectionAuditHooks();
	const globalHooks = createGlobalAuditHooks();

	return q({ name: "questpie-audit" })
		.collections({
			adminAuditLog: auditLogCollection,
		})
		.jobs({
			auditCleanup: auditCleanupJob,
		})
		.hooks({
			collections: {
				afterChange: collectionHooks.afterChange,
				afterDelete: collectionHooks.afterDelete,
				afterTransition: collectionHooks.afterTransition,
			},
			globals: {
				afterChange: globalHooks.afterChange,
				afterTransition: globalHooks.afterTransition,
			},
		});
}

/**
 * Default audit module instance with standard configuration.
 * Excludes internal collections and retains logs for 90 days.
 */
export const auditModule = createAuditModule();

// ============================================================================
// Dashboard helpers
// ============================================================================

const ACTION_ICONS: Record<string, ComponentReference> = {
	create: { type: "icon", props: { name: "ph:plus" } },
	update: { type: "icon", props: { name: "ph:pencil-simple" } },
	delete: { type: "icon", props: { name: "ph:trash" } },
	transition: { type: "icon", props: { name: "ph:arrows-left-right" } },
};

const ACTION_VARIANTS: Record<
	string,
	"success" | "info" | "error" | "warning" | "default"
> = {
	create: "success",
	update: "info",
	delete: "error",
	transition: "warning",
};

export interface AuditDashboardWidgetOptions {
	/** Maximum items to display. @default 10 */
	maxItems?: number;
	/** Grid span (1-4). @default 2 */
	span?: number;
}

/**
 * Create a dashboard timeline widget showing recent audit activity.
 * Drop into your `.dashboard()` config.
 *
 * @example
 * ```ts
 * .dashboard(({ d }) => d.dashboard({
 *   widgets: [
 *     createAuditDashboardWidget({ maxItems: 10 }),
 *   ],
 * }))
 * ```
 */
export function createAuditDashboardWidget(
	options?: AuditDashboardWidgetOptions,
): ServerTimelineWidget {
	const maxItems = options?.maxItems ?? 10;
	const span = options?.span ?? 2;

	return {
		type: "timeline",
		id: "audit-recent-activity",
		label: { key: "audit.widget.recentActivity.title" },
		maxItems,
		showTimestamps: true,
		timestampFormat: "relative",
		emptyMessage: { key: "audit.widget.recentActivity.empty" },
		span,
		loader: async (ctx: WidgetFetchContext) => {
			const app = ctx.app as any;
			const result = await app.api.collections.adminAuditLog.find({
				limit: maxItems,
				sort: { createdAt: "desc" },
				accessMode: "system",
				db: ctx.db,
			});

			const docs: Array<Record<string, any>> = result?.docs ?? [];

			return docs.map((row) => {
				const action = row.action || "update";
				const userName = row.userName || "System";
				const resourceLabel = row.resourceLabel
					? ` '${row.resourceLabel}'`
					: "";

				return {
					id: String(row.id),
					title: `${userName} ${action}d ${row.resource}${resourceLabel}`,
					timestamp: row.createdAt,
					icon: ACTION_ICONS[action] ?? ACTION_ICONS.update,
					variant: ACTION_VARIANTS[action] ?? ("default" as const),
				};
			});
		},
	};
}
