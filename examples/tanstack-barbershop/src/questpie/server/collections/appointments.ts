import { sql } from "questpie/builders";

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
		beforeChange: async ({ data, operation, collections }) => {
			// `beforeChange` does not receive `original`, so load it ourselves
			// on update when the surrounding logic needs to compare states.
			const prev =
				operation === "update" && data.id
					? await collections.appointments.findOne({
							where: { id: data.id as string },
						})
					: null;

			// Cancellation timestamp: stamp on transition into "cancelled",
			// wipe on transition out so the record doesn't lie about being
			// cancelled after a revive.
			if (data.status === "cancelled" && !data.cancelledAt) {
				data.cancelledAt = new Date();
			}
			if (data.status !== "cancelled" && prev?.status === "cancelled") {
				data.cancelledAt = null;
				data.cancellationReason = null;
			}

			// Defense-in-depth overlap check. `create-booking` also checks,
			// but any other write path (admin panel, direct API, tests) would
			// otherwise bypass it. Race window still exists without a DB
			// transaction — this just narrows it and centralizes the rule.
			const scheduleChanged =
				operation === "update" &&
				prev &&
				(String(data.scheduledAt) !== String(prev.scheduledAt) ||
					data.barber !== prev.barber ||
					data.service !== prev.service);

			if (
				data.status !== "cancelled" &&
				(operation === "create" || scheduleChanged)
			) {
				const service = await collections.services.findOne({
					where: { id: data.service as string },
				});
				if (!service) throw new Error("Service not found");

				const scheduledDate = new Date(data.scheduledAt as Date | string);
				const requestedEnd = new Date(
					scheduledDate.getTime() + service.duration * 60000,
				);

				const startOfDay = new Date(scheduledDate);
				startOfDay.setHours(0, 0, 0, 0);
				const endOfDay = new Date(scheduledDate);
				endOfDay.setHours(23, 59, 59, 999);

				const { docs } = await collections.appointments.find({
					where: {
						barber: data.barber as string,
						scheduledAt: { gte: startOfDay, lte: endOfDay },
					},
				});

				const others = docs.filter(
					(apt) =>
						apt.status !== "cancelled" &&
						(operation === "create" || apt.id !== data.id),
				);

				const serviceIds = [
					...new Set(others.map((apt) => apt.service as string)),
				];
				const durationMap = new Map<string, number>();
				if (serviceIds.length > 0) {
					const rel = await collections.services.find({
						where: { id: { in: serviceIds } },
					});
					for (const s of rel.docs) durationMap.set(s.id, s.duration);
				}

				const hasConflict = others.some((apt) => {
					const aStart = new Date(apt.scheduledAt);
					const aDur =
						durationMap.get(apt.service as string) ?? service.duration;
					const aEnd = new Date(aStart.getTime() + aDur * 60000);
					return scheduledDate < aEnd && requestedEnd > aStart;
				});

				if (hasConflict) {
					throw new Error("This time slot is no longer available.");
				}
			}
		},
		afterChange: async ({ data, operation, original, queue }) => {
			if (operation === "create") {
				await queue.sendAppointmentReceived.publish({
					appointmentId: data.id,
					customerId: data.customer,
				});

				// Same-day bookings fall outside the 02:00 cron's next-24h
				// window (it already ran this morning). Fire the reminder
				// immediately so late-in-the-day bookings still get one.
				const scheduledAt = new Date(data.scheduledAt);
				const hoursUntil =
					(scheduledAt.getTime() - Date.now()) / (60 * 60 * 1000);
				if (hoursUntil > 0 && hoursUntil < 24) {
					await queue.sendAppointmentReminder.publish({
						appointmentId: data.id,
						customerId: data.customer,
					});
				}
			} else if (operation === "update" && original) {
				if (
					data.status === "confirmed" &&
					original.status === "pending"
				) {
					await queue.sendAppointmentConfirmation.publish({
						appointmentId: data.id,
						customerId: data.customer,
					});
				}
				if (
					data.status === "cancelled" &&
					original.status !== "cancelled"
				) {
					await queue.sendAppointmentCancellation.publish({
						appointmentId: data.id,
						customerId: data.customer,
					});
				}

				// Reschedule notice: fire when the time, barber, or service
				// changes on an active (non-cancelled) booking. Skip if the
				// change itself is a cancellation — the cancellation email
				// already covers it.
				const rescheduled =
					data.status !== "cancelled" &&
					(String(data.scheduledAt) !== String(original.scheduledAt) ||
						data.barber !== original.barber ||
						data.service !== original.service);
				if (rescheduled) {
					await queue.sendAppointmentRescheduled.publish({
						appointmentId: data.id,
						customerId: data.customer,
						previousScheduledAt: original.scheduledAt
							? new Date(original.scheduledAt).toISOString()
							: undefined,
					});
				}
			}
		},
		afterDelete: async ({ original, queue, collections }) => {
			// The row is gone — the cancellation job can't look it up, so we
			// pre-load barber/service/customer here and pass a full snapshot.
			const [customer, barber, service] = await Promise.all([
				collections.user.findOne({ where: { id: original.customer } }),
				collections.barbers.findOne({ where: { id: original.barber } }),
				collections.services.findOne({ where: { id: original.service } }),
			]);

			if (!customer?.email) return;

			await queue.sendAppointmentCancellation.publish({
				appointmentId: original.id,
				customerId: original.customer,
				snapshot: {
					customerName: (customer.name as string) ?? "Customer",
					customerEmail: customer.email as string,
					barberName: barber?.name ?? "Your Barber",
					serviceName: service?.name ?? "Your Service",
					scheduledAt: original.scheduledAt
						? new Date(original.scheduledAt).toLocaleString()
						: "TBD",
					cancellationReason: original.cancellationReason ?? undefined,
				},
			});
		},
	});
