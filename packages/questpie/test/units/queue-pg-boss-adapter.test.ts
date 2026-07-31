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
	public completeCalls: Array<{ name: string; id: string }> = [];
	public sendCalls: Array<{
		name: string;
		data: unknown;
		options: Record<string, unknown>;
	}> = [];
	public fetchedJobs: any[] = [];
	public inspectedJobs = new Map<string, any>();
	public inspectionCalls: Array<{
		name: string;
		id: string;
		options?: Record<string, unknown>;
	}> = [];
	public workCallbacks = new Map<string, WorkCallback>();
	public workOptions = new Map<string, Record<string, unknown>>();
	public fetchOptions: Record<string, unknown> | undefined;
	public sendResult: string | null | undefined;

	async start(): Promise<void> {
		this.started = true;
	}
	async stop(): Promise<void> {
		this.started = false;
	}
	async createQueue(name: string): Promise<void> {
		this.createdQueues.push(name);
	}
	async send(
		name: string,
		data: unknown,
		options: Record<string, unknown>,
	): Promise<string | null> {
		this.sendCalls.push({ name, data, options });
		return this.sendResult === undefined
			? String(options.id ?? "fake-id")
			: this.sendResult;
	}
	async work(
		name: string,
		options: Record<string, unknown>,
		callback: WorkCallback,
	): Promise<string> {
		this.workOptions.set(name, options);
		this.workCallbacks.set(name, callback);
		return `worker-${name}`;
	}
	async fail(name: string, id: string, data: unknown): Promise<void> {
		this.failCalls.push({ name, id, data });
	}
	async complete(name: string, id: string): Promise<void> {
		this.completeCalls.push({ name, id });
	}
	async fetch(
		_name?: string,
		options?: Record<string, unknown>,
	): Promise<any[]> {
		this.fetchOptions = options;
		return this.fetchedJobs.splice(0);
	}
	async getJobById(
		name: string,
		id: string,
		options?: Record<string, unknown>,
	): Promise<any> {
		this.inspectionCalls.push({ name, id, options });
		return this.inspectedJobs.get(`${name}:${id}`) ?? null;
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
	it("publishes through the supplied Drizzle transaction with stable dispatch metadata", async () => {
		const { adapter, fake } = makeAdapter();
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		const tx = {
			execute: async () => ({ rows: [] }),
		};

		await expect(
			adapter.publishInTransaction(
				tx,
				"notify",
				{ value: "transactional" },
				{ idempotencyKey: "notify:one", retryLimit: 2 },
				dispatchId,
			),
		).resolves.toBe(dispatchId);

		expect(fake.sendCalls).toHaveLength(1);
		expect(fake.sendCalls[0]).toMatchObject({
			name: "notify",
			data: {
				__questpieQueue: {
					version: 1,
					dispatchId,
					idempotencyKey: "notify:one",
				},
				payload: { value: "transactional" },
			},
			options: {
				id: dispatchId,
				retryLimit: 2,
			},
		});
		const sendCall = fake.sendCalls[0];
		if (!sendCall) throw new Error("Expected one pg-boss send call");
		expect(typeof sendCall.options.db).toBe("object");
		expect(typeof (sendCall.options.db as any).executeSql).toBe("function");
	});

	it("can opt out of the application transaction for a separate pg-boss database", () => {
		const adapter = new PgBossAdapter({
			useApplicationTransaction: false,
		} as any);

		expect(adapter.transactionalPublishing).toBe(false);
	});

	it("recovers the caller-supplied physical identity when stable-id replay conflicts", async () => {
		const { adapter, fake } = makeAdapter();
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		fake.sendResult = null;
		fake.inspectedJobs.set(`notify:${dispatchId}`, { id: dispatchId });

		await expect(
			adapter.publish(
				"notify",
				{ value: "replayed" },
				{ idempotencyKey: "notify:replayed" },
				dispatchId,
			),
		).resolves.toBe(dispatchId);
		expect(fake.inspectionCalls).toEqual([
			{ name: "notify", id: dispatchId, options: undefined },
		]);
	});

	it("fails publication when null is caused by a different queue-policy conflict", async () => {
		const { adapter, fake } = makeAdapter();
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		fake.sendResult = null;

		await expect(
			adapter.publish(
				"notify",
				{ value: "suppressed-by-another-job" },
				{ idempotencyKey: "notify:distinct", queuePolicy: "short" },
				dispatchId,
			),
		).rejects.toThrow("QUESTPIE pg-boss publication was not accepted");
		expect(fake.inspectionCalls).toEqual([
			{ name: "notify", id: dispatchId, options: undefined },
		]);
	});

	it("proves transactional replay through the same transaction connection", async () => {
		const { adapter, fake } = makeAdapter();
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		const tx = {
			execute: async () => ({ rows: [] }),
		};
		fake.sendResult = null;
		fake.inspectedJobs.set(`notify:${dispatchId}`, { id: dispatchId });

		await expect(
			adapter.publishInTransaction(
				tx,
				"notify",
				{ value: "transactional-replay" },
				{ idempotencyKey: "notify:transactional-replay" },
				dispatchId,
			),
		).resolves.toBe(dispatchId);

		const transactionDb = fake.sendCalls[0]?.options.db;
		expect(transactionDb).toBeDefined();
		expect(fake.inspectionCalls).toEqual([
			{
				name: "notify",
				id: dispatchId,
				options: { db: transactionDb },
			},
		]);
	});

	it("fails transactional publication when the exact physical id is absent", async () => {
		const { adapter, fake } = makeAdapter();
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		const tx = {
			execute: async () => ({ rows: [] }),
		};
		fake.sendResult = null;

		await expect(
			adapter.publishInTransaction(
				tx,
				"notify",
				{ value: "suppressed-by-another-job" },
				{
					idempotencyKey: "notify:transactional-distinct",
					queuePolicy: "short",
				},
				dispatchId,
			),
		).rejects.toThrow("QUESTPIE pg-boss publication was not accepted");
	});

	it("completes successful runOnce jobs and fails handler errors", async () => {
		const { adapter, fake } = makeAdapter();
		fake.fetchedJobs.push({ id: "once-ok", data: { value: "ok" } });

		await expect(
			adapter.runOnce({
				echo: async () => {},
			}),
		).resolves.toEqual({ processed: 1 });
		expect(fake.completeCalls).toEqual([{ name: "echo", id: "once-ok" }]);

		fake.fetchedJobs.push({ id: "once-bad", data: { value: "bad" } });
		await expect(
			adapter.runOnce({
				echo: async () => {
					throw new Error("runOnce failed");
				},
			}),
		).rejects.toThrow("runOnce failed");
		expect(fake.failCalls.at(-1)).toMatchObject({
			name: "echo",
			id: "once-bad",
			data: { message: "runOnce failed" },
		});
	});

	it("settles every fetched runOnce job before surfacing a batch failure", async () => {
		const { adapter, fake } = makeAdapter();
		fake.fetchedJobs.push(
			{ id: "once-bad-first", data: { fail: true } },
			{ id: "once-ok-second", data: { fail: false } },
		);

		await expect(
			adapter.runOnce({
				echo: async ({ data }) => {
					if ((data as { fail: boolean }).fail) {
						throw new Error("first job failed");
					}
				},
			}),
		).rejects.toThrow("first job failed");

		expect(fake.failCalls).toEqual([
			expect.objectContaining({ name: "echo", id: "once-bad-first" }),
		]);
		expect(fake.completeCalls).toEqual([
			{ name: "echo", id: "once-ok-second" },
		]);
	});

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

	it("reports terminal-attempt metadata from long-running pg-boss work", async () => {
		const { adapter, fake } = makeAdapter();
		const attempts: boolean[] = [];
		await adapter.listen({
			echo: async ({ finalAttempt }) => {
				attempts.push(finalAttempt === true);
			},
		});

		expect(fake.workOptions.get("echo")).toMatchObject({
			includeMetadata: true,
		});
		await fake.workCallbacks.get("echo")!([
			{
				id: "retrying",
				data: {},
				retryCount: 0,
				retryLimit: 1,
			},
			{
				id: "terminal",
				data: {},
				retryCount: 1,
				retryLimit: 1,
			},
		]);

		expect(attempts).toEqual([false, true]);
	});

	it("requests and reports terminal-attempt metadata in runOnce", async () => {
		const { adapter, fake } = makeAdapter();
		const attempts: boolean[] = [];
		fake.fetchedJobs.push(
			{
				id: "retrying",
				data: {},
				retryCount: 0,
				retryLimit: 1,
			},
			{
				id: "terminal",
				data: {},
				retryCount: 1,
				retryLimit: 1,
			},
		);

		await adapter.runOnce({
			echo: async ({ finalAttempt }) => {
				attempts.push(finalAttempt === true);
			},
		});

		expect(fake.fetchOptions).toMatchObject({
			includeMetadata: true,
		});
		expect(attempts).toEqual([false, true]);
	});

	it("source-qualifies broker terminal states for crash-recovery reconciliation", async () => {
		const { adapter, fake } = makeAdapter();
		fake.inspectedJobs.set("echo:completed", { state: "completed" });
		fake.inspectedJobs.set("echo:failed", { state: "failed" });
		fake.inspectedJobs.set("echo:cancelled", { state: "cancelled" });
		fake.inspectedJobs.set("echo:active", { state: "active" });
		fake.inspectedJobs.set("echo:retry", { state: "retry" });

		await expect(
			adapter.inspectExecutionState!("echo", "completed"),
		).resolves.toBe("completed");
		await expect(
			adapter.inspectExecutionState!("echo", "failed"),
		).resolves.toBe("failed");
		await expect(
			adapter.inspectExecutionState!("echo", "cancelled"),
		).resolves.toBe("failed");
		await expect(
			adapter.inspectExecutionState!("echo", "active"),
		).resolves.toBe("active");
		await expect(adapter.inspectExecutionState!("echo", "retry")).resolves.toBe(
			"pending",
		);
		await expect(
			adapter.inspectExecutionState!("echo", "retained-record-missing"),
		).resolves.toBe("missing");
	});
});
