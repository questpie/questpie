/**
 * Sidebar — custom sidebar configuration for the admin panel.
 */
import { sidebar } from "#questpie/factories";

export default sidebar(({ s, c }) =>
	s.sidebar({
		sections: [
			s.section({
				id: "overview",
				title: "Overview",
				items: [
					{
						type: "link",
						label: "Dashboard",
						href: "/admin",
						icon: c.icon("ph:house"),
					},
					{ type: "global", global: "site_settings" },
				],
			}),
			s.section({
				id: "content",
				title: "Content",
				items: [
					{ type: "collection", collection: "pages" },
					{ type: "collection", collection: "news" },
					{ type: "collection", collection: "announcements" },
				],
			}),
			s.section({
				id: "resources",
				title: "Resources",
				items: [
					{ type: "collection", collection: "documents" },
					{ type: "collection", collection: "contacts" },
				],
			}),
			s.section({
				id: "engagement",
				title: "Engagement",
				items: [{ type: "collection", collection: "submissions" }],
			}),
			s.section({
				id: "administration",
				title: "Administration",
				items: [
					{ type: "collection", collection: "cities" },
					{ type: "collection", collection: "cityMembers" },
				],
			}),
			s.section({
				id: "external",
				title: "External",
				items: [
					{
						type: "link",
						label: "View Website",
						href: "/",
						external: true,
						icon: c.icon("ph:arrow-square-out"),
					},
				],
			}),
		],
	}),
);
