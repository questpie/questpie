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
	shell: {
		secondaryRail: {
			component: { type: "autopilotWorkRail", props: {} },
			placement: "right",
			width: 420,
			minWidth: 360,
			maxWidth: 480,
			hiddenOnMobile: true,
		},
	},
	sidebar: {
		sections: [
			{
				id: "product",
				items: [
					{
						type: "link",
						label: { en: "Home" },
						href: "/admin",
						icon: { type: "icon", props: { name: "ph:house" } },
					},
					{
						type: "collection",
						collection: "tasks",
						label: { en: "Issues" },
						icon: { type: "icon", props: { name: "ph:list-checks" } },
					},
					{
						type: "collection",
						collection: "schedules",
						label: { en: "Schedules" },
						icon: { type: "icon", props: { name: "ph:calendar-check" } },
					},
					{
						type: "collection",
						collection: "assets",
						label: { en: "Files" },
						icon: { type: "icon", props: { name: "ph:folders" } },
					},
					{
						type: "collection",
						collection: "projects",
						label: { en: "Projects" },
						icon: { type: "icon", props: { name: "ph:folder-notch" } },
					},
				],
			},
			{
				id: "settings",
				title: { en: "Settings" },
				icon: { type: "icon", props: { name: "ph:gear-six" } },
				collapsible: true,
				items: [
					{
						type: "collection",
						collection: "user",
						label: { en: "Team" },
						icon: { type: "icon", props: { name: "ph:users" } },
					},
				],
				sections: [
					{
						id: "settings:advanced",
						title: { en: "Advanced" },
						collapsible: true,
						items: [
							{
								type: "collection",
								collection: "run_links",
								label: { en: "Executions" },
								icon: { type: "icon", props: { name: "ph:terminal-window" } },
							},
							{
								type: "collection",
								collection: "providers",
								label: { en: "Connections" },
								icon: { type: "icon", props: { name: "ph:plugs" } },
							},
							{
								type: "collection",
								collection: "models",
								label: { en: "Models" },
								icon: { type: "icon", props: { name: "ph:cpu" } },
							},
							{
								type: "collection",
								collection: "environments",
								label: { en: "Environments" },
								icon: { type: "icon", props: { name: "ph:tree-structure" } },
							},
							{
								type: "collection",
								collection: "secrets",
								label: { en: "Secrets" },
								icon: { type: "icon", props: { name: "ph:key" } },
							},
							{
								type: "collection",
								collection: "scripts",
								label: { en: "Scripts" },
								icon: { type: "icon", props: { name: "ph:code" } },
							},
						],
					},
				],
			},
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
				id: "new-issue",
				label: { en: "New issue" },
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
				label: { en: "Issue queue" },
				description: {
					en: "Open issues, review items, and automation health.",
				},
				columns: 4,
				rowHeight: 132,
			},
			{
				id: "activity",
				label: { en: "Recent activity" },
				description: {
					en: "Latest visible updates from issues and workflow executions.",
				},
				columns: 4,
				rowHeight: 132,
			},
		],
		items: [
			{
				sectionId: "work",
				id: "open-issues",
				type: "value",
				label: { en: "Open issues" },
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
				id: "active-executions",
				type: "value",
				label: { en: "Active executions" },
				icon: { type: "icon", props: { name: "ph:play-circle" } },
				span: 1,
				loader: async (ctx: WidgetFetchContext) => ({
					value: await countDocs(ctx, "run_links", {
						status: { in: ["claimed", "running"] },
					}),
					subtitle: { en: "Workflows currently running" },
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
						countDocs(ctx, "run_links", { status: "failed" }),
					]);

					return {
						value: failedTasks + failedRuns,
						subtitle: { en: "Failed issues or executions" },
					};
				},
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
								? `/admin/collections/run_links/${row.run}`
								: undefined,
					}));
				},
			},
		],
	},
});
