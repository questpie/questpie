import { and, eq, gte, lte, sql } from "drizzle-orm";
import z from "zod";
import { r } from "@/questpie/server/rpc";

export * from "./booking";

export const getActiveBarbers = r.fn({
  schema: z.object({}),
  handler: async ({ app }) => {
    return await app.api.collections.barbers.find({
      where: { isActive: true },
    });
  },
});

export const getRevenueStats = r.fn({
  schema: z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    completedOnly: z.boolean().optional().default(true),
  }),
  handler: async ({ input, app }) => {
    const { startDate, endDate, completedOnly } = input;

    const appointmentsTable = app.config.collections.appointments.table;
    const servicesTable = app.config.collections.services.table;

    const conditions = [
      gte(appointmentsTable.scheduledAt as any, new Date(startDate)),
      lte(appointmentsTable.scheduledAt as any, new Date(endDate)),
    ];

    if (completedOnly) {
      conditions.push(eq(appointmentsTable.status as any, "completed"));
    }

    const result = await app.db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${servicesTable.price}), 0)`,
        appointmentCount: sql<number>`COUNT(*)`,
        avgRevenue: sql<number>`COALESCE(AVG(${servicesTable.price}), 0)`,
      } as any)
      .from(appointmentsTable)
      .innerJoin(servicesTable, eq(appointmentsTable.service as any, servicesTable.id) as any)
      .where(and(...conditions) as any);

    return {
      totalRevenue: Number(result[0]?.totalRevenue ?? 0),
      appointmentCount: Number(result[0]?.appointmentCount ?? 0),
      avgRevenue: Number(result[0]?.avgRevenue ?? 0),
    };
  },
});
