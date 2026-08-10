/**
 * Send Appointment Cancellation Job
 *
 * Sends a cancellation email when an appointment is cancelled.
 * Uses context-first pattern — `collections` and `email` from AppContext.
 *
 * @see collections/appointments.ts — dispatches this job on status change to "cancelled"
 * @see emails/appointment-cancellation.ts — the email template
 */
import { job } from "questpie/services";
import { z } from "zod";

export default job({
	name: "send-appointment-cancellation",
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
			template: "appointmentCancellation",
			input: {
				customerName: (customer?.name as string) ?? "Customer",
				appointmentId: payload.appointmentId,
				barberName: appointment?.barber?.name ?? "Your Barber",
				serviceName: appointment?.service?.name ?? "Your Service",
				scheduledAt: appointment?.scheduledAt
					? new Date(appointment.scheduledAt).toLocaleString()
					: "TBD",
				cancellationReason: appointment?.cancellationReason ?? undefined,
			},
			to: (customer?.email as string) ?? "",
		});
	},
});
