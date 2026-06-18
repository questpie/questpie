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
			},
		],
		items: [
			{
				sectionId: "main",
				type: "link",
				label: "Dashboard",
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{ sectionId: "main", type: "collection", collection: "posts" },
			{ sectionId: "main", type: "global", global: "siteSettings" },
		],
	},
	dashboard: {
		title: "Dashboard",
		description: "Overview of your content",
		columns: 4,
		actions: [
			{
				id: "new-post",
				label: "New Post",
				href: "/admin/collections/posts/create",
				icon: { type: "icon", props: { name: "ph:article" } },
				variant: "primary",
			},
			{
				id: "site-settings",
				label: "Site Settings",
				href: "/admin/globals/siteSettings",
				icon: { type: "icon", props: { name: "ph:gear" } },
				variant: "outline",
			},
		],
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
		],
	},
});
