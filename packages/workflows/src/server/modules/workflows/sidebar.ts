import type { SidebarContribution } from "@questpie/admin/server";

const workflowsSidebarContribution: SidebarContribution = {
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
};

export default workflowsSidebarContribution;
