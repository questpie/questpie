/**
 * City Portal Sidebar Configuration
 *
 * Defines the admin sidebar structure for managing city content.
 */

import { qb } from "@/questpie/server/builder";

export const sidebar = qb.sidebar(({ s, c }) =>
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
					{ type: "global", global: "siteSettings" },
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
