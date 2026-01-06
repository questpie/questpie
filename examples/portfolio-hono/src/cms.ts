/**
 * Portfolio CMS Configuration
 *
 * A complete example showing:
 * - Collections with relations and localization
 * - Globals for site settings
 * - Background jobs for notifications
 * - Better Auth integration
 * - Storage and Email configuration
 */

import {
	defineQCMS,
	pgBossAdapter,
	ConsoleAdapter,
	SmtpAdapter,
} from "@questpie/cms/server";

// Collections
import {
	projects,
	categories,
	projectImages,
	services,
	teamMembers,
	testimonials,
	contactSubmissions,
} from "./collections";

// Globals
import { siteSettings, homepage } from "./globals";

// Jobs
import { contactNotificationJob, newProjectNotificationJob } from "./jobs";

// ============================================================================
// Environment Configuration
// ============================================================================

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/portfolio";
const APP_URL = process.env.APP_URL || "http://localhost:3000";

// ============================================================================
// CMS Instance
// ============================================================================

/**
 * Portfolio CMS Instance
 *
 * Built using the fluent builder pattern:
 * 1. defineQCMS() - Start with a name
 * 2. .collections() - Add your collections
 * 3. .globals() - Add singleton settings
 * 4. .jobs() - Add background jobs
 * 5. .auth() - Configure authentication
 * 6. .build() - Finalize with runtime config
 */
export const cms = defineQCMS({ name: "portfolio" })
	// Register collections
	.collections({
		projects,
		categories,
		project_images: projectImages,
		services,
		team_members: teamMembers,
		testimonials,
		contact_submissions: contactSubmissions,
	})
	// Register globals
	.globals({
		site_settings: siteSettings,
		homepage,
	})
	// Register background jobs
	.jobs({
		"contact-notification": contactNotificationJob,
		"notify-new-project": newProjectNotificationJob,
	})
	// Configure authentication
	.auth({
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false, // Simplified for demo
		},
		baseURL: APP_URL,
		secret: process.env.BETTER_AUTH_SECRET || "change-me-in-production",
	})
	// Build with runtime configuration
	.build({
		app: {
			url: APP_URL,
		},
		db: {
			url: DATABASE_URL,
		},
		secret: process.env.SECRET,
		// Storage configuration (default: local filesystem)
		storage: {
			// Uses ./uploads by default
			// For S3: driver: s3Driver({ bucket: 'my-bucket', ... })
		},
		// Email configuration
		email: {
			adapter:
				process.env.NODE_ENV === "production"
					? new SmtpAdapter({
							transport: {
								host: process.env.SMTP_HOST || "localhost",
								port: Number.parseInt(process.env.SMTP_PORT || "587", 10),
								secure: process.env.SMTP_SECURE === "true",
								auth: {
									user: process.env.SMTP_USER,
									pass: process.env.SMTP_PASS,
								},
							},
						})
					: new ConsoleAdapter({ logHtml: false }),
		},
		// Queue configuration (pg-boss)
		queue: {
			adapter: pgBossAdapter({
				connectionString: DATABASE_URL,
			}),
		},
	});

// Export type for use in other files
export type AppCMS = typeof cms;
