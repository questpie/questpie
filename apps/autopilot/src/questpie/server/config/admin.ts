import { adminConfig } from "#questpie/factories";
import type { WidgetFetchContext } from "@questpie/admin/factories";

function countValue(result: unknown): number {
	if (typeof result === "number") return result;
	if (!result || typeof result !== "object") return 0;

	const count = (result as { count?: unknown }).count;
	return typeof count === "number" ? count : Number(count ?? 0);
}

async function countDocs(
	ctx: WidgetFetchContext,
	collection: string,
	where?: Record<string, unknown>,
): Promise<number> {
	const api = (ctx.collections as Record<string, any>)[collection];
	if (!api?.count) return 0;

	try {
		return countValue(
			await api.count(where ? { where } : {}, { accessMode: "system" }),
		);
	} catch {
		return 0;
	}
}

async function findDocs(
	ctx: WidgetFetchContext,
	collection: string,
	options: Record<string, unknown>,
): Promise<Array<Record<string, any>>> {
	const api = (ctx.collections as Record<string, any>)[collection];
	if (!api?.find) return [];

	try {
		const result = await api.find(options, { accessMode: "system" });
		return Array.isArray(result) ? result : (result?.docs ?? []);
	} catch {
		return [];
	}
}

export default adminConfig({
	branding: {
		name: { en: "Autopilot" },
		tagline: { en: "AI work assistant for your team" },
		favicon: "/favicon.ico",
	},
	locale: {
		locales: ["en"],
		defaultLocale: "en",
	},
	sidebar: {
		sections: [
			{ id: "work", title: { en: "Work" } },
			{ id: "knowledge", title: { en: "Knowledge" } },
			{ id: "automation", title: { en: "Automations" } },
			{ id: "settings", title: { en: "Settings" }, collapsible: true },
		],
		items: [
			{
				sectionId: "work",
				type: "link",
				label: { en: "Home" },
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{ sectionId: "work", type: "collection", collection: "tasks" },
			{ sectionId: "work", type: "collection", collection: "runs" },
			{ sectionId: "knowledge", type: "collection", collection: "knowledge" },
			{
				sectionId: "knowledge",
				type: "link",
				label: { en: "Project Inspection" },
				href: "/admin/project-inspection",
				icon: { type: "icon", props: { name: "ph:git-diff" } },
			},
			{ sectionId: "automation", type: "collection", collection: "schedules" },
			{
				sectionId: "automation",
				type: "collection",
				collection: "workflow_configs",
			},
			{
				sectionId: "settings",
				type: "collection",
				collection: "projects",
			},
			{
				sectionId: "settings",
				type: "collection",
				collection: "capabilities",
			},
			{
				sectionId: "settings",
				type: "collection",
				collection: "providers",
			},
			{
				sectionId: "settings",
				type: "collection",
				collection: "models",
			},
			{ sectionId: "settings", type: "collection", collection: "environments" },
			{ sectionId: "settings", type: "collection", collection: "scripts" },
			{ sectionId: "settings", type: "collection", collection: "workers" },
			{ sectionId: "settings", type: "collection", collection: "secrets" },
		],
	},
	dashboard: {
		title: { en: "Home" },
		description: {
			en: "What Autopilot is working on and what needs attention.",
		},
		columns: 4,
		rowHeight: 144,
		gap: 4,
		realtime: false,
		actions: [
			{
				id: "new-task",
				label: { en: "New task" },
				href: "/admin/collections/tasks/create",
				icon: { type: "icon", props: { name: "ph:plus" } },
				variant: "primary",
			},
			{
				id: "inspect-project",
				label: { en: "Inspect project" },
				href: "/admin/project-inspection",
				icon: { type: "icon", props: { name: "ph:git-diff" } },
				variant: "outline",
			},
		],
		sections: [
			{
				id: "work",
				label: { en: "Work queue" },
				description: { en: "Open work, active agent runs, and review items." },
				columns: 4,
				rowHeight: 132,
			},
			{
				id: "activity",
				label: { en: "Recent activity" },
				description: {
					en: "Latest visible updates from tasks and agent runs.",
				},
				columns: 4,
				rowHeight: 132,
			},
		],
		items: [
			{
				sectionId: "work",
				id: "open-tasks",
				type: "value",
				label: { en: "Open tasks" },
				icon: { type: "icon", props: { name: "ph:list-checks" } },
				span: 1,
				loader: async (ctx: WidgetFetchContext) => ({
					value: await countDocs(ctx, "tasks", {
						status: {
							in: ["backlog", "pending", "running", "waiting", "review"],
						},
					}),
					subtitle: { en: "Not done yet" },
				}),
			},
			{
				sectionId: "work",
				id: "active-runs",
				type: "value",
				label: { en: "Active runs" },
				icon: { type: "icon", props: { name: "ph:play-circle" } },
				span: 1,
				loader: async (ctx: WidgetFetchContext) => ({
					value: await countDocs(ctx, "runs", {
						status: { in: ["claimed", "running"] },
					}),
					subtitle: { en: "Agents currently working" },
				}),
			},
			{
				sectionId: "work",
				id: "needs-review",
				type: "value",
				label: { en: "Needs review" },
				icon: { type: "icon", props: { name: "ph:seal-check" } },
				span: 1,
				loader: async (ctx: WidgetFetchContext) => ({
					value: await countDocs(ctx, "tasks", { status: "review" }),
					subtitle: { en: "Waiting for a person" },
				}),
			},
			{
				sectionId: "work",
				id: "needs-attention",
				type: "value",
				label: { en: "Needs attention" },
				icon: { type: "icon", props: { name: "ph:warning-circle" } },
				span: 1,
				loader: async (ctx: WidgetFetchContext) => {
					const [failedTasks, failedRuns] = await Promise.all([
						countDocs(ctx, "tasks", { status: "failed" }),
						countDocs(ctx, "runs", { status: "failed" }),
					]);

					return {
						value: failedTasks + failedRuns,
						subtitle: { en: "Failed tasks or runs" },
					};
				},
			},
			{
				sectionId: "work",
				id: "quick-actions",
				type: "quickActions",
				label: { en: "Quick actions" },
				span: 1,
				rowSpan: 2,
				layout: "list",
				actions: [
					{
						label: { en: "Create task" },
						icon: { type: "icon", props: { name: "ph:plus" } },
						variant: "primary",
						action: { type: "create", collection: "tasks" },
					},
					{
						label: { en: "Add knowledge" },
						icon: { type: "icon", props: { name: "ph:brain" } },
						variant: "secondary",
						action: { type: "create", collection: "knowledge" },
					},
					{
						label: { en: "Create automation" },
						icon: { type: "icon", props: { name: "ph:calendar-check" } },
						variant: "secondary",
						action: { type: "create", collection: "schedules" },
					},
				],
			},
			{
				sectionId: "activity",
				id: "recent-activity",
				type: "timeline",
				label: { en: "Latest updates" },
				span: 4,
				rowSpan: 2,
				maxItems: 12,
				showTimestamps: true,
				timestampFormat: "relative",
				emptyMessage: { en: "No activity yet" },
				loader: async (ctx: WidgetFetchContext) => {
					const docs = await findDocs(ctx, "activity", {
						limit: 12,
						sort: { createdAt: "desc" },
					});

					return docs.map((row) => ({
						id: String(row.id),
						title: String(row.summary || row.type || "Activity"),
						description: row.actor ? `By ${row.actor}` : undefined,
						timestamp: row.createdAt,
						icon: {
							type: "icon",
							props: { name: "ph:clock-counter-clockwise" },
						},
						variant:
							typeof row.type === "string" && row.type.includes("failed")
								? "error"
								: "default",
						href: row.task
							? `/admin/collections/tasks/${row.task}`
							: row.run
								? `/admin/collections/runs/${row.run}`
								: undefined,
					}));
				},
			},
		],
	},
});
