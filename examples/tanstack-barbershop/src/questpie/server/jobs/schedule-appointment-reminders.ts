/**
 * Schedule Appointment Reminders (cron)
 *
 * Runs daily at 02:00 and enqueues a `sendAppointmentReminder` for every
 * appointment scheduled in the next 24 hours — i.e. everything happening
 * later today and the small overhang until tomorrow 02:00. One tick per day
 * gives natural idempotency: each appointment falls into exactly one window.
 *
 * Tradeoff: if the process is down at 02:00, that day's reminders are lost —
 * next tick is 24h later. For at-least-once, add a `reminderSentAt` field on
 * `appointments` and mark it here instead of relying on the window.
 */
import { job } from "questpie/services";
import { z } from "zod";

export default job({
	name: "schedule-appointment-reminders",
	schema: z.object({}),
	options: {
		cron: "0 2 * * *",
	},
	handler: async ({ collections, queue }) => {
		const now = new Date();
		const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

		const { docs } = await collections.appointments.find({
			where: {
				scheduledAt: { gte: now, lt: windowEnd },
				status: { in: ["pending", "confirmed"] },
			},
			columns: { id: true, customer: true },
		});

		for (const appointment of docs) {
			await queue.sendAppointmentReminder.publish({
				appointmentId: appointment.id,
				customerId: appointment.customer,
			});
		}
	},
});
