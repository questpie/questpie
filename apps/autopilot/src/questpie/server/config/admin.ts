import { adminConfig } from "#questpie/factories";

export default adminConfig({
	branding: {
		name: { en: "Autopilot" },
		tagline: { en: "AI-powered task orchestration" },
		favicon: "/favicon.ico",
	},
	locale: {
		locales: ["en"],
		defaultLocale: "en",
	},
	sidebar: {
		sections: [
			{ id: "main", title: { en: "Main" } },
			{ id: "operations", title: { en: "Operations" } },
			{ id: "configuration", title: { en: "Configuration" } },
			{ id: "system", title: { en: "System" } },
		],
		items: [
			{
				sectionId: "main",
				type: "link",
				label: { en: "Dashboard" },
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{ sectionId: "main", type: "collection", collection: "tasks" },
			{ sectionId: "main", type: "collection", collection: "knowledge" },
			{ sectionId: "operations", type: "collection", collection: "runs" },
			{ sectionId: "operations", type: "collection", collection: "run_events" },
			{ sectionId: "operations", type: "collection", collection: "schedules" },
			{
				sectionId: "operations",
				type: "link",
				label: { en: "Project Inspection" },
				href: "/admin/project-inspection",
				icon: { type: "icon", props: { name: "ph:git-diff" } },
			},
			{
				sectionId: "configuration",
				type: "collection",
				collection: "providers",
			},
			{ sectionId: "configuration", type: "collection", collection: "models" },
			{
				sectionId: "configuration",
				type: "collection",
				collection: "capabilities",
			},
			{
				sectionId: "configuration",
				type: "collection",
				collection: "workflow_configs",
			},
			{
				sectionId: "configuration",
				type: "collection",
				collection: "environments",
			},
			{ sectionId: "configuration", type: "collection", collection: "scripts" },
			{ sectionId: "system", type: "collection", collection: "projects" },
			{ sectionId: "system", type: "collection", collection: "workers" },
			{ sectionId: "system", type: "collection", collection: "secrets" },
			{
				sectionId: "system",
				type: "link",
				label: { en: "Workflow Engine" },
				href: "/admin/workflows",
				icon: { type: "icon", props: { name: "ph:flow-arrow" } },
			},
			{ sectionId: "system", type: "collection", collection: "activity" },
		],
	},
	shell: {
		secondaryRail: {
			component: {
				type: "autopilotWorkRail",
				props: {},
			},
			placement: "left",
			width: 420,
			minWidth: 360,
			maxWidth: 480,
			hiddenOnMobile: true,
			routes: {
				include: ["/admin"],
				match: "prefix",
			},
		},
	},
	dashboard: {
		title: { en: "Autopilot" },
		description: { en: "AI task orchestration overview" },
		columns: 4,
		rowHeight: 144,
		gap: 4,
		realtime: true,
		items: [],
	},
});
