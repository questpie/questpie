import type {
	ComponentReference,
	WidgetFetchContext,
} from "../../../augmentation.js";
import { adminConfig } from "../../../augmentation.js";
import { AUDIT_LOG_COLLECTION } from "../collections/audit-log.js";

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

/**
 * Create an audit timeline loader for the dashboard widget.
 */
function createAuditTimelineLoader(maxItems: number) {
	return async (ctx: WidgetFetchContext) => {
		const result = await (ctx.collections as any)[AUDIT_LOG_COLLECTION].find({
			limit: maxItems,
			sort: { createdAt: "desc" },
			accessMode: "system",
			db: ctx.db,
		});

		const docs: Array<Record<string, any>> = result?.docs ?? [];

		return docs.map((row) => {
			const action = row.action || "update";
			const userName = row.userName || "System";
			const resourceLabel = row.resourceLabel ? ` '${row.resourceLabel}'` : "";

			return {
				id: String(row.id),
				title: `${userName} ${action}d ${row.resource}${resourceLabel}`,
				timestamp: row.createdAt,
				icon: ACTION_ICONS[action] ?? ACTION_ICONS.update,
				variant: ACTION_VARIANTS[action] ?? ("default" as const),
			};
		});
	};
}

// ============================================================================
// Audit admin config
// ============================================================================

/**
 * Admin config from the audit module.
 * Adds audit log to the "administration" sidebar section
 * and provides a timeline dashboard widget.
 */
export default adminConfig({
	sidebar: {
		items: [
			{
				sectionId: "administration",
				type: "collection",
				collection: AUDIT_LOG_COLLECTION,
				icon: { type: "icon", props: { name: "ph:clipboard-text" } },
			},
		],
	},
});

/**
 * Audit timeline dashboard widget factory.
 *
 * Use in your `adminConfig({ dashboard: { items: [...] } })`:
 * ```ts
 * import { createAuditTimelineWidget } from "@questpie/admin/server";
 *
 * adminConfig({
 *   dashboard: {
 *     items: [
 *       createAuditTimelineWidget({ sectionId: "activity", span: 2 }),
 *     ],
 *   },
 * });
 * ```
 */
export { createAuditTimelineLoader };
