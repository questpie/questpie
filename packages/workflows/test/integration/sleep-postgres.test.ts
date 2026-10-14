import { describe, expect, test } from "bun:test";

import { z } from "zod";

import { wfMaintenanceJob } from "../../src/server/modules/workflows/jobs/wf-maintenance.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import {
	createPostgresWorkflowHarness,
	databaseUrl,
	systemContext,
	waitFor,
} from "./postgres-helpers.js";

describe.skipIf(!databaseUrl)("scheduled workflow sleep on PostgreSQL", () => {
	for (const kind of ["sleepUntil", "sleep"] as const) {
		test(`${kind} resumes at its deadline without maintenance, once with duplicate recovery`, async () => {
			let completed = 0;
			let resumedAt = 0;
			let target = 0;
			const definition: WorkflowDefinition = {
				name: "precise-sleep",
				schema: z.object({}),
				handler: async ({ step }) => {
					if (kind === "sleepUntil")
						await step.sleepUntil("nap", new Date(target));
					else await step.sleep("nap", "10s");
					await step.run("effect", async () => {
						completed++;
						resumedAt = Date.now();
					});
				},
			};
			const harness = await createPostgresWorkflowHarness({
				"precise-sleep": definition,
			});
			try {
				const instance = await harness.collections.wf_instance.create(
					{ name: definition.name, status: "pending", input: {} },
					systemContext,
				);
				target = Date.now() + 10_000;
				await harness.queue["questpie-wf-execute"].publish({
					instanceId: instance.id,
					workflowName: definition.name,
				});
				await harness.drain();
				const step = await harness.collections.wf_step.findOne(
					{ where: { instanceId: instance.id, name: "nap" } },
					systemContext,
				);
				target = new Date(step.scheduledAt).getTime();
				expect(step.status).toBe("sleeping");
				await waitFor(async () => {
					await harness.drain();
					if (Date.now() < target) expect(completed).toBe(0);
					return completed === 1;
				}, 12_000);
				expect(resumedAt).toBeGreaterThanOrEqual(target);
				expect(resumedAt - target).toBeLessThan(1_500);
				// A stale sweep can already have observed the step before the timer won.
				await Promise.all([
					harness.queue["questpie-wf-resume"].publish({
						instanceId: instance.id,
						stepName: "nap",
					}),
					wfMaintenanceJob.handler({ ...harness, payload: {} }),
				]);
				await harness.drain();
				await harness.drain();
				expect(completed).toBe(1);
				const final = await harness.collections.wf_instance.findOne(
					{ where: { id: instance.id } },
					systemContext,
				);
				expect(final.status).toBe("completed");
			} finally {
				await harness.cleanup();
			}
		}, 30_000);
	}
});
