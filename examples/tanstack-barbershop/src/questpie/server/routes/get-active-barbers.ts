import { route } from "questpie/services";
import z from "zod";

export default route()
	.post()
	.schema(z.object({}))
	.meta({
		title: "Get active barbers",
		description: "Returns all currently active barbers.",
		mcp: { expose: true, annotations: { readOnlyHint: true } },
	})
	.handler(async ({ collections }) => {
		return await collections.barbers.find({
			where: { isActive: true },
		});
	});
