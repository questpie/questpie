import { fn } from "questpie";
import z from "zod";

export default fn({
	schema: z.object({}),
	handler: async ({ app }) => {
		return await app.api.collections.barbers.find({
			where: { isActive: true },
		});
	},
});
