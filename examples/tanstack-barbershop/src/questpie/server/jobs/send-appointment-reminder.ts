import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-appointment-reminder",
	schema: z.object({
		appointmentId: z.string(),
	}),
	handler: async ({ payload }) => {
		console.log(
			`Sending reminder email for appointment ${payload.appointmentId}`,
		);
	},
});
