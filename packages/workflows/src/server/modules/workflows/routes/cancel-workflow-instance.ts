import { route } from "questpie";
import { z } from "zod";

import { getCollections } from "./_helpers.js";

export default route()
	.post()
	.schema(z.object({ id: z.string() }))
	.handler(async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);

		const instance = await instances.findOne(
			{ where: { id: input.id } },
			{ accessMode: "system" },
		);

		if (!instance) {
			throw new Error(`Workflow instance not found: ${input.id}`);
		}

		const activeStatuses = ["pending", "running", "suspended"];
		if (!activeStatuses.includes(instance.status)) {
			return { success: false, reason: `Instance is ${instance.status}` };
		}

		await instances.updateById(
			{
				id: input.id,
				data: {
					status: "cancelled",
					completedAt: new Date(),
				},
			},
			{ accessMode: "system" },
		);

		return { success: true };
	});
