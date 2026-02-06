import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getApp, q } from "questpie";
import z from "zod";
import type { BaseCMS } from "@/questpie/server/cms";

/**
 * Get all active barbers.
 * Uses BaseCMS type to avoid circular dependencies while maintaining type safety.
 */
export * from "./booking";
export const getActiveBarbers = q.fn({
  schema: z.object({}),
  handler: async ({ app }) => {
    const cms = getApp<BaseCMS>(app);
    // ✅ Return type is fully inferred from cms.api.collections.barbers.find()
    return await cms.api.collections.barbers.find({
      where: { isActive: true },
    });
  },
});

/**
 * Get revenue statistics for a date range.
 * Demonstrates BaseCMS pattern with complex return type inference.
 */
export const getRevenueStats = q.fn({
  schema: z.object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    /** Only count completed appointments */
    completedOnly: z.boolean().optional().default(true),
  }),
  handler: async ({ input, app }) => {
    const cms = getApp<BaseCMS>(app);
    const { startDate, endDate, completedOnly } = input;

    const appointmentsTable = cms.config.collections.appointments.table;
    const servicesTable = cms.config.collections.services.table;

    // Build where conditions
    const conditions = [
      gte(appointmentsTable.scheduledAt, new Date(startDate)),
      lte(appointmentsTable.scheduledAt, new Date(endDate)),
    ];

    if (completedOnly) {
      conditions.push(eq(appointmentsTable.status, "completed"));
    }

    // Aggregate revenue by joining with services
    const result = await cms.db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${servicesTable.price}), 0)`.as(
          "total_revenue",
        ),
        appointmentCount: sql<number>`COUNT(*)`.as("appointment_count"),
        avgRevenue: sql<number>`COALESCE(AVG(${servicesTable.price}), 0)`.as(
          "avg_revenue",
        ),
      })
      .from(appointmentsTable)
      .innerJoin(servicesTable, eq(appointmentsTable.service, servicesTable.id))
      .where(and(...conditions));

    return {
      totalRevenue: Number(result[0]?.totalRevenue ?? 0),
      appointmentCount: Number(result[0]?.appointmentCount ?? 0),
      avgRevenue: Number(result[0]?.avgRevenue ?? 0),
    };
  },
});
