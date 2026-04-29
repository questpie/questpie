import type {
	DashboardContribution,
	WidgetFetchContext,
} from "@questpie/admin/server";

import { getCollections, getCountValue } from "./routes/_helpers.js";

const workflowsDashboardContribution: DashboardContribution = {
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
				const { instances } = getCollections(ctx);
				if (!instances.count)
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
					total: getCountValue(total),
					running: getCountValue(running),
					failed: getCountValue(failed),
					completed: getCountValue(completed),
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
				const { instances } = getCollections(ctx);

				const result = await instances.find(
					{
						sort: { createdAt: "desc" },
						limit: 10,
					},
					{ accessMode: "system" },
				);

				return result.docs.map((instance) => {
					const statusIcons: Record<
						string,
						{ type: string; props: Record<string, unknown> }
					> = {
						completed: {
							type: "icon",
							props: { name: "ph:check-circle", color: "green" },
						},
						failed: {
							type: "icon",
							props: { name: "ph:x-circle", color: "red" },
						},
						running: {
							type: "icon",
							props: { name: "ph:spinner", color: "blue" },
						},
						suspended: {
							type: "icon",
							props: { name: "ph:pause-circle", color: "orange" },
						},
						pending: {
							type: "icon",
							props: { name: "ph:clock", color: "gray" },
						},
						cancelled: {
							type: "icon",
							props: { name: "ph:prohibit", color: "gray" },
						},
						timed_out: {
							type: "icon",
							props: { name: "ph:timer", color: "red" },
						},
					};

					const statusVariants: Record<string, string> = {
						completed: "success",
						failed: "destructive",
						running: "info",
						suspended: "warning",
						pending: "default",
						cancelled: "secondary",
						timed_out: "destructive",
					};

					return {
						id: instance.id,
						title: instance.name,
						timestamp: instance.createdAt,
						icon: statusIcons[instance.status] ?? statusIcons.pending,
						variant: statusVariants[instance.status] ?? "default",
					};
				});
			},
		},
	],
};

export default workflowsDashboardContribution;
