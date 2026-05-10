import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	name: "barbershop",
	crud: {
		defaults: {
			collections: { read: true, write: false, delete: false },
			globals: { read: true, write: false },
		},
		collections: {
			appointments: { read: true, write: true },
			user: false,
		},
	},
	routes: {
		exposeAnnotated: true,
	},
	resources: {
		schemas: true,
		routes: true,
	},
});
