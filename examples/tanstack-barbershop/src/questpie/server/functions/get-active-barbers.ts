import { fn } from "questpie";
import z from "zod";

export default fn({
	schema: z.object({}),
	handler: async ({ collections }) => {
		return await collections.barbers.find({
			where: { isActive: true },
		});
	},
});
