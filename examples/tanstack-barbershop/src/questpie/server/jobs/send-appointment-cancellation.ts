/**
 * Send Appointment Cancellation Job
 *
 * Sends a cancellation email in two cases:
 *
 * 1. Status transition pending/confirmed → cancelled (row still exists).
 *    Handler looks up customer + appointment from the DB.
 *
 * 2. The appointment row was deleted outright. `afterDelete` can no longer
 *    read the row, so the caller passes a `snapshot` with everything the
 *    template needs and the DB lookup is skipped.
 *
 * @see collections/appointments.ts — dispatches this job on status change or delete
 * @see emails/appointment-cancellation.ts — the email template
 */
import { job } from "questpie/services";
import { z } from "zod";

export default job({
	name: "send-appointment-cancellation",
	schema: z.object({
		appointmentId: z.string(),
		customerId: z.string(),
		snapshot: z
			.object({
				customerName: z.string(),
				customerEmail: z.string(),
				barberName: z.string(),
				serviceName: z.string(),
				scheduledAt: z.string(),
				cancellationReason: z.string().optional(),
			})
			.optional(),
	}),
	handler: async ({ payload, email, collections }) => {
		if (payload.snapshot) {
			await email.sendTemplate({
				template: "appointmentCancellation",
				input: {
					customerName: payload.snapshot.customerName,
					appointmentId: payload.appointmentId,
					barberName: payload.snapshot.barberName,
					serviceName: payload.snapshot.serviceName,
					scheduledAt: payload.snapshot.scheduledAt,
					cancellationReason: payload.snapshot.cancellationReason,
				},
				to: payload.snapshot.customerEmail,
			});
			return;
		}

		const customer = await collections.user.findOne({
			where: { id: payload.customerId },
		});
		if (!customer?.email) return;

		const appointment = await collections.appointments.findOne({
			where: { id: payload.appointmentId },
			with: { service: true, barber: true },
		});

		await email.sendTemplate({
			template: "appointmentCancellation",
			input: {
				customerName: (customer.name as string) ?? "Customer",
				appointmentId: payload.appointmentId,
				barberName: appointment?.barber?.name ?? "Your Barber",
				serviceName: appointment?.service?.name ?? "Your Service",
				scheduledAt: appointment?.scheduledAt
					? new Date(appointment.scheduledAt).toLocaleString()
					: "TBD",
				cancellationReason: appointment?.cancellationReason ?? undefined,
			},
			to: customer.email as string,
		});
	},
});
