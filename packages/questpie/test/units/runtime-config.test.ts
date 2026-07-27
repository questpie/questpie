import { describe, expect, test } from "bun:test";

import { runtimeConfig } from "../../src/server/config/create-app.js";

describe("runtimeConfig", () => {
	test("normalizes realtime true to default realtime config", () => {
		const config = runtimeConfig({
			db: { url: "postgres://localhost/test" },
			realtime: true,
		});

		expect(config.realtime).toEqual({});
	});
});
