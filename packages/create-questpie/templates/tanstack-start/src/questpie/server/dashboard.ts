export function configureDashboard({ d }: any) {
	return d.dashboard({
		title: "Dashboard",
		description: "Overview of your content",
		columns: 4,
		items: [
			{
				type: "section",
				label: "Content",
				layout: "grid",
				columns: 2,
				items: [
					{
						id: "total-posts",
						type: "stats",
						collection: "posts",
						label: "Total Posts",
						span: 1,
					},
					{
						id: "published-posts",
						type: "stats",
						collection: "posts",
						label: "Published",
						filter: { published: true },
						variant: "primary",
						span: 1,
					},
				],
			},
			{
				type: "section",
				label: "Recent",
				layout: "grid",
				columns: 4,
				items: [
					{
						id: "recent-posts",
						type: "recentItems",
						collection: "posts",
						label: "Recent Posts",
						limit: 5,
						span: 2,
					},
					{
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
		],
	});
}
