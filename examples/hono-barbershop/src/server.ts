/**
 * Barbershop Server
 *
 * Demonstrates:
 * - Hono adapter integration
 * - Custom business logic routes
 * - CMS programmatic usage
 * - Type-safe API endpoints
 */

import { Hono } from "hono";
import { questpieHono, questpieMiddleware } from "@questpie/hono";
import { cms } from "./cms";
import * as z from "zod";
import { zValidator } from "@hono/zod-validator";

/**
 * Book an appointment
 */
const bookingSchema = z.object({
	barberId: z.uuid({ version: "v7" }),
	serviceId: z.uuid({ version: "v7" }),
	scheduledAt: z.iso.datetime(),
	notes: z.string().optional(),
});

// ============================================================================
// Mount CMS Routes
// ============================================================================

const app = new Hono()
	.use(questpieMiddleware(cms))
	.route("/", questpieHono(cms, { basePath: "/cms" }))
	.get(
		"/api/barbers/:barberId/availability",
		zValidator(
			"param",
			z.object({
				barberId: z.string().uuid({ version: "v7" }),
			}),
		),
		zValidator(
			"query",
			z.object({
				date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
					message: "Date must be in YYYY-MM-DD format",
				}),
				serviceId: z.string().uuid({ version: "v7" }),
			}),
		),

		async (c) => {
			const barberId = c.req.param("barberId");
			const date = c.req.query("date"); // YYYY-MM-DD
			const serviceId = c.req.query("serviceId");

			if (!date || !serviceId) {
				return c.json(
					{ error: "Missing required query parameters: date, serviceId" },
					400,
				);
			}

			// Get CMS context from middleware
			const context = c.get("cmsContext");

			try {
				// Get barber
				const barber = await cms.api.collections.barbers.findOne(
					{ where: { id: barberId } },
					context,
				);

				if (!barber) {
					return c.json({ error: "Barber not found" }, 404);
				}

				// Get service to know duration
				const service = await cms.api.collections.services.findOne(
					{ where: { id: serviceId } },
					context,
				);

				if (!service) {
					return c.json({ error: "Service not found" }, 404);
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
						context,
					);

				// Generate available slots (simplified logic)
				// In production: parse barber.workingHours, account for breaks, etc.
				const slots: string[] = [];
				const workStart = 9; // 9 AM
				const workEnd = 17; // 5 PM

				for (let hour = workStart; hour < workEnd; hour++) {
					for (const minute of [0, 30]) {
						const slotTime = new Date(date);
						slotTime.setHours(hour, minute, 0, 0);

						// Check if slot conflicts with existing appointments
					const hasConflict = existingAppointments.docs.some((apt: any) => {
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

				return c.json({
					barberId,
					date,
					serviceId,
					serviceDuration: service.duration,
					availableSlots: slots,
				});
			} catch (error) {
				console.error("Error fetching availability:", error);
				return c.json(
					{
						error: error instanceof Error ? error.message : "Unknown error",
					},
					500,
				);
			}
		},
	)
	.post("/api/appointments/book", async (c) => {
		const user = c.get("user");

		if (!user) {
			return c.json({ error: "Unauthorized. Please login." }, 401);
		}

		try {
			const body = await c.req.json();
			const data = bookingSchema.parse(body);

			// Get CMS context from middleware
			const context = c.get("cmsContext");

			// Verify barber exists and is active
			const barber = await cms.api.collections.barbers.findOne(
				{ where: { id: data.barberId, isActive: true } },
				context,
			);

			if (!barber) {
				return c.json({ error: "Barber not found or inactive" }, 404);
			}

			// Verify service exists and is active
			const service = await cms.api.collections.services.findOne(
				{ where: { id: data.serviceId, isActive: true } },
				context,
			);

			if (!service) {
				return c.json({ error: "Service not found or inactive" }, 404);
			}

			// Check for time slot conflicts
			const scheduledAt = new Date(data.scheduledAt);
			const appointmentEnd = new Date(
				scheduledAt.getTime() + service.duration * 60000,
			);

			const conflicts = await cms.api.collections.appointments.find(
				{
					where: {
						barberId: data.barberId,
						scheduledAt: {
							gte: scheduledAt,
							lt: appointmentEnd,
						},
						status: {
							in: ["pending", "confirmed"],
						},
					},
				},
				context,
			);

			if (conflicts.docs.length > 0) {
				return c.json(
					{
						error: "Time slot not available",
							conflicts: conflicts.docs.map((a: any) => ({
							id: a.id,
							scheduledAt: a.scheduledAt,
						})),
					},
					409,
				);
			}

			// Create appointment
			const appointment = await cms.api.collections.appointments.create(
				{
					customerId: user.id,
					barberId: data.barberId,
					serviceId: data.serviceId,
					scheduledAt,
					status: "pending",
					notes: data.notes,
					cancelledAt: null,
					cancellationReason: null,
				},
				context,
			);

			// Hook will automatically send confirmation email via queue

			return c.json(
				{
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
				},
				201,
			);
		} catch (error) {
			if (error instanceof z.ZodError) {
				return c.json({ error: "Invalid input", details: error.issues }, 400);
			}

			console.error("Error booking appointment:", error);
			return c.json(
				{
					error: error instanceof Error ? error.message : "Unknown error",
				},
				500,
			);
		}
	})
	.post("/api/appointments/:id/cancel", async (c) => {
		const user = c.get("user");
		const appointmentId = c.req.param("id");

		if (!user) {
			return c.json({ error: "Unauthorized. Please login." }, 401);
		}

		try {
			const body = await c.req.json();
			const reason = body.reason as string | undefined;

			// Get CMS context from middleware
			const context = c.get("cmsContext");

			// Get appointment
			const appointment = await cms.api.collections.appointments.findOne(
				{ where: { id: appointmentId } },
				context,
			);

			if (!appointment) {
				return c.json({ error: "Appointment not found" }, 404);
			}

			// Verify ownership
			if (appointment.customerId !== user.id) {
				return c.json(
					{ error: "Forbidden. You can only cancel your own appointments." },
					403,
				);
			}

			// Check if already cancelled
			if (appointment.status === "cancelled") {
				return c.json({ error: "Appointment already cancelled" }, 400);
			}

			// Check if already completed
			if (appointment.status === "completed") {
				return c.json({ error: "Cannot cancel completed appointment" }, 400);
			}

			// Update appointment
			const updated = await cms.api.collections.appointments.updateById(
				{
					id: appointmentId,
					data: {
						status: "cancelled",
						cancelledAt: new Date(),
						cancellationReason: reason,
					},
				},
				context,
			);

			// Hook will automatically send cancellation email

			return c.json({
				success: true,
				appointment: {
					id: updated.id,
					status: updated.status,
					cancelledAt: updated.cancelledAt,
				},
			});
		} catch (error) {
			console.error("Error cancelling appointment:", error);
			return c.json(
				{
					error: error instanceof Error ? error.message : "Unknown error",
				},
				500,
			);
		}
	})
	.get("/api/my/appointments", async (c) => {
		const user = c.get("user");

		if (!user) {
			return c.json({ error: "Unauthorized. Please login." }, 401);
		}

		try {
			// Get CMS context from middleware
			const context = c.get("cmsContext");

			const appointments = await cms.api.collections.appointments.find(
				{
					where: { customerId: user.id },
					with: {
						barber: true,
						service: true,
					},
					orderBy: { scheduledAt: "desc" },
				},
				context,
			);

			return c.json({
					appointments: appointments.docs.map((apt: any) => ({
					id: apt.id,
					scheduledAt: apt.scheduledAt,
					status: apt.status,
					notes: apt.notes,
					barber: apt.barber,
					service: apt.service,
					cancelledAt: apt.cancelledAt,
					cancellationReason: apt.cancellationReason,
				})),
			});
		} catch (error) {
			console.error("Error fetching appointments:", error);
			return c.json(
				{
					error: error instanceof Error ? error.message : "Unknown error",
				},
				500,
			);
		}
	})
	.get("/health", (c) => {
		return c.json({
			status: "ok",
			timestamp: new Date().toISOString(),
			service: "barbershop-api",
		});
	});

// ============================================================================
// Export app and type
// ============================================================================

export default {
	port: Number.parseInt(process.env.PORT || "3000", 10),
	fetch: app.fetch,
};

export type AppType = typeof app;
