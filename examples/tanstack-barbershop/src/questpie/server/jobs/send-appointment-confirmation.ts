import { eq } from "drizzle-orm";
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-appointment-confirmation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
	}),
	handler: async ({ payload, app }) => {
		const userTable = app.config.collections.user.table;
		const customer = await app.db
			.select({ email: userTable.email, name: userTable.name })
			.from(userTable)
			.where(eq(userTable.id as any, payload.customerId) as any)
			.limit(1)
			.then((res: any[]) => res[0]);

		await app.email.send({
			to: (customer?.email || "") as string,
			subject: "Appointment Confirmation",
			text: `Dear ${customer?.name || "Customer"},\n\nYour appointment (ID: ${payload.appointmentId}) has been confirmed.\n\nThank you!`,
		});
	},
});
