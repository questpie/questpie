import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-appointment-cancellation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
	}),
	handler: async ({ payload }) => {
		console.log(
			`Sending cancellation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
		);
	},
});
