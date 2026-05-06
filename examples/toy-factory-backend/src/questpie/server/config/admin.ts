import { adminConfig } from "#questpie/factories";

export default adminConfig({
	branding: {
		name: "Toy Factory Ops",
	},
	sidebar: {
		sections: [
			{
				id: "planning",
				title: "Planning",
			},
			{
				id: "factory",
				title: "Factory",
			},
			{
				id: "settings",
				title: "Settings",
			},
		],
		items: [
			{
				sectionId: "planning",
				type: "link",
				label: "Dashboard",
				href: "/admin",
				icon: { type: "icon", props: { name: "ph:house" } },
			},
			{
				sectionId: "planning",
				type: "collection",
				collection: "productionOrders",
			},
			{ sectionId: "planning", type: "collection", collection: "operations" },
			{
				sectionId: "planning",
				type: "collection",
				collection: "inventoryMovements",
			},
			{ sectionId: "factory", type: "collection", collection: "toys" },
			{ sectionId: "factory", type: "collection", collection: "toyMaterials" },
			{ sectionId: "factory", type: "collection", collection: "materials" },
			{ sectionId: "factory", type: "collection", collection: "machines" },
			{ sectionId: "settings", type: "global", global: "siteSettings" },
		],
	},
	dashboard: {
		title: "Production Dashboard",
		description: "Plan orders, reserve materials, and monitor factory flow",
		columns: 4,
		actions: [
			{
				id: "new-order",
				label: "New Production Order",
				href: "/admin/collections/productionOrders/create",
				icon: { type: "icon", props: { name: "ph:clipboard-text" } },
				variant: "primary",
			},
			{
				id: "factory-settings",
				label: "Factory Settings",
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
				id: "open-orders",
				type: "stats",
				collection: "productionOrders",
				label: "Production Orders",
				span: 1,
			},
			{
				sectionId: "content",
				id: "material-shortages",
				type: "stats",
				collection: "productionOrders",
				label: "Material Shortages",
				filter: { materialStatus: "shortage" },
				variant: "primary",
				span: 1,
			},
			{
				sectionId: "content",
				id: "available-machines",
				type: "stats",
				collection: "machines",
				label: "Available Machines",
				filter: { status: "available" },
				span: 1,
			},
			{
				sectionId: "recent",
				id: "recent-orders",
				type: "recentItems",
				collection: "productionOrders",
				label: "Recent Orders",
				limit: 5,
				span: 2,
			},
		],
	},
});
