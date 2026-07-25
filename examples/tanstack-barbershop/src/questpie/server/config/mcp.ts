import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	name: "barbershop",
	crud: {
		collections: {
			appointments: {
				operations: {
					list: true,
					count: true,
					get: true,
					create: true,
					update: true,
				},
			},
		},
	},
	routes: {
		routes: {
			getActiveBarbers: { operations: { execute: true } },
			getAvailableTimeSlots: { operations: { execute: true } },
			getRevenueStats: { operations: { execute: true } },
		},
	},
	resources: {
		collections: { appointments: true },
		routes: {
			getActiveBarbers: true,
			getAvailableTimeSlots: true,
			getRevenueStats: true,
		},
	},
});
