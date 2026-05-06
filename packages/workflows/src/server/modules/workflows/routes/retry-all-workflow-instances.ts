import { route } from "questpie";
import { z } from "zod";

import { workflowRouteAccess } from "./_access.js";
import { getCollections, getQueue } from "./_helpers.js";

export default route()
	.post()
	.access(workflowRouteAccess("retry"))
	.schema(z.object({ name: z.string() }))
	.handler(async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);
		const executeQueue = getQueue(ctx, "questpie-wf-execute");

		const result = await instances.find(
			{
				where: {
					name: input.name,
					status: { in: ["failed", "timed_out"] },
				},
				limit: 1000,
			},
			{ accessMode: "system" },
		);

		let retriedCount = 0;
		for (const instance of result.docs) {
			try {
				await instances.updateById(
					{
						id: instance.id,
						data: {
							status: "pending",
							error: null,
							lockOwner: null,
							lockedAt: null,
							lockExpiresAt: null,
							completedAt: null,
						},
					},
					{ accessMode: "system" },
				);

				await executeQueue.publish(
					{
						instanceId: instance.id,
						workflowName: instance.name,
					},
					{ singletonKey: instance.id },
				);

				retriedCount++;
			} catch {
				// Best-effort
			}
		}

		return { retriedCount };
	});
