import { adminConfig } from "#questpie/factories";

export default adminConfig({
	branding: {
		name: "{{projectName}}",
	},
	sidebar: {
		sections: [
			{
				id: "main",
				title: "Content",
				items: [
					{
						type: "link",
						label: "Dashboard",
						href: "/admin",
						icon: { type: "icon", props: { name: "ph:house" } },
					},
					{ type: "collection", collection: "posts" },
					{ type: "global", global: "siteSettings" },
				],
			},
		],
	},
	dashboard: {
		title: "Dashboard",
		description: "Overview of your content",
		columns: 4,
		sections: [
			{ id: "content", label: "Content", layout: "grid", columns: 2 },
			{ id: "recent", label: "Recent", layout: "grid", columns: 4 },
		],
		items: [
			{
				sectionId: "content",
				id: "total-posts",
				type: "stats",
				collection: "posts",
				label: "Total Posts",
				span: 1,
			},
			{
				sectionId: "content",
				id: "published-posts",
				type: "stats",
				collection: "posts",
				label: "Published",
				filter: { published: true },
				variant: "primary",
				span: 1,
			},
			{
				sectionId: "recent",
				id: "recent-posts",
				type: "recentItems",
				collection: "posts",
				label: "Recent Posts",
				limit: 5,
				span: 2,
			},
			{
				sectionId: "recent",
				id: "quick-actions",
				type: "quickActions",
				label: "Quick Actions",
				actions: [
					{
						label: "New Post",
						action: { type: "create", collection: "posts" },
					},
					{
						label: "Site Settings",
						action: {
							type: "link",
							href: "/admin/globals/siteSettings",
						},
					},
				],
				span: 2,
			},
		],
	},
});
