/**
 * Queue Jobs
 *
 * Background jobs for email notifications and other async tasks.
 */

import { eq } from "drizzle-orm";
import { getApp, q } from "questpie";
import { z } from "zod";
import type { AppCMS } from "@/questpie/server/cms";

// ============================================================================
// Appointment Jobs
// ============================================================================

/**
 * Send appointment confirmation email
 */
export const sendAppointmentConfirmation = q.job({
  name: "send-appointment-confirmation",
  schema: z.object({
    appointmentId: z.string(),
    customerId: z.string(),
  }),
  handler: async ({ payload, app }) => {
    const cms = getApp<AppCMS>(app);

    console.log(
      `Sending confirmation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
    );

    const userTable = cms.config.collections.user.table;

    const customer = await cms.db
      .select({ email: userTable.email, name: userTable.name })
      .from(userTable)
      .where(eq(userTable.id, payload.customerId))
      .limit(1)
      .then((res) => res[0]);

    // const customerEmail = await cms.api.collections.user.findOne({
    //   where: { id: payload.customerId },
    //   columns: {
    //     email: true,
    //     name: true,
    //   }
    // })

    // Use cms.email to send emails
    await cms.email.send({
      to: customer?.email || "",
      subject: "Appointment Confirmation",
      text: `Dear ${customer?.name || "Customer"},\n\nYour appointment (ID: ${payload.appointmentId}) has been confirmed.\n\nThank you!`,
    });
  },
});

/**
 * Send appointment cancellation email
 */
export const sendAppointmentCancellation = q.job({
  name: "send-appointment-cancellation",
  schema: z.object({
    appointmentId: z.string(),
    customerId: z.string(),
  }),
  handler: async ({ payload, app }) => {
    console.log(
      `Sending cancellation email for appointment ${payload.appointmentId} to customer ${payload.customerId}`,
    );
    // Use app.email to send emails
  },
});

/**
 * Send appointment reminder email
 */
export const sendAppointmentReminder = q.job({
  name: "send-appointment-reminder",
  schema: z.object({
    appointmentId: z.string(),
  }),
  handler: async ({ payload }) => {
    console.log(
      `Sending reminder email for appointment ${payload.appointmentId}`,
    );
    // TODO: Implement reminder logic
  },
});
