import type {
	ComponentReference,
	DashboardContribution,
	WidgetFetchContext,
} from "../../augmentation.js";

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
		const result = await (ctx.collections as any).admin_audit_log.find({
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
// Dashboard contribution
// ============================================================================

/**
 * Dashboard contribution from the audit module.
 * Provides a timeline widget showing recent audit activity.
 */
const dashboardContribution: DashboardContribution = {
	sections: [{ id: "activity", label: { key: "audit.section.activity" } }],
	items: [
		{
			sectionId: "activity",
			id: "audit-recent-activity",
			type: "timeline",
			label: { key: "audit.widget.recentActivity.title" },
			maxItems: 10,
			showTimestamps: true,
			timestampFormat: "relative",
			emptyMessage: { key: "audit.widget.recentActivity.empty" },
			span: 2,
			loader: createAuditTimelineLoader(10),
		},
	],
};

export default dashboardContribution;
