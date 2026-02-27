import { email } from "questpie";
import { z } from "zod";

export default email({
	name: "appointment-confirmation",
	schema: z.object({
		customerName: z.string(),
		appointmentId: z.string(),
		barberName: z.string(),
		serviceName: z.string(),
		scheduledAt: z.string(),
	}),
	handler: ({ input }) => ({
		subject: "Appointment Confirmed \u2713",
		html: `
			<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
				<h1 style="font-size: 24px; margin-bottom: 4px;">\u2713 Appointment Confirmed</h1>
				<p style="color: #666; margin-bottom: 24px;">
					Hi ${input.customerName}, your appointment is confirmed!
				</p>

				<div style="background: #fafafa; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
					<table style="width: 100%; border-collapse: collapse;">
						<tbody>
							<tr>
								<td style="padding: 8px 0; color: #6b7280; font-weight: 500; width: 120px;">Service</td>
								<td style="padding: 8px 0; font-weight: 600;">${input.serviceName}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #6b7280; font-weight: 500; width: 120px;">Barber</td>
								<td style="padding: 8px 0; font-weight: 600;">${input.barberName}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #6b7280; font-weight: 500; width: 120px;">Date &amp; Time</td>
								<td style="padding: 8px 0; font-weight: 600;">${input.scheduledAt}</td>
							</tr>
							<tr>
								<td style="padding: 8px 0; color: #6b7280; font-weight: 500; width: 120px;">Booking ID</td>
								<td style="padding: 8px 0; font-weight: 600;">#${input.appointmentId.slice(0, 8).toUpperCase()}</td>
							</tr>
						</tbody>
					</table>
				</div>

				<p style="color: #444; font-size: 14px;">
					Need to reschedule? Contact us at least 24 hours in advance.
				</p>

				<hr style="margin: 32px 0; border-color: #eee;" />
				<p style="font-size: 12px; color: #999;">
					Barbershop — see you soon!
				</p>
			</div>
		`,
	}),
});
