import { email } from "questpie/services";
import { z } from "zod";

export default email({
	name: "appointment-cancellation",
	schema: z.object({
		customerName: z.string(),
		appointmentId: z.string(),
		barberName: z.string(),
		serviceName: z.string(),
		scheduledAt: z.string(),
		cancellationReason: z.string().optional(),
	}),
	handler: ({ input }) => ({
		subject: "Appointment Cancelled",
		html: `
			<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
				<h1 style="font-size: 24px; margin-bottom: 4px;">✕ Appointment Cancelled</h1>
				<p style="color: #666; margin-bottom: 24px;">
					Hi ${input.customerName}, your appointment has been cancelled.
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
							${
								input.cancellationReason
									? `<tr>
											<td style="padding: 8px 0; color: #6b7280; font-weight: 500; width: 120px; vertical-align: top;">Reason</td>
											<td style="padding: 8px 0; font-weight: 600;">${input.cancellationReason}</td>
										</tr>`
									: ""
							}
						</tbody>
					</table>
				</div>

				<p style="color: #444; font-size: 14px;">
					Want to rebook? Visit our website to schedule a new appointment.
				</p>

				<hr style="margin: 32px 0; border-color: #eee;" />
				<p style="font-size: 12px; color: #999;">
					Barbershop — hope to see you again soon!
				</p>
			</div>
		`,
	}),
});
