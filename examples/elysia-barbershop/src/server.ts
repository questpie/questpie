/**
 * Barbershop Server (Elysia Edition)
 *
 * Demonstrates:
 * - Elysia adapter integration with full type safety
 * - Custom business logic routes
 * - CMS programmatic usage
 * - Eden Treaty end-to-end type safety
 */

import { Elysia, t } from "elysia";
import { questpieElysia } from "@questpie/elysia";
import { cms } from "./cms";

// ============================================================================
// Mount CMS Routes & Custom Endpoints
// ============================================================================

const app = new Elysia()
	.use(questpieElysia(cms))
	.get(
		"/api/barbers/:barberId/availability",
		async ({ params, query, cmsContext }) => {
			const { barberId } = params;
			const { date, serviceId } = query;

			try {
				// Get barber
				const barber = await cms.api.collections.barbers.findOne(
					{ where: { id: barberId } },
					cmsContext,
				);

				if (!barber) {
					throw new Error("Barber not found");
				}

				// Get service to know duration
				const service = await cms.api.collections.services.findOne(
					{ where: { id: serviceId } },
					cmsContext,
				);

				if (!service) {
					throw new Error("Service not found");
				}

				// Get existing appointments for that day
				const startOfDay = new Date(date);
				startOfDay.setHours(0, 0, 0, 0);
				const endOfDay = new Date(date);
				endOfDay.setHours(23, 59, 59, 999);

				const existingAppointments =
					await cms.api.collections.appointments.find(
						{
							where: {
								barberId,
								scheduledAt: {
									gte: startOfDay,
									lte: endOfDay,
								},
								status: {
									in: ["pending", "confirmed"],
								},
							},
							orderBy: { scheduledAt: "asc" },
						},
						cmsContext,
					);

				// Generate available slots (simplified logic)
				const slots: string[] = [];
				const workStart = 9; // 9 AM
				const workEnd = 17; // 5 PM

				for (let hour = workStart; hour < workEnd; hour++) {
					for (const minute of [0, 30]) {
						const slotTime = new Date(date);
						slotTime.setHours(hour, minute, 0, 0);

						// Check if slot conflicts with existing appointments
						const hasConflict = existingAppointments.docs.some((apt) => {
							const aptStart = new Date(apt.scheduledAt);
							const aptEnd = new Date(
								aptStart.getTime() + service.duration * 60000,
							);
							const slotEnd = new Date(
								slotTime.getTime() + service.duration * 60000,
							);

							return slotTime < aptEnd && slotEnd > aptStart;
						});

						if (!hasConflict) {
							slots.push(
								slotTime.toLocaleTimeString("en-US", {
									hour: "2-digit",
									minute: "2-digit",
								}),
							);
						}
					}
				}

				return {
					barberId,
					date,
					serviceId,
					serviceDuration: service.duration,
					availableSlots: slots,
				};
			} catch (error) {
				throw new Error(
					error instanceof Error ? error.message : "Unknown error",
				);
			}
		},
		{
			params: t.Object({
				barberId: t.String(),
			}),
			query: t.Object({
				date: t.String(), // YYYY-MM-DD
				serviceId: t.String(),
			}),
		},
	)
	.post(
		"/api/appointments/book",
		async ({ body, user, cmsContext }) => {
			if (!user) {
				throw new Error("Unauthorized. Please login.");
			}

			try {
				// Verify barber exists and is active
				const barber = await cms.api.collections.barbers.findOne(
					{ where: { id: body.barberId, isActive: true } },
					cmsContext,
				);

				if (!barber) {
					throw new Error("Barber not found or inactive");
				}

				// Verify service exists and is active
				const service = await cms.api.collections.services.findOne(
					{ where: { id: body.serviceId, isActive: true } },
					cmsContext,
				);

				if (!service) {
					throw new Error("Service not found or inactive");
				}

				// Check for time slot conflicts
				const scheduledAt = new Date(body.scheduledAt);
				const appointmentEnd = new Date(
					scheduledAt.getTime() + service.duration * 60000,
				);

				const conflicts = await cms.api.collections.appointments.find(
					{
						where: {
							barberId: body.barberId,
							scheduledAt: {
								gte: scheduledAt,
								lt: appointmentEnd,
							},
							status: {
								in: ["pending", "confirmed"],
							},
						},
					},
					cmsContext,
				);

				if (conflicts.docs.length > 0) {
					throw new Error("Time slot not available");
				}

				// Create appointment
				const appointment = await cms.api.collections.appointments.create(
					{
						customerId: user.id,
						barberId: body.barberId,
						serviceId: body.serviceId,
						scheduledAt,
						status: "pending",
						notes: body.notes,
					},
					cmsContext,
				);

				// Hook will automatically send confirmation email via queue

				return {
					success: true,
					appointment: {
						id: appointment.id,
						scheduledAt: appointment.scheduledAt,
						status: appointment.status,
						barber: barber.name,
						service: service.name,
						price: service.price,
						duration: service.duration,
					},
				};
			} catch (error) {
				throw new Error(
					error instanceof Error ? error.message : "Unknown error",
				);
			}
		},
		{
			body: t.Object({
				barberId: t.String(),
				serviceId: t.String(),
				scheduledAt: t.String(), // ISO datetime
				notes: t.Optional(t.String()),
			}),
		},
	)
	.post(
		"/api/appointments/:id/cancel",
		async ({ params, body, user, cmsContext }) => {
			if (!user) {
				throw new Error("Unauthorized. Please login.");
			}

			const appointmentId = params.id;

			try {
				// Get appointment
				const appointment = await cms.api.collections.appointments.findOne(
					{ where: { id: appointmentId } },
					cmsContext,
				);

				if (!appointment) {
					throw new Error("Appointment not found");
				}

				// Verify ownership
				if (appointment.customerId !== user.id) {
					throw new Error(
						"Forbidden. You can only cancel your own appointments.",
					);
				}

				// Check if already cancelled
				if (appointment.status === "cancelled") {
					throw new Error("Appointment already cancelled");
				}

				// Check if already completed
				if (appointment.status === "completed") {
					throw new Error("Cannot cancel completed appointment");
				}

				// Update appointment
				const updated = await cms.api.collections.appointments.updateById(
					{
						id: appointmentId,
						data: {
							status: "cancelled",
							cancelledAt: new Date(),
							cancellationReason: body.reason,
						},
					},
					cmsContext,
				);

				// Hook will automatically send cancellation email

				return {
					success: true,
					appointment: {
						id: updated.id,
						status: updated.status,
						cancelledAt: updated.cancelledAt,
					},
				};
			} catch (error) {
				throw new Error(
					error instanceof Error ? error.message : "Unknown error",
				);
			}
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				reason: t.Optional(t.String()),
			}),
		},
	)
	.get("/api/my/appointments", async ({ user, cmsContext }) => {
		if (!user) {
			throw new Error("Unauthorized. Please login.");
		}

		try {
			const appointments = await cms.api.collections.appointments.find(
				{
					where: { customerId: user.id },
					with: {
						barber: true,
						service: true,
					},
					orderBy: { scheduledAt: "desc" },
				},
				cmsContext,
			);

			return {
				appointments: appointments.docs.map((apt) => ({
					id: apt.id,
					scheduledAt: apt.scheduledAt,
					status: apt.status,
					notes: apt.notes,
					barber: apt.barber,
					service: apt.service,
					cancelledAt: apt.cancelledAt,
					cancellationReason: apt.cancellationReason,
				})),
			};
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : "Unknown error");
		}
	})
	.get("/health", () => {
		return {
			status: "ok",
			timestamp: new Date().toISOString(),
			service: "barbershop-api-elysia",
		};
	})
	.listen(3001);

console.log(
	`🪒 Barbershop API (Elysia) running at http://${app.server?.hostname}:${app.server?.port}`,
);

// ============================================================================
// Export app type for Eden Treaty
// ============================================================================

export type App = typeof app;
