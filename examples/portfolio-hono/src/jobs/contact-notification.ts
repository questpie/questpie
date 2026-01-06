/**
 * Contact Notification Job
 *
 * Sends email notification when new contact form is submitted.
 * Demonstrates:
 * - defineJob with Zod schema
 * - Email sending via CMS
 * - Accessing CMS context in job handler
 */

import { defineJob, getCMSFromContext } from "@questpie/cms/server";
import { z } from "zod";
import type { AppCMS } from "../cms";

export const contactNotificationJob = defineJob({
	name: "contact-notification",
	schema: z.object({
		submissionId: z.string(),
		name: z.string(),
		email: z.string(),
		subject: z.string(),
	}),
	handler: async (payload) => {
		const cms = getCMSFromContext<AppCMS>();

		// Get site settings for admin email
		const settings = await cms.api.globals.site_settings.get();
		const adminEmail = settings.contactEmail || "admin@example.com";

		// Send notification email
		await cms.email.send({
			to: adminEmail,
			subject: `New Contact: ${payload.subject}`,
			html: `
				<h2>New Contact Form Submission</h2>
				<p><strong>From:</strong> ${payload.name} (${payload.email})</p>
				<p><strong>Subject:</strong> ${payload.subject}</p>
				<p><a href="${process.env.APP_URL}/admin/contact-submissions/${payload.submissionId}">View in Admin</a></p>
			`,
		});

		console.log(`[Job: contact-notification] Email sent to ${adminEmail}`);
	},
	options: {
		retryLimit: 3,
		retryDelay: 60,
		retryBackoff: true,
	},
});
