import { route } from "questpie";
import { z } from "zod";

import { getCollections, getQueue } from "./_helpers.js";

export default route()
	.post()
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
							completedAt: null,
						},
					},
					{ accessMode: "system" },
				);

				await executeQueue.publish({
					instanceId: instance.id,
					workflowName: instance.name,
				});

				retriedCount++;
			} catch {
				// Best-effort
			}
		}

		return { retriedCount };
	});
