import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(z.object({}))
	.handler(async ({ collections }) => {
		return await collections.barbers.find({
			where: { isActive: true },
		});
	});
