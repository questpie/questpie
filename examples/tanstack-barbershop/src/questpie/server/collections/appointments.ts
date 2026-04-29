import { sql } from "questpie";

import { collection } from "#questpie/factories";

export const appointments = collection("appointments")
	.fields(({ f }) => ({
		customer: f
			.relation("user")
			.required()
			.label({ en: "Customer", sk: "Zákazník" }),
		barber: f
			.relation("barbers")
			.required()
			.label({ en: "Barber", sk: "Holič" }),
		service: f
			.relation("services")
			.required()
			.label({ en: "Service", sk: "Služba" }),
		scheduledAt: f
			.datetime()
			.required()
			.label({ en: "Scheduled At", sk: "Naplánované na" }),
		status: f
			.select([
				{ value: "pending", label: { en: "Pending", sk: "Čakajúce" } },
				{ value: "confirmed", label: { en: "Confirmed", sk: "Potvrdené" } },
				{ value: "completed", label: { en: "Completed", sk: "Dokončené" } },
				{ value: "cancelled", label: { en: "Cancelled", sk: "Zrušené" } },
				{ value: "no-show", label: { en: "No Show", sk: "Neprišiel" } },
			])
			.required()
			.default("pending")
			.label({ en: "Status", sk: "Stav" }),
		notes: f.textarea().label({ en: "Notes", sk: "Poznámky" }),
		// Cancellation fields
		cancelledAt: f.datetime().label({ en: "Cancelled At", sk: "Zrušené dňa" }),
		// Cancellation reason - visibility controlled in .form()
		cancellationReason: f
			.textarea()
			.label({ en: "Cancellation Reason", sk: "Dôvod zrušenia" }),
		displayTitle: f.text().virtual(sql<string>`(
				SELECT
					COALESCE(
						(SELECT name FROM "user" WHERE id = appointments.customer),
						'Customer'
					) || ' - ' ||
					TO_CHAR(appointments."scheduledAt", 'YYYY-MM-DD HH24:MI')
			)`),
	}))
	.title(({ f }) => f.displayTitle)
	.admin(({ c }) => ({
		label: { en: "Appointments", sk: "Rezervácie" },
		icon: c.icon("ph:calendar"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status],
			},
			fields: [
				{
					type: "section",
					label: { en: "Booking Details", sk: "Detaily rezervácie" },
					layout: "grid",
					columns: 2,
					fields: [f.customer, f.barber, f.service, f.scheduledAt],
				},
				{
					type: "section",
					label: { en: "Notes", sk: "Poznámky" },
					fields: [f.notes],
				},
				{
					type: "section",
					label: { en: "Cancellation", sk: "Zrušenie" },
					fields: [
						f.cancelledAt,
						{
							field: f.cancellationReason,
							hidden: ({ data }) => data.status !== "cancelled",
						},
					],
				},
			],
		}),
	)
	.hooks({
		afterChange: async ({ data, operation, original, queue }) => {
			if (operation === "create") {
				await queue.sendAppointmentConfirmation.publish({
					appointmentId: data.id,
					customerId: data.customer,
				});
			} else if (operation === "update" && original) {
				if (data.status === "cancelled" && data.cancelledAt) {
					await queue.sendAppointmentCancellation.publish({
						appointmentId: data.id,
						customerId: data.customer,
					});
				}
			}
		},
	});
