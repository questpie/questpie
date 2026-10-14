import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { createWorkflowClient } from "../../src/server/client.js";
import { wfMaintenanceJob } from "../../src/server/modules/workflows/jobs/wf-maintenance.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import {
	createPostgresWorkflowHarness,
	databaseUrl,
	systemContext,
	waitFor,
} from "./postgres-helpers.js";

describe.skipIf(!databaseUrl)("workflow event deadlines on PostgreSQL", () => {
	for (const { eventFirst, dropTimer } of [
		{ eventFirst: false, dropTimer: false },
		{ eventFirst: true, dropTimer: false },
		{ eventFirst: false, dropTimer: true },
	]) {
		test(`5-second wait resolves once (${eventFirst ? "event wins" : dropTimer ? "maintenance recovery" : "timeout wins"})`, async () => {
			const results: unknown[] = [];
			const definition: WorkflowDefinition = {
				name: "event-deadline",
				schema: z.object({}),
				handler: async ({ step }) => {
					const result = await step.waitForEvent("wait", {
						event: "ready",
						match: { id: 1 },
						timeout: "5s",
					});
					await step.run("effect", async () => {
						results.push(result);
					});
					return result;
				},
			};
			const harness = await createPostgresWorkflowHarness({
				"event-deadline": definition,
			});
			if (dropTimer) {
				const publish = harness.queue["questpie-wf-resume"].publish;
				harness.queue["questpie-wf-resume"].publish = async (
					payload,
					options,
				) => {
					if (options?.startAfter) return;
					return publish(payload, options);
				};
			}
			const client = createWorkflowClient(
				{ "event-deadline": definition },
				{
					instances: harness.collections.wf_instance,
					steps: harness.collections.wf_step,
					events: harness.collections.wf_event,
					publishExecute: harness.queue["questpie-wf-execute"],
					publishResume: harness.queue["questpie-wf-resume"],
				},
			);
			try {
				const instance = await client.trigger("event-deadline", {});
				await harness.drain();
				const waiting = await harness.collections.wf_step.findOne(
					{ where: { instanceId: instance.instanceId, name: "wait" } },
					systemContext,
				);
				const deadline = new Date(waiting.scheduledAt).getTime();
				if (eventFirst)
					await client.sendEvent("ready", { value: "delivered" }, { id: 1 });
				await waitFor(async () => {
					if (dropTimer && Date.now() >= deadline)
						await wfMaintenanceJob.handler({ ...harness, payload: {} });
					await harness.drain();
					if (!eventFirst && Date.now() < deadline)
						expect(results).toHaveLength(0);
					return results.length === 1;
				}, 7_000);
				expect(results).toEqual([eventFirst ? { value: "delivered" } : null]);
				if (eventFirst) expect(Date.now()).toBeLessThan(deadline);
				else expect(Date.now() - deadline).toBeLessThan(1_500);
				await Bun.sleep(Math.max(0, deadline - Date.now()) + 50);
				await wfMaintenanceJob.handler({ ...harness, payload: {} });
				await harness.drain();
				await harness.drain();
				expect(results).toHaveLength(1);
				const final = await client.getInstance(instance.instanceId);
				expect(final?.output).toEqual(
					eventFirst ? { value: "delivered" } : null,
				);
			} finally {
				await harness.cleanup();
			}
		}, 15_000);
	}
	test("concurrent event and timeout atomically preserve the winning result", async () => {
		let effects = 0;
		const definition: WorkflowDefinition = {
			name: "boundary",
			schema: z.object({}),
			handler: async ({ step }) => {
				const result = await step.waitForEvent("wait", {
					event: "ready",
					timeout: "1s",
				});
				await step.run("effect", async () => {
					effects++;
				});
				return result;
			},
		};
		const harness = await createPostgresWorkflowHarness({
			boundary: definition,
		});
		try {
			const instance = await harness.collections.wf_instance.create(
				{ name: "boundary", status: "pending", input: {} },
				systemContext,
			);
			await harness.queue["questpie-wf-execute"].publish({
				instanceId: instance.id,
				workflowName: "boundary",
			});
			await harness.drain();
			const step = await harness.collections.wf_step.findOne(
				{ where: { instanceId: instance.id, name: "wait" } },
				systemContext,
			);
			await Bun.sleep(
				Math.max(0, new Date(step.scheduledAt).getTime() - Date.now()) + 20,
			);
			await harness.queue["questpie-wf-resume"].publish({
				instanceId: instance.id,
				stepName: "wait",
				result: { winner: "event" },
			});
			let reads = 0;
			let release!: () => void;
			const bothRead = new Promise<void>((resolve) => {
				release = resolve;
			});
			const findOne = harness.collections.wf_step.findOne.bind(
				harness.collections.wf_step,
			);
			harness.collections.wf_step.findOne = async (
				...args: Parameters<typeof findOne>
			) => {
				const row = await findOne(...args);
				if (row?.status === "waiting") {
					if (++reads >= 2) release();
					await bothRead;
				}
				return row;
			};
			let claims = 0;
			const updateMany = harness.collections.wf_step.updateMany.bind(
				harness.collections.wf_step,
			);
			harness.collections.wf_step.updateMany = async (
				...args: Parameters<typeof updateMany>
			) => {
				const rows = await updateMany(...args);
				claims += rows.length;
				return rows;
			};
			await Promise.all([harness.drain(1), harness.drain(1)]);
			expect(reads).toBe(2);
			expect(claims).toBe(1);
			await waitFor(async () => {
				await harness.drain();
				return effects === 1;
			});
			const settled = await findOne({ where: { id: step.id } }, systemContext);
			const final = await harness.collections.wf_instance.findOne(
				{ where: { id: instance.id } },
				systemContext,
			);
			expect(final.output).toEqual(settled.result);
			expect(effects).toBe(1);
		} finally {
			await harness.cleanup();
		}
	}, 15_000);
});
