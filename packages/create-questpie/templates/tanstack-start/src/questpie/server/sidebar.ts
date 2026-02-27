/**
 * Sidebar — admin panel sidebar configuration.
 */
import { sidebar } from "#questpie";

export default sidebar(({ s, c }) =>
	s.sidebar({
		sections: [
			s.section({
				id: "main",
				title: "Content",
				items: [
					{
						type: "link",
						label: "Dashboard",
						href: "/admin",
						icon: c.icon("ph:house"),
					},
					{ type: "collection", collection: "posts" },
					{ type: "global", global: "siteSettings" },
				],
			}),
		],
	}));
