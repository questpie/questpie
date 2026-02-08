import z from "zod";
import { r } from "@/questpie/server/rpc";

export const getAvailableTimeSlots = r.fn({
  schema: z.object({
    date: z.string(),
    barberId: z.string(),
    serviceId: z.string(),
  }),
  handler: async ({ input, app }) => {
    const { date, barberId, serviceId } = input;

    const [barber, service] = await Promise.all([
      app.api.collections.barbers
        .findOne({ where: { id: barberId } })
        .catch((e: any) => {
          console.log("Barber not found for ID:", barberId, e);
          return null;
        }),
      app.api.collections.services
        .findOne({ where: { id: serviceId } })
        .catch((e: any) => {
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
    const workingHours = barber.workingHours as Record<string, any> | null;
    const daySchedule = workingHours?.[dayKey];

    if (!daySchedule?.isOpen) {
      return { slots: [] };
    }

    const startOfDay = new Date(dateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(dateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await app.api.collections.appointments.find({
      where: {
        barber: barberId,
        scheduledAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    const activeAppointments = appointments.docs.filter(
      (apt: any) => apt.status !== "cancelled",
    );

    const serviceIds = [
      ...new Set(activeAppointments.map((apt: any) => apt.service)),
    ];
    const servicesMap = new Map<string, { duration: number }>();

    if (serviceIds.length > 0) {
      const relatedServices = await app.api.collections.services.find({
        where: {
          id: { in: serviceIds },
        },
      });
      for (const svc of relatedServices.docs) {
        servicesMap.set(svc.id, { duration: svc.duration });
      }
    }

    const [startHour, startMin] = daySchedule.start.split(":").map(Number);
    const [endHour, endMin] = daySchedule.end.split(":").map(Number);
    const interval = 30;
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

      const isOccupied = appointments.docs.some((apt: any) => {
        const aptStart = new Date(apt.scheduledAt);
        const aptDuration = servicesMap.get(apt.service as string)?.duration ?? service.duration;
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

export const createBooking = r.fn({
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
    const service = await app.api.collections.services.findOne({
      where: { id: input.serviceId },
    });
    if (!service) throw new Error("Service not found");

    const scheduledDate = new Date(input.scheduledAt);
    const allAtTime = await app.api.collections.appointments.find({
      where: {
        barber: input.barberId,
        scheduledAt: scheduledDate,
      },
    });

    const existing = allAtTime.docs.find((apt: any) => apt.status !== "cancelled");

    if (existing) {
      throw new Error("This time slot is no longer available.");
    }

    let customer = await app.api.collections.user.findOne({
      where: { email: input.customerEmail },
    });

    if (!customer) {
      customer = await app.api.collections.user.create({
        email: input.customerEmail,
        name: input.customerName,
        emailVerified: false,
      });
    }

    const appointment = await app.api.collections.appointments.create({
      customer: customer.id,
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
  },
});
