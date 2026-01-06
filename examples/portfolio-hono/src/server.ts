/**
 * Portfolio API Server (Hono)
 *
 * Demonstrates:
 * - Mounting CMS routes with questpieHono
 * - Custom API routes (contact form)
 * - Middleware usage
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { questpieHono, questpieMiddleware } from "@questpie/hono";
import { cms } from "./cms";
import { z } from "zod";

// ============================================================================
// Create Hono App
// ============================================================================

const app = new Hono()
	// Middleware
	.use("*", logger())
	.use("*", cors())
	// Add CMS context to all routes
	.use("*", questpieMiddleware(cms))
	// Mount CMS routes (REST API + Auth + Storage)
	.route("/", questpieHono(cms, { basePath: "/cms" }));

// ============================================================================
// Custom API Routes
// ============================================================================

// Contact form schema
const contactFormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	email: z.string().email("Invalid email"),
	phone: z.string().optional(),
	company: z.string().optional(),
	subject: z.string().optional(),
	message: z.string().min(10, "Message must be at least 10 characters"),
	serviceInterest: z.string().optional(),
});

/**
 * Contact Form Endpoint
 *
 * Public endpoint that creates a contact_submission
 * and triggers the notification job.
 */
app.post("/api/contact", async (c) => {
	const body = await c.req.json();

	// Validate input
	const result = contactFormSchema.safeParse(body);
	if (!result.success) {
		return c.json(
			{
				error: "Validation failed",
				details: result.error.flatten().fieldErrors,
			},
			400,
		);
	}

	const data = result.data;

	try {
		// Create contact submission (public access)
		const submission = await cms.api.collections.contact_submissions.create(
			{
				name: data.name,
				email: data.email,
				phone: data.phone,
				company: data.company,
				subject: data.subject,
				message: data.message,
				serviceInterest: data.serviceInterest,
				status: "new",
			},
			{ accessMode: "system" }, // Bypass access control for public form
		);

		return c.json({
			success: true,
			message: "Thank you for your message. We'll get back to you soon!",
			id: submission.id,
		});
	} catch (error) {
		console.error("Contact form error:", error);
		return c.json(
			{
				error: "Failed to submit contact form. Please try again.",
			},
			500,
		);
	}
});

/**
 * Health Check Endpoint
 */
app.get("/api/health", (c) => {
	return c.json({
		status: "ok",
		timestamp: new Date().toISOString(),
	});
});

/**
 * Homepage Data Endpoint
 *
 * Returns aggregated data for the homepage.
 */
app.get("/api/homepage", async (c) => {
	// Get homepage config
	const homepageConfig = await cms.api.globals.homepage.get();

	// Get featured projects
	const featuredProjects = homepageConfig.featuredProjectIds?.length
		? await cms.api.collections.projects.find({
				where: {
					id: { in: homepageConfig.featuredProjectIds },
					status: "published",
				},
				with: { category: true, images: true },
			})
		: { docs: [] };

	// Get featured services
	const featuredServices = homepageConfig.featuredServiceIds?.length
		? await cms.api.collections.services.find({
				where: {
					id: { in: homepageConfig.featuredServiceIds },
					isActive: true,
				},
				orderBy: { order: "asc" },
			})
		: { docs: [] };

	// Get featured testimonials
	const testimonials = await cms.api.collections.testimonials.find({
		where: { featured: true },
		orderBy: { order: "asc" },
		limit: 3,
	});

	// Get team members
	const team = await cms.api.collections.team_members.find({
		orderBy: { order: "asc" },
		limit: 4,
	});

	return c.json({
		hero: {
			title: homepageConfig.heroTitle,
			subtitle: homepageConfig.heroSubtitle,
			image: homepageConfig.heroImage,
			cta: homepageConfig.heroCta,
			ctaLink: homepageConfig.heroCtaLink,
		},
		about: {
			title: homepageConfig.aboutTitle,
			content: homepageConfig.aboutContent,
			image: homepageConfig.aboutImage,
		},
		projects: featuredProjects.docs,
		services: featuredServices.docs,
		testimonials: testimonials.docs,
		team: team.docs,
	});
});

// ============================================================================
// Export and Start Server
// ============================================================================

export type AppType = typeof app;

// Start server
const port = Number.parseInt(process.env.PORT || "3000", 10);

console.log(`
  Portfolio API Server
  ====================
  URL: http://localhost:${port}
  
  CMS Endpoints:
  - GET  /cms/projects         List projects
  - POST /cms/projects         Create project
  - GET  /cms/projects/:id     Get project
  - etc.
  
  Custom Endpoints:
  - POST /api/contact          Submit contact form
  - GET  /api/homepage         Get homepage data
  - GET  /api/health           Health check
`);

export default {
	port,
	fetch: app.fetch,
};
