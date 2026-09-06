import { expect, spyOn, test } from "bun:test";

import { createStartShutdown } from "../../packages/questpie/cli/telemetry";
import { startDurableWorkerPolling } from "../../packages/questpie/cli/worker";

test("CLI shutdown drains the pending worker but starts application close before joining it", async () => {
	const order: string[] = [];
	const pending = Promise.withResolvers<void>();
	const polling = startDurableWorkerPolling({
		poll() {
			order.push("worker.poll");
			return pending.promise;
		},
		beginDrain() {
			order.push("worker.drain");
		},
	});
	const shutdown = createStartShutdown({
		stopIngress() {
			order.push("ingress.stop");
		},
		stopWorker: () => polling.stop(Date.now() + 1000),
		application: {
			async close() {
				order.push("application.close");
				pending.resolve();
			},
		},
		telemetry: {
			observability: {},
			async close() {
				order.push("telemetry.close");
			},
		},
	});
	const first = shutdown();
	expect(shutdown()).toBe(first);
	await first;
	expect(order).toEqual([
		"worker.poll",
		"ingress.stop",
		"worker.drain",
		"application.close",
		"telemetry.close",
	]);
});

test("CLI poll joining has a deadline without claiming to cancel noncooperative JavaScript", async () => {
	let calls = 0;
	let drains = 0;
	const pending = Promise.withResolvers<void>();
	const polling = startDurableWorkerPolling({
		poll() {
			calls += 1;
			return pending.promise;
		},
		beginDrain() {
			drains += 1;
		},
	});
	const stopped = polling.stop(Date.now() + 20);
	expect(polling.stop(Date.now() + 1000)).toBe(stopped);
	await expect(stopped).rejects.toThrow(
		"durable worker shutdown deadline exceeded",
	);
	expect(drains).toBe(1);
	pending.resolve();
	await Bun.sleep(30);
	expect(calls).toBe(1);
});

test("CLI resumes the same worker after poll failure with a fixed nondisclosing diagnostic", async () => {
	const output = spyOn(console, "error").mockImplementation(() => {});
	const resumed = Promise.withResolvers<void>();
	let calls = 0;
	const polling = startDurableWorkerPolling({
		async poll() {
			calls += 1;
			if (calls === 1) throw new Error("secret authored input");
			resumed.resolve();
		},
		beginDrain() {},
	});
	try {
		await resumed.promise;
		await polling.stop(Date.now() + 1000);
		expect(calls).toBe(2);
		expect(output.mock.calls).toEqual([
			["questpie: durable worker poll failed"],
		]);
	} finally {
		await polling.stop(Date.now() + 1000);
		output.mockRestore();
	}
});
