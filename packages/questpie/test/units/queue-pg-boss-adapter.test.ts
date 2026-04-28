/**
 * Regression test for the pg-boss adapter's v10+ compatibility.
 *
 * pg-boss v10+ (and the v12 we depend on) calls the work() callback with
 * `Job<T>[]` regardless of batchSize. The adapter previously destructured
 * `job.id` / `job.data` directly off the array → both undefined → the
 * downstream Zod-validated handler always saw `undefined` and rejected
 * every job before reaching user code.
 *
 * The fix iterates the array, dispatches each item to the registered
 * handler, and reports per-item failures via `boss.fail(jobName, id, …)`
 * so siblings in the same batch can still complete.
 */

import { describe, expect, it, mock } from "bun:test";

import { z } from "zod";

import { PgBossAdapter } from "../../src/server/modules/core/integrated/queue/adapters/pg-boss.js";

// ---------------------------------------------------------------------------
// Minimal pg-boss double: captures the work() callback so the test can fire
// a v12-style array-shaped invocation through the adapter without spinning
// up a real Postgres / pg-boss instance.
// ---------------------------------------------------------------------------

type WorkCallback = (jobs: any) => Promise<unknown>;

class FakePgBoss {
	public started = false;
	public createdQueues: string[] = [];
	public failCalls: Array<{ name: string; id: string; data: unknown }> = [];
	public workCallbacks = new Map<string, WorkCallback>();

	async start(): Promise<void> {
		this.started = true;
	}
	async stop(): Promise<void> {
		this.started = false;
	}
	async createQueue(name: string): Promise<void> {
		this.createdQueues.push(name);
	}
	async send(): Promise<string> {
		return "fake-id";
	}
	async work(
		name: string,
		_options: unknown,
		callback: WorkCallback,
	): Promise<string> {
		this.workCallbacks.set(name, callback);
		return `worker-${name}`;
	}
	async fail(name: string, id: string, data: unknown): Promise<void> {
		this.failCalls.push({ name, id, data });
	}
}

function makeAdapter() {
	const fake = new FakePgBoss();
	const adapter = new PgBossAdapter({} as any);
	// Replace the real PgBoss instance with our double — the adapter only
	// touches the methods we stub.
	(adapter as any).boss = fake;
	return { adapter, fake };
}

describe("PgBossAdapter — v10+ work() callback receives Job[]", () => {
	it("dispatches each job in the array to the handler with the correct payload", async () => {
		const { adapter, fake } = makeAdapter();

		const schema = z.object({ value: z.string() });
		const seen: Array<{ id: string; value: string }> = [];

		await adapter.listen({
			echo: async ({ id, data }) => {
				const parsed = schema.parse(data);
				seen.push({ id, value: parsed.value });
			},
		});

		const callback = fake.workCallbacks.get("echo");
		expect(callback).toBeDefined();

		// Simulate pg-boss firing the worker with a batch of 5 jobs — the v12
		// shape is always `Job<T>[]`, even when batchSize === 1.
		await callback!([
			{ id: "j-1", data: { value: "one" } },
			{ id: "j-2", data: { value: "two" } },
			{ id: "j-3", data: { value: "three" } },
			{ id: "j-4", data: { value: "four" } },
			{ id: "j-5", data: { value: "five" } },
		]);

		expect(seen).toEqual([
			{ id: "j-1", value: "one" },
			{ id: "j-2", value: "two" },
			{ id: "j-3", value: "three" },
			{ id: "j-4", value: "four" },
			{ id: "j-5", value: "five" },
		]);
		// All jobs handled successfully → nothing was reported as failed.
		expect(fake.failCalls).toEqual([]);
	});

	it("handler is never called with undefined payload (array vs single object)", async () => {
		const { adapter, fake } = makeAdapter();

		const handler = mock(async () => {});
		await adapter.listen({ echo: handler });

		const callback = fake.workCallbacks.get("echo")!;

		// Pre-fix bug: destructuring off the array yielded `undefined` for both
		// `id` and `data`, which then failed Zod parse upstream. The fix must
		// always pass through the underlying job object.
		await callback([{ id: "a", data: { value: "x" } }]);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0]?.[0]).toEqual({
			id: "a",
			data: { value: "x" },
		});

		// Defensive: even if a future pg-boss version reverts to a single
		// object (or hands us undefined), the adapter must not blow up and
		// must not call the handler with garbage.
		handler.mockClear();
		await callback({ id: "b", data: { value: "y" } });
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler.mock.calls[0]?.[0]).toEqual({
			id: "b",
			data: { value: "y" },
		});
	});

	it("reports per-item handler failures via boss.fail and keeps processing siblings", async () => {
		const { adapter, fake } = makeAdapter();

		const seen: string[] = [];
		await adapter.listen({
			echo: async ({ id, data }) => {
				if ((data as any).value === "boom") {
					throw new Error(`handler exploded on ${id}`);
				}
				seen.push(id);
			},
		});

		const callback = fake.workCallbacks.get("echo")!;

		await callback([
			{ id: "ok-1", data: { value: "one" } },
			{ id: "bad-2", data: { value: "boom" } },
			{ id: "ok-3", data: { value: "three" } },
		]);

		// Siblings of the failing job still completed.
		expect(seen).toEqual(["ok-1", "ok-3"]);
		// The failing job was reported to pg-boss for retry — siblings were not.
		expect(fake.failCalls).toHaveLength(1);
		const failed = fake.failCalls[0]!;
		expect(failed.name).toBe("echo");
		expect(failed.id).toBe("bad-2");
		expect((failed.data as { message: string }).message).toBe(
			"handler exploded on bad-2",
		);
	});
});
