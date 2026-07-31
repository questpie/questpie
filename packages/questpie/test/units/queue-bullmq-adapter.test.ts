import { describe, expect, test } from "bun:test";

import { BullMQAdapter } from "../../src/server/modules/core/integrated/queue/adapters/bullmq.js";

describe("BullMQAdapter logical dispatch", () => {
	test("fails closed for secret dispatch even though ordinary attempts still expose final-attempt metadata", () => {
		const adapter = new BullMQAdapter({
			connection: { host: "127.0.0.1", port: 6379 },
		});

		expect(adapter.capabilities.executionTerminalState).toBe(false);
		expect(
			(adapter as any).toQueueJobRecord({
				id: "retrying",
				data: { value: "one" },
				attemptsMade: 0,
				opts: { attempts: 2 },
			}).finalAttempt,
		).toBe(false);
		expect(
			(adapter as any).toQueueJobRecord({
				id: "terminal",
				data: { value: "two" },
				attemptsMade: 1,
				opts: { attempts: 2 },
			}).finalAttempt,
		).toBe(true);
	});

	test("maps dispatch idempotency and singleton scheduling independently", async () => {
		const adapter = new BullMQAdapter({
			connection: { host: "127.0.0.1", port: 6379 },
		});
		const calls: Array<{
			name: string;
			data: unknown;
			options: Record<string, unknown>;
		}> = [];
		(adapter as any).getQueue = () => ({
			add: async (
				name: string,
				data: unknown,
				options: Record<string, unknown>,
			) => {
				calls.push({ name, data, options });
				return { id: options.jobId };
			},
		});
		const dispatchId = "0e79a7d5-da2f-55e7-ae4c-3e95c5633071";
		const singletonDispatchId = "71ef0739-b21f-4c60-a7bc-cb8da739da6e";

		await expect(
			adapter.publish(
				"notify",
				{ value: "portable" },
				{
					idempotencyKey: "notify:one",
					retryLimit: 2,
				},
				dispatchId,
			),
		).resolves.toBe(dispatchId);
		await expect(
			adapter.publish(
				"notify",
				{ value: "singleton" },
				{ singletonKey: "tenant-1" },
				singletonDispatchId,
			),
		).resolves.toBe(singletonDispatchId);

		expect(calls).toEqual([
			{
				name: "notify",
				data: {
					__questpieQueue: {
						version: 1,
						dispatchId,
						idempotencyKey: "notify:one",
					},
					payload: { value: "portable" },
				},
				options: {
					attempts: 3,
					jobId: dispatchId,
				},
			},
			{
				name: "notify",
				data: {
					__questpieQueue: {
						version: 1,
						dispatchId: singletonDispatchId,
					},
					payload: { value: "singleton" },
				},
				options: {
					deduplication: { id: "tenant-1" },
					jobId: singletonDispatchId,
				},
			},
		]);
	});
});
