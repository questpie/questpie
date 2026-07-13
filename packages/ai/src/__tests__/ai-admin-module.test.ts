import { describe, expect, it } from "bun:test";

import { aiClientModule } from "../exports/client/modules/ai.js";
import { aiModule } from "../server/modules/ai/index.js";

describe("AI admin module registration", () => {
	it("keeps the default admin surface generic and infrastructure-only", () => {
		expect(Object.keys(aiModule.collections).sort()).toEqual([
			"ai_worker_leases",
			"ai_workers",
		]);

		expect(aiModule.config.admin.sidebar.items).toEqual([]);
		expect(aiModule.config.admin).not.toHaveProperty("shell");
	});

	it("keeps AI infrastructure collections hidden from default navigation", () => {
		expect(aiModule.collections.ai_worker_leases.state.admin.hidden).toBe(true);
		expect(aiModule.collections.ai_workers.state.admin.hidden).toBe(true);
	});

	it("does not register default AI admin components without server references", () => {
		expect(aiModule.components).toEqual({});
		expect(aiClientModule.components).toEqual({});
	});
});
