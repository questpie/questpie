import { describe, expect, it } from "bun:test";

import {
	questpieHono,
	questpieMiddleware,
	type QuestpieVariables,
} from "../src/server.js";

const generatedApp = {
	config: {
		routes: {},
		logger: {},
	},
	collections: {},
	globals: {},
} as const;

describe("hono adapter public types", () => {
	it("accepts generated app-like types at the adapter boundary", () => {
		const variablesApp: QuestpieVariables<typeof generatedApp>["app"] =
			generatedApp;

		expect(questpieHono(generatedApp, { basePath: "/api" })).toBeDefined();
		expect(questpieMiddleware(generatedApp)).toBeDefined();
		expect(variablesApp).toBe(generatedApp);
	});
});
