import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(
		z.object({
			barberId: z.string(),
			serviceId: z.string(),
			scheduledAt: z.string().datetime(),
			customerName: z.string().min(2),
			customerEmail: z.string().email(),
			customerPhone: z.string().optional(),
			notes: z.string().optional(),
		}),
	)
	.handler(async ({ input, collections }) => {
		const service = await collections.services.findOne({
			where: { id: input.serviceId },
		});
		if (!service) throw new Error("Service not found");

		const scheduledDate = new Date(input.scheduledAt);
		const requestedEnd = new Date(
			scheduledDate.getTime() + service.duration * 60000,
		);

		// Get all appointments for this barber on the same day
		const startOfDay = new Date(scheduledDate);
		startOfDay.setHours(0, 0, 0, 0);
		const endOfDay = new Date(scheduledDate);
		endOfDay.setHours(23, 59, 59, 999);

		const allAppointments = await collections.appointments.find({
			where: {
				barber: input.barberId,
				scheduledAt: {
					gte: startOfDay,
					lte: endOfDay,
				},
			},
		});

		// Check for overlapping appointments
		const activeAppointments = allAppointments.docs.filter(
			(apt: any) => apt.status !== "cancelled",
		);

		// Get service durations for existing appointments
		const serviceIds = [
			...new Set(activeAppointments.map((apt: any) => apt.service)),
		];
		const servicesMap = new Map<string, { duration: number }>();

		if (serviceIds.length > 0) {
			const relatedServices = await collections.services.find({
				where: {
					id: { in: serviceIds },
				},
			});
			for (const svc of relatedServices.docs) {
				servicesMap.set(svc.id, { duration: svc.duration });
			}
		}

		// Check for time slot conflicts
		const hasConflict = activeAppointments.some((apt: any) => {
			const aptStart = new Date(apt.scheduledAt);
			const aptDuration =
				servicesMap.get(apt.service as string)?.duration ?? service.duration;
			const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);

			// Check if time slots overlap
			return scheduledDate < aptEnd && requestedEnd > aptStart;
		});

		if (hasConflict) {
			throw new Error("This time slot is no longer available.");
		}

		let customer = await collections.user.findOne({
			where: { email: input.customerEmail },
		});

		if (!customer) {
			customer = await collections.user.create({
				email: input.customerEmail,
				name: input.customerName,
				emailVerified: false,
			});
		}

		const appointment = await collections.appointments.create({
			customer: customer.id as string,
			barber: input.barberId,
			service: input.serviceId,
			scheduledAt: scheduledDate,
			status: "pending",
			notes: input.notes || null,
		});

		return {
			success: true,
			appointmentId: appointment.id,
			message: "Appointment booked successfully!",
		};
	});
