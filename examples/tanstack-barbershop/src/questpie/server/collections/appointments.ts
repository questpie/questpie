import { sql, typedApp } from "questpie";
import type { App } from "@/questpie/server/app";
import { qb } from "@/questpie/server/builder";

export const appointments = qb
	.collection("appointments")
	.fields((f) => ({
		customer: f.relation({
			to: "user",
			required: true,
			label: { en: "Customer", sk: "Zákazník" },
		}),
		barber: f.relation({
			to: "barbers",
			required: true,
			label: { en: "Barber", sk: "Holič" },
		}),
		service: f.relation({
			to: "services",
			required: true,
			label: { en: "Service", sk: "Služba" },
		}),
		scheduledAt: f.datetime({
			required: true,
			label: { en: "Scheduled At", sk: "Naplánované na" },
		}),
		status: f.select({
			required: true,
			default: "pending",
			label: { en: "Status", sk: "Stav" },
			options: [
				{ value: "pending", label: { en: "Pending", sk: "Čakajúce" } },
				{ value: "confirmed", label: { en: "Confirmed", sk: "Potvrdené" } },
				{ value: "completed", label: { en: "Completed", sk: "Dokončené" } },
				{ value: "cancelled", label: { en: "Cancelled", sk: "Zrušené" } },
				{ value: "no-show", label: { en: "No Show", sk: "Neprišiel" } },
			],
		}),
		notes: f.textarea({
			label: { en: "Notes", sk: "Poznámky" },
		}),
		// Cancellation fields
		cancelledAt: f.datetime({
			label: { en: "Cancelled At", sk: "Zrušené dňa" },
		}),
		// Cancellation reason - visibility controlled in .form()
		cancellationReason: f.textarea({
			label: { en: "Cancellation Reason", sk: "Dôvod zrušenia" },
		}),
		displayTitle: f.text({
			virtual: sql<string>`(
				SELECT
					COALESCE(
						(SELECT name FROM "user" WHERE id = appointments.customer),
						'Customer'
					) || ' - ' ||
					TO_CHAR(appointments."scheduledAt", 'YYYY-MM-DD HH24:MI')
			)`,
		}),
	}))
	.title(({ f }) => f.displayTitle)
	.admin(({ c }) => ({
		label: { en: "Appointments", sk: "Rezervácie" },
		icon: c.icon("ph:calendar"),
	}))
	.list(({ v }) => v.table({}))
	.form(({ v, f }) =>
		v.form({
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
		afterChange: async ({ data, operation, original, app }) => {
			const typed = typedApp<App>(app);

			if (operation === "create") {
				await typed.queue.sendAppointmentConfirmation.publish({
					appointmentId: data.id,
					customerId: data.customer,
				});
			} else if (operation === "update" && original) {
				if (data.status === "cancelled" && data.cancelledAt) {
					await typed.queue.sendAppointmentCancellation.publish({
						appointmentId: data.id,
						customerId: data.customer,
					});
				}
			}
		},
	});
