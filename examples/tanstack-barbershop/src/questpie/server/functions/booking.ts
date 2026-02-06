import { getApp, q } from "questpie";
import z from "zod";
import type { BaseCMS } from "@/questpie/server/cms";

/**
 * Get available time slots for a specific date and barber.
 */
export const getAvailableTimeSlots = q.fn({
  schema: z.object({
    date: z.string(), // ISO date (YYYY-MM-DD)
    barberId: z.string(),
    serviceId: z.string(),
  }),
  handler: async ({ input, app }) => {
    const cms = getApp<BaseCMS>(app);
    const { date, barberId, serviceId } = input;

    // 1. Validate barber & service
    const [barber, service] = await Promise.all([
      cms.api.collections.barbers
        .findOne({ where: { id: barberId } })
        .catch((e) => {
          console.log("Barber not found for ID:", barberId, e);
          return null;
        }),
      cms.api.collections.services
        .findOne({
          where: { id: serviceId },
        })
        .catch((e) => {
          console.log("Service not found for ID:", serviceId, e);
          return null;
        }),
    ]);

    if (!barber || !barber.isActive) {
      return { slots: [] };
    }

    if (!service || !service.isActive) {
      return { slots: [] };
    }

    // 2. Determine working hours for this day
    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ] as const;
    const dateObj = new Date(date);
    const dayKey = dayNames[dateObj.getDay()];
    const daySchedule = barber.workingHours?.[dayKey];

    if (!daySchedule?.isOpen) {
      return { slots: [] };
    }

    // 3. Fetch existing appointments for this day
    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await cms.api.collections.appointments.find({
      where: {
        barber: barberId,
        scheduledAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // Filter out cancelled appointments
    const activeAppointments = appointments.docs.filter(
      (apt) => apt.status !== "cancelled",
    );

    // Fetch related services in one query
    const serviceIds = [
      ...new Set(activeAppointments.map((apt) => apt.service)),
    ];
    const servicesMap = new Map<string, { duration: number }>();

    if (serviceIds.length > 0) {
      const relatedServices = await cms.api.collections.services.find({
        where: {
          id: { in: serviceIds },
        },
      });
      for (const svc of relatedServices.docs) {
        servicesMap.set(svc.id, { duration: svc.duration });
      }
    }

    // 4. Build available slots
    const [startHour, startMin] = daySchedule.start.split(":").map(Number);
    const [endHour, endMin] = daySchedule.end.split(":").map(Number);
    const interval = 30; // minutes
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;
    const now = new Date();

    const slots: string[] = [];
    for (
      let minutes = startMinutes;
      minutes + service.duration <= endMinutes;
      minutes += interval
    ) {
      const slotTime = new Date(dateObj);
      slotTime.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);

      if (slotTime < now) continue;

      const potentialEnd = new Date(
        slotTime.getTime() + service.duration * 60000,
      );

      const isOccupied = appointments.docs.some((apt) => {
        const aptStart = new Date(apt.scheduledAt);
        const aptDuration = apt.service?.duration ?? service.duration;
        const aptEnd = new Date(aptStart.getTime() + aptDuration * 60000);

        return slotTime < aptEnd && potentialEnd > aptStart;
      });

      if (!isOccupied) {
        slots.push(slotTime.toISOString());
      }
    }

    return { slots };
  },
});

/**
 * Create a new booking.
 */
export const createBooking = q.fn({
  schema: z.object({
    barberId: z.string(),
    serviceId: z.string(),
    scheduledAt: z.string().datetime(),
    customerName: z.string().min(2),
    customerEmail: z.string().email(),
    customerPhone: z.string().optional(),
    notes: z.string().optional(),
  }),
  handler: async ({ input, app }) => {
    const cms = getApp<BaseCMS>(app);

    // 1. Get service to get price and duration
    const service = await cms.api.collections.services.findOne({
      where: { id: input.serviceId },
    });
    if (!service) throw new Error("Service not found");

    // 2. Double check availability
    const scheduledDate = new Date(input.scheduledAt);
    const allAtTime = await cms.api.collections.appointments.find({
      where: {
        barber: input.barberId,
        scheduledAt: scheduledDate,
      },
    });

    const existing = allAtTime.docs.find((apt) => apt.status !== "cancelled");

    if (existing) {
      throw new Error("This time slot is no longer available.");
    }

    // 3. Find or create guest user
    let customer = await cms.api.collections.user.findOne({
      where: { email: input.customerEmail },
    });

    if (!customer) {
      customer = await cms.api.collections.user.create({
        email: input.customerEmail,
        name: input.customerName,
        emailVerified: false,
      });
    }

    // 4. Create appointment
    const appointment = await cms.api.collections.appointments.create({
      customer: customer.id,
      barber: input.barberId,
      service: input.serviceId,
      scheduledAt: scheduledDate,
      status: "pending",
      notes: input.notes || null,
    });

    // 4. Trigger confirmation email job (optional)
    // await cms.jobs.sendAppointmentConfirmation.enqueue({ appointmentId: appointment.id });

    return {
      success: true,
      appointmentId: appointment.id,
      message: "Appointment booked successfully!",
    };
  },
});
