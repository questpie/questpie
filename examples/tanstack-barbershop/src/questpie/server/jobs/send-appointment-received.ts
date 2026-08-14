/**
 * Send Appointment Received Job
 *
 * Sends a "booking received, awaiting confirmation" email right after a
 * pending appointment is created. The follow-up confirmation email fires
 * separately on the pending → confirmed transition.
 *
 * @see collections/appointments.ts — dispatches this job on create
 * @see emails/appointment-received.ts — the email template
 */
import { job } from "questpie/services";
import { z } from "zod";

export default job({
	name: "send-appointment-received",
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
			template: "appointmentReceived",
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
