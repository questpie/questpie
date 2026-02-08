import { eq } from "drizzle-orm";
import { getApp, q } from "questpie";
import { z } from "zod";
import type { AppCMS } from "@/questpie/server/cms";

export const sendAppointmentConfirmation = q.job({
  name: "send-appointment-confirmation",
  schema: z.object({
    appointmentId: z.string(),
    customerId: z.string(),
  }),
  handler: async ({ payload, app }) => {
    const cms = getApp<AppCMS>(app);

    const userTable = cms.config.collections.user.table;
    const customer = await cms.db
      .select({ email: userTable.email, name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id as any, payload.customerId) as any)
      .limit(1)
      .then((res) => res[0]);

    await cms.email.send({
      to: (customer?.email || "") as string,
      subject: "Appointment Confirmation",
      text: `Dear ${customer?.name || "Customer"},\n\nYour appointment (ID: ${payload.appointmentId}) has been confirmed.\n\nThank you!`,
    });
  },
});

export const sendAppointmentCancellation = q.job({
  name: "send-appointment-cancellation",
  schema: z.object({
    appointmentId: z.string(),
    customerId: z.string(),
  }),
  handler: async ({ payload }) => {
    console.log(
      `Sending cancellation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
    );
  },
});

export const sendAppointmentReminder = q.job({
  name: "send-appointment-reminder",
  schema: z.object({
    appointmentId: z.string(),
  }),
  handler: async ({ payload }) => {
    console.log(
      `Sending reminder email for appointment ${payload.appointmentId}`,
    );
  },
});
