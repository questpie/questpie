import { describe, expect, it } from "bun:test";

import { generateOpenApiSpec } from "@questpie/openapi/server";

import coreModule from "../../../packages/questpie/src/server/modules/core/.generated/module";
import modules from "../src/questpie/server/modules";
import createBooking from "../src/questpie/server/routes/create-booking";
import getActiveBarbers from "../src/questpie/server/routes/get-active-barbers";
import getAvailableTimeSlots from "../src/questpie/server/routes/get-available-time-slots";
import getRevenueStats from "../src/questpie/server/routes/get-revenue-stats";

function collectModuleRoutes(
	input: readonly Record<string, any>[],
): Record<string, unknown> {
	const routes: Record<string, unknown> = {};
	for (const module of input) {
		if (Array.isArray(module.modules)) {
			Object.assign(routes, collectModuleRoutes(module.modules));
		}
		Object.assign(routes, module.routes ?? {});
	}
	return routes;
}

describe("barbershop generated OpenAPI route snapshot", () => {
	it("includes application and post-realtime-v2 module routes", async () => {
		const routes = {
			...coreModule.routes,
			...collectModuleRoutes(modules),
			createBooking,
			getActiveBarbers,
			getAvailableTimeSlots,
			getRevenueStats,
		};
		const app = {
			getCollections: () => ({}),
			getGlobals: () => ({}),
			config: { routes },
		};
		const spec = await generateOpenApiSpec(app, {
			basePath: "/api",
			auth: false,
			search: false,
			info: { title: "Barbershop API", version: "1.0.0" },
		});

		const selectedPaths = [
			"/api/channels/auth",
			"/api/channels/config",
			"/api/channels/publish",
			"/api/realtime",
			"/api/realtime/auth",
			"/api/realtime/config",
			"/api/create-booking",
			"/api/get-active-barbers",
			"/api/get-available-time-slots",
			"/api/get-revenue-stats",
		];
		const routeSnapshot = {
			pathCount: Object.keys(spec.paths).length,
			methods: Object.fromEntries(
				selectedPaths.map((path) => [
					path,
					Object.keys(spec.paths[path] ?? {}).sort(),
				]),
			),
		};

		expect(routeSnapshot).toEqual({
			pathCount: 57,
			methods: {
				"/api/channels/auth": ["options", "post"],
				"/api/channels/config": ["get"],
				"/api/channels/publish": ["options", "post"],
				"/api/create-booking": ["post"],
				"/api/get-active-barbers": ["post"],
				"/api/get-available-time-slots": ["post"],
				"/api/get-revenue-stats": ["post"],
				"/api/realtime": ["post"],
				"/api/realtime/auth": ["post"],
				"/api/realtime/config": ["get"],
			},
		});
	});
});
