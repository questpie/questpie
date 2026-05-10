import { email } from "questpie/services";
import { z } from "zod";

export default email({
	name: "production-scheduled",
	schema: z.object({
		orderNo: z.string(),
		toyName: z.string(),
		quantity: z.number(),
		plannedStart: z.string(),
		plannedFinish: z.string(),
	}),
	handler: ({ input }) => ({
		subject: `Production scheduled: ${input.orderNo}`,
		html: `
			<div style="font-family: Arial, sans-serif; max-width: 560px; padding: 24px;">
				<h1 style="margin: 0 0 12px;">Production scheduled</h1>
				<p>Order <strong>${input.orderNo}</strong> is ready for production.</p>
				<table style="width: 100%; border-collapse: collapse;">
					<tr><td style="padding: 6px 0;">Toy</td><td>${input.toyName}</td></tr>
					<tr><td style="padding: 6px 0;">Quantity</td><td>${input.quantity}</td></tr>
					<tr><td style="padding: 6px 0;">Start</td><td>${input.plannedStart}</td></tr>
					<tr><td style="padding: 6px 0;">Finish</td><td>${input.plannedFinish}</td></tr>
				</table>
			</div>
		`,
	}),
});
