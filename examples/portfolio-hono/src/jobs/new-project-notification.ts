/**
 * New Project Notification Job
 *
 * Notifies when a new project is published.
 * Demonstrates:
 * - Fetching related data in job handler
 * - Multiple email sends
 */

import { defineJob, getCMSFromContext } from "@questpie/cms/server";
import { z } from "zod";
import type { AppCMS } from "../cms";

export const newProjectNotificationJob = defineJob({
	name: "notify-new-project",
	schema: z.object({
		projectId: z.string(),
		title: z.string(),
	}),
	handler: async (payload) => {
		const cms = getCMSFromContext<AppCMS>();

		// Get project with category
		const project = await cms.api.collections.projects.findOne({
			where: { id: payload.projectId },
			with: { category: true },
		});

		if (!project) {
			console.log(
				`[Job: notify-new-project] Project ${payload.projectId} not found`,
			);
			return;
		}

		// Get site settings
		const settings = await cms.api.globals.site_settings.get();

		// Log the event (could also notify subscribers, post to social, etc.)
		console.log(
			`[Job: notify-new-project] New project published: ${project.title}`,
		);
		console.log(
			`[Job: notify-new-project] Category: ${project.category?.name || "Uncategorized"}`,
		);

		// Example: Send to admin
		if (settings.contactEmail) {
			await cms.email.send({
				to: settings.contactEmail,
				subject: `New Project Published: ${project.title}`,
				html: `
					<h2>New Project Published</h2>
					<p><strong>Title:</strong> ${project.title}</p>
					<p><strong>Category:</strong> ${project.category?.name || "Uncategorized"}</p>
					<p><a href="${process.env.APP_URL}/projects/${project.slug}">View Project</a></p>
				`,
			});
		}
	},
	options: {
		retryLimit: 2,
		retryDelay: 30,
	},
});
