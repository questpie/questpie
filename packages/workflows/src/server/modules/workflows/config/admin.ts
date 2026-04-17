import type {
	ComponentReference,
	WidgetFetchContext,
} from "@questpie/admin/server";
import { adminConfig } from "@questpie/admin/server";

// ============================================================================
// Dashboard helpers
// ============================================================================

const STATUS_ICONS: Record<string, ComponentReference> = {
	completed: {
		type: "icon",
		props: { name: "ph:check-circle", color: "green" },
	},
	failed: { type: "icon", props: { name: "ph:x-circle", color: "red" } },
	running: { type: "icon", props: { name: "ph:spinner", color: "blue" } },
	suspended: {
		type: "icon",
		props: { name: "ph:pause-circle", color: "orange" },
	},
	pending: { type: "icon", props: { name: "ph:clock", color: "gray" } },
	cancelled: { type: "icon", props: { name: "ph:prohibit", color: "gray" } },
	timed_out: { type: "icon", props: { name: "ph:timer", color: "red" } },
};

const STATUS_VARIANTS: Record<string, string> = {
	completed: "success",
	failed: "destructive",
	running: "info",
	suspended: "warning",
	pending: "default",
	cancelled: "secondary",
	timed_out: "destructive",
};

// ============================================================================
// Workflows admin config
// ============================================================================

export default adminConfig({
	sidebar: {
		sections: [
			{
				id: "workflows",
				title: { en: "Workflows" },
				icon: { type: "icon", props: { name: "ph:flow-arrow" } },
			},
		],
		items: [
			{
				sectionId: "workflows",
				type: "page",
				pageId: "workflows",
				label: { en: "All Workflows" },
				icon: { type: "icon", props: { name: "ph:list-bullets" } },
			},
		],
	},
	dashboard: {
		sections: [
			{
				id: "workflows",
				label: { en: "Workflows" },
			},
		],
		items: [
			{
				sectionId: "workflows",
				id: "workflow-stats",
				type: "custom",
				widgetType: "workflow-stats",
				label: { en: "Workflow Status" },
				span: 2,
				loader: async (ctx: WidgetFetchContext) => {
					const collections = (ctx as any).collections;
					const instances = collections?.wf_instance;
					if (!instances)
						return { total: 0, running: 0, failed: 0, completed: 0 };

					const [total, running, failed, completed] = await Promise.all([
						instances.count({}, { accessMode: "system" }),
						instances.count(
							{ where: { status: "running" } },
							{ accessMode: "system" },
						),
						instances.count(
							{ where: { status: "failed" } },
							{ accessMode: "system" },
						),
						instances.count(
							{ where: { status: "completed" } },
							{ accessMode: "system" },
						),
					]);

					return {
						total: (total as any).totalDocs ?? total,
						running: (running as any).totalDocs ?? running,
						failed: (failed as any).totalDocs ?? failed,
						completed: (completed as any).totalDocs ?? completed,
					};
				},
			},
			{
				sectionId: "workflows",
				id: "workflow-recent",
				type: "timeline",
				label: { en: "Recent Workflows" },
				span: 2,
				maxItems: 10,
				showTimestamps: true,
				timestampFormat: "relative" as const,
				loader: async (ctx: WidgetFetchContext) => {
					const collections = (ctx as any).collections;
					const instances = collections?.wf_instance;
					if (!instances) return [];

					const result = await instances.find(
						{
							sort: { createdAt: "desc" },
							limit: 10,
						},
						{ accessMode: "system" },
					);

					return result.docs.map((instance: any) => ({
						id: instance.id,
						title: instance.name,
						timestamp: instance.createdAt,
						icon: STATUS_ICONS[instance.status] ?? STATUS_ICONS.pending,
						variant: STATUS_VARIANTS[instance.status] ?? "default",
					}));
				},
			},
		],
	},
});
