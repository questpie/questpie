export function configureSidebar({ s, c }: any) {
	return s.sidebar({
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
	});
}
