/**
 * Dashboard — custom dashboard configuration for the admin panel.
 */
import { dashboard } from "#questpie";

export default dashboard(({ d, c, a }) =>
	d.dashboard({
		title: "City Portal Dashboard",
		description: "Content management overview for your city portal",
		actions: [
			a.create({
				id: "new-page",
				collection: "pages",
				label: "New Page",
				icon: c.icon("ph:article"),
				variant: "primary",
			}),
			a.create({
				id: "new-article",
				collection: "news",
				label: "New Article",
				icon: c.icon("ph:newspaper"),
				variant: "outline",
			}),
			a.global({
				id: "edit-site-settings",
				global: "siteSettings",
				label: "Site Settings",
				icon: c.icon("ph:gear"),
				variant: "outline",
			}),
		],
		columns: 4,
		items: [
			{
				type: "section",
				label: "Content Overview",
				layout: "grid",
				columns: 4,
				items: [
					{
						id: "published-pages",
						type: "stats",
						collection: "pages",
						label: "Published Pages",
						filter: { isPublished: true },
						span: 1,
					},
					{
						id: "published-news",
						type: "stats",
						collection: "news",
						label: "News Articles",
						filter: { isPublished: true },
						span: 1,
					},
					{
						id: "active-announcements",
						type: "stats",
						collection: "announcements",
						label: "Announcements",
						span: 1,
					},
					{
						id: "new-submissions",
						type: "stats",
						collection: "submissions",
						label: "New Submissions",
						filter: { status: "new" },
						span: 1,
					},
				],
			},
			{
				type: "section",
				label: "Recent Activity",
				layout: "grid",
				columns: 4,
				items: [
					{
						id: "recent-submissions",
						type: "recentItems",
						collection: "submissions",
						label: "Recent Submissions",
						dateField: "createdAt",
						limit: 6,
						span: 2,
					},
					{
						id: "recent-news",
						type: "recentItems",
						collection: "news",
						label: "Latest News",
						dateField: "publishedAt",
						limit: 6,
						span: 2,
					},
				],
			},
		],
	}));
