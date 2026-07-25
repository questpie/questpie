import { describe, expect, it } from "bun:test";

import { createGracefulServerShutdown } from "../../src/server/config/graceful-server-shutdown.js";

describe("graceful server shutdown", () => {
	it("destroys the app only after the Fetch server drains held requests", async () => {
		const order: string[] = [];
		let releaseDrain!: () => void;
		const drain = new Promise<void>((resolve) => {
			releaseDrain = resolve;
		});
		const lifecycle = createGracefulServerShutdown(async () => {
			order.push("destroy");
		});
		lifecycle.attach({
			async close() {
				order.push("drain:start");
				await drain;
				order.push("drain:end");
			},
		});

		const first = lifecycle.shutdown();
		const second = lifecycle.shutdown();
		await Promise.resolve();
		expect(order).toEqual(["drain:start"]);
		releaseDrain();
		await Promise.all([first, second]);
		expect(order).toEqual(["drain:start", "drain:end", "destroy"]);
	});

	it("still destroys app resources when server drain reports an error", async () => {
		let destroyed = 0;
		const lifecycle = createGracefulServerShutdown(async () => {
			destroyed++;
		});
		lifecycle.attach({
			async close() {
				throw new Error("drain failed");
			},
		});

		await expect(lifecycle.shutdown()).rejects.toThrow("drain failed");
		expect(destroyed).toBe(1);
	});
});
