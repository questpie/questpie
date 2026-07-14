import { describe, expect, it } from "bun:test";

import { RealtimeSseControlRegistry } from "../../src/server/modules/core/integrated/realtime/sse-control.js";

describe("realtime SSE control", () => {
	it("requires the session token and unregisters with the edge session", async () => {
		const registry = new RealtimeSseControlRegistry<{ principal: string }>();
		const applied: string[] = [];
		const unregister = registry.register(
			"session-1",
			"secret",
			async (frames, context) => {
				applied.push(`${context.principal}:${frames[0].topicId}`);
			},
		);
		const frames = [{ type: "remove_topic" as const, topicId: "posts" }];

		expect(
			await registry.dispatch("session-1", "wrong", frames, {
				principal: "alice",
			}),
		).toBe(false);
		expect(
			await registry.dispatch("session-1", "secret", frames, {
				principal: "alice",
			}),
		).toBe(true);
		expect(applied).toEqual(["alice:posts"]);

		unregister();
		expect(
			await registry.dispatch("session-1", "secret", frames, {
				principal: "alice",
			}),
		).toBe(false);
	});
});
