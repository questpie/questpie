import { describe, expect, it } from "bun:test";

import { aiClientModule } from "../exports/client/modules/ai.js";
import { aiModule } from "../server/modules/ai/index.js";

describe("AI admin module registration", () => {
	it("keeps the default admin surface generic and infrastructure-only", () => {
		expect(Object.keys(aiModule.collections).sort()).toEqual([
			"ai_run_events",
			"ai_runs",
			"ai_worker_leases",
			"ai_workers",
		]);

		const [group] = aiModule.config.admin.sidebar.items;
		expect(group).toMatchObject({
			type: "group",
			label: { en: "AI" },
			icon: { type: "icon", props: { name: "ph:brain" } },
		});
		expect(group.items).toEqual([
			{ type: "collection", collection: "ai_runs" },
			{ type: "collection", collection: "ai_workers" },
		]);
		expect(aiModule.config.admin).not.toHaveProperty("shell");
	});

	it("keeps internal event and lease collections hidden from default navigation", () => {
		expect(aiModule.collections.ai_run_events.state.admin.hidden).toBe(true);
		expect(aiModule.collections.ai_worker_leases.state.admin.hidden).toBe(true);
	});

	it("does not register default AI admin components without server references", () => {
		expect(aiModule.components).toEqual({});
		expect(aiClientModule.components).toEqual({});
	});
});
