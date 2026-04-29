import { route } from "questpie";
import { z } from "zod";

import { getCollections, getQueue } from "./_helpers.js";

export default route()
	.post()
	.schema(z.object({ id: z.string() }))
	.handler(async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		if (instance.status !== "failed" && instance.status !== "timed_out") {
			return {
				success: false,
				reason: `Can only retry failed/timed_out instances, current: ${instance.status}`,
			};
		}

		// Reset to pending
		await instances.updateById(
			{
				id: input.id,
				data: {
					status: "pending",
					error: null,
					completedAt: null,
				},
			},
			{ accessMode: "system" },
		);

		// Re-queue execution
		await executeQueue.publish({
			instanceId: input.id,
			workflowName: instance.name,
		});

		return { success: true };
	});
