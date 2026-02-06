import { getApp } from "questpie";
import { qb } from "@/questpie/server/builder";
import type { AppCMS } from "@/questpie/server/cms";

export const appointments = qb
  .collection("appointments")
  .fields((f) => ({
    customer: f.relation({ to: "user", required: true }),
    barber: f.relation({ to: "barbers", required: true }),
    service: f.relation({ to: "services", required: true }),
    scheduledAt: f.datetime({ required: true }),
    status: f.text({ required: true, maxLength: 50, default: "pending" }),
    // Status: pending, confirmed, completed, cancelled, no-show
    notes: f.textarea(),
    cancelledAt: f.datetime(),
    cancellationReason: f.textarea(),
    // Display title computed at read time
    displayTitle: f.text({ virtual: true }),
  }))
  .title(({ f }) => f.displayTitle)
  .hooks({
    afterRead: ({ data }) => {
      if (!data) return;
      const scheduledAt = (data as any).scheduledAt as Date | undefined;
      const dateLabel = scheduledAt
        ? scheduledAt.toISOString().replace("T", " ").slice(0, 16)
        : "";
      (data as any).displayTitle =
        `${(data as any).customer ?? "Customer"} - ${dateLabel}`.trim();
    },
    // Use getApp<AppCMS>() for type-safe access
    afterChange: async ({ data, operation, original, app }) => {
      const cms = getApp<AppCMS>(app);

      if (operation === "create") {
        // Send confirmation email after booking
        await cms.queue.sendAppointmentConfirmation.publish({
          appointmentId: (data as any).id,
          customerId: (data as any).customer,
        });
      } else if (operation === "update" && original) {
        // Notify customer if appointment is cancelled
        if ((data as any).status === "cancelled" && (data as any).cancelledAt) {
          await cms.queue.sendAppointmentCancellation.publish({
            appointmentId: (data as any).id,
            customerId: (data as any).customer,
          });
        }
      }
    },
  });
