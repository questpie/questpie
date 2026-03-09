/**
 * Send Appointment Confirmation Job
 *
 * Sends a confirmation email when an appointment is booked.
 * Uses context-first pattern — `collections` and `email` from AppContext.
 *
 * @see collections/appointments.ts — dispatches this job on create
 * @see emails/appointment-confirmation.ts — the email template
 */
import { job } from "questpie";
import { z } from "zod";

export default job({
	name: "send-appointment-confirmation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
	}),
	handler: async ({ payload, email, collections }) => {
		const customer = await collections.user.findOne({
			where: { id: payload.customerId },
		});

		const appointment = await collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { service: true, barber: true },
		});

		await email.sendTemplate({
			template: "appointmentConfirmation",
			input: {
				customerName: (customer?.name as string) ?? "Customer",
				appointmentId: payload.appointmentId,
				barberName: appointment?.barber?.name ?? "Your Barber",
				serviceName: appointment?.service?.name ?? "Your Service",
				scheduledAt: appointment?.scheduledAt
					? new Date(appointment.scheduledAt).toLocaleString()
					: "TBD",
			},
			to: (customer?.email as string) ?? "",
		});
	},
});
