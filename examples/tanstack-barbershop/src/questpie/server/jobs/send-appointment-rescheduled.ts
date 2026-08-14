/**
 * Send Appointment Rescheduled Job
 *
 * Sends a rescheduling notice when an appointment's scheduledAt, barber, or
 * service changes on an active (non-cancelled) booking.
 *
 * @see collections/appointments.ts — dispatches this job on relevant updates
 * @see emails/appointment-rescheduled.ts — the email template
 */
import { job } from "questpie/services";
import { z } from "zod";

export default job({
	name: "send-appointment-rescheduled",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
		previousScheduledAt: z.string().optional(),
	}),
	handler: async ({ payload, email, collections }) => {
		const customer = await collections.user.findOne({
			where: { id: payload.customerId },
		});
		if (!customer?.email) return;

		const appointment = await collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { service: true, barber: true },
		});
		if (!appointment || appointment.status === "cancelled") return;

		await email.sendTemplate({
			template: "appointmentRescheduled",
			input: {
				customerName: (customer.name as string) ?? "Customer",
				appointmentId: payload.appointmentId,
				barberName: appointment.barber?.name ?? "Your Barber",
				serviceName: appointment.service?.name ?? "Your Service",
				scheduledAt: new Date(appointment.scheduledAt).toLocaleString(),
				previousScheduledAt: payload.previousScheduledAt
					? new Date(payload.previousScheduledAt).toLocaleString()
					: undefined,
			},
			to: customer.email as string,
		});
	},
});
