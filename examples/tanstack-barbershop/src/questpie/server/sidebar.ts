import { qb } from "@/questpie/server/builder";

export const sidebar = qb.sidebar(({ s, c }) =>
	s.sidebar({

		sections: [
			s.section({
				id: "overview",
				title: { en: "Overview", sk: "Prehľad" },
				items: [
					{
						type: "link",
						label: { en: "Dashboard", sk: "Dashboard" },
						href: "/admin",
						icon: c.icon("ph:house"),
					},
					{ type: "global", global: "siteSettings" },
				],
			}),
			s.section({
				id: "operations",
				title: { en: "Operations", sk: "Prevádzka" },
				items: [
					{ type: "collection", collection: "appointments" },
					{ type: "collection", collection: "reviews" },
				],
			}),
			s.section({
				id: "content",
				title: { en: "Content", sk: "Obsah" },
				items: [
					{ type: "collection", collection: "pages" },
					{ type: "collection", collection: "services" },
				],
			}),
			s.section({
				id: "team",
				title: { en: "Team", sk: "Tím" },
				items: [
					{ type: "collection", collection: "barbers" },
					{ type: "collection", collection: "barberServices" },
				],
			}),
			s.section({
				id: "external",
				title: { en: "External", sk: "Externé" },
				items: [
					{
						type: "link",
						label: { en: "Open Website", sk: "Otvoriť web" },
						href: "/",
						external: true,
						icon: c.icon("ph:arrow-square-out"),
					},
				],
			}),
		],
	}))
