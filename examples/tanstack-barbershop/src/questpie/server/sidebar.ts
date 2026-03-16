/**
 * Sidebar — project-level sidebar contribution.
 * Merged with module contributions (admin adds "administration" section,
 * audit adds audit log item to "administration").
 */
import { sidebar } from "#questpie/factories";

export default sidebar({
	sections: [
		{ id: "overview", title: { en: "Overview", sk: "Prehľad" } },
		{ id: "operations", title: { en: "Operations", sk: "Prevádzka" } },
		{ id: "content", title: { en: "Content", sk: "Obsah" } },
		{ id: "team", title: { en: "Team", sk: "Tím" } },
		{ id: "external", title: { en: "External", sk: "Externé" } },
		// Override admin module's "administration" section title for this project
		{
			id: "administration",
			title: { en: "Administration", sk: "Administrácia" },
		},
	],
	items: [
		// Overview
		{
			sectionId: "overview",
			type: "link",
			label: { en: "Dashboard", sk: "Dashboard" },
			href: "/admin",
			icon: { type: "icon", props: { name: "ph:house" } },
		},
		{
			sectionId: "overview",
			type: "global",
			global: "site_settings",
		},
		// Operations
		{
			sectionId: "operations",
			type: "collection",
			collection: "appointments",
		},
		{
			sectionId: "operations",
			type: "collection",
			collection: "reviews",
		},
		// Content
		{
			sectionId: "content",
			type: "collection",
			collection: "pages",
		},
		{
			sectionId: "content",
			type: "collection",
			collection: "services",
		},
		// Team
		{
			sectionId: "team",
			type: "collection",
			collection: "barbers",
		},
		// External
		{
			sectionId: "external",
			type: "link",
			label: { en: "Open Website", sk: "Otvoriť web" },
			href: "/",
			external: true,
			icon: { type: "icon", props: { name: "ph:arrow-square-out" } },
		},
	],
});
