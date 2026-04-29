import { route } from "questpie";
import { z } from "zod";
import { getCollections } from "./_helpers.js";

export default route()
	.post()
	.schema(z.object({ name: z.string() }))
	.handler(async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);

		const activeStatuses = ["pending", "running", "suspended"];
		const result = await instances.find(
			{
				where: {
					name: input.name,
					status: { in: activeStatuses },
				},
				limit: 1000,
			},
			{ accessMode: "system" },
		);

		const now = new Date();
		let cancelledCount = 0;
		for (const instance of result.docs) {
			try {
				await instances.updateById(
					{
						id: instance.id,
						data: {
							status: "cancelled",
							completedAt: now,
						},
					},
					{ accessMode: "system" },
				);
				cancelledCount++;
			} catch {
				// Best-effort
			}
		}

		return { cancelledCount };
	});
