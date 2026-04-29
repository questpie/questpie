import { route } from "questpie";
import { z } from "zod";

import { getCollections, getTotalDocs } from "./_helpers.js";

export default route()
	.post()
	.schema(
		z.object({
			status: z.string().optional(),
			name: z.string().optional(),
			limit: z.number().min(1).max(250).default(50),
			page: z.number().min(1).default(1),
		}),
	)
	.handler(async ({ input, ...ctx }) => {
		const { instances } = getCollections(ctx);

		const where: Record<string, unknown> = {};
		if (input.status) where.status = input.status;
		if (input.name) where.name = input.name;

		const result = await instances.find(
			{
				where,
				sort: { createdAt: "desc" },
				limit: input.limit,
				page: input.page,
			},
			{ accessMode: "system" },
		);

		return {
			docs: result.docs,
			totalDocs: getTotalDocs(result),
			page: input.page,
			limit: input.limit,
		};
	});
