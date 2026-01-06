/**
 * Database Seeder
 *
 * Seeds the database with sample data for development.
 * Usage: bun run seed.ts
 */

import { cms } from "./src/cms";

async function seed() {
	console.log("Seeding database...\n");

	try {
		// Create system context (bypasses access control)
		const ctx = await cms.createContext({ accessMode: "system" });

		// ========================================
		// Seed Site Settings
		// ========================================
		console.log("Seeding site settings...");
		await cms.api.globals.site_settings.update(
			{
				siteName: "Creative Studio",
				tagline: "We build beautiful digital experiences",
				contactEmail: "hello@creativestudio.com",
				contactPhone: "+1 (555) 123-4567",
				address: "123 Design Street, San Francisco, CA 94102",
				socialLinks: {
					twitter: "https://twitter.com/creativestudio",
					linkedin: "https://linkedin.com/company/creativestudio",
					github: "https://github.com/creativestudio",
					instagram: "https://instagram.com/creativestudio",
				},
				seo: {
					defaultTitle: "Creative Studio - Digital Design Agency",
					defaultDescription:
						"We craft beautiful websites and digital experiences.",
					titleSuffix: " | Creative Studio",
				},
			},
			ctx,
		);

		// ========================================
		// Seed Categories
		// ========================================
		console.log("Seeding categories...");
		const webDesign = await cms.api.collections.categories.create(
			{
				slug: "web-design",
				name: "Web Design",
				description: "Website design and development projects",
				order: 1,
			},
			ctx,
		);

		const branding = await cms.api.collections.categories.create(
			{
				slug: "branding",
				name: "Branding",
				description: "Brand identity and visual design",
				order: 2,
			},
			ctx,
		);

		const mobile = await cms.api.collections.categories.create(
			{
				slug: "mobile-apps",
				name: "Mobile Apps",
				description: "iOS and Android applications",
				order: 3,
			},
			ctx,
		);

		// ========================================
		// Seed Services
		// ========================================
		console.log("Seeding services...");
		const serviceWebDev = await cms.api.collections.services.create(
			{
				title: "Web Development",
				tagline: "Modern, fast, accessible websites",
				description:
					"We build custom websites using the latest technologies. From simple landing pages to complex web applications.",
				icon: "code",
				priceFrom: 500000, // $5,000
				priceTo: 2500000, // $25,000
				priceUnit: "project",
				featured: true,
				order: 1,
			},
			ctx,
		);

		await cms.api.collections.services.create(
			{
				title: "UI/UX Design",
				tagline: "User-centered design that converts",
				description:
					"Research-driven design process to create intuitive and engaging user experiences.",
				icon: "palette",
				priceFrom: 300000,
				priceTo: 1500000,
				priceUnit: "project",
				featured: true,
				order: 2,
			},
			ctx,
		);

		await cms.api.collections.services.create(
			{
				title: "Brand Identity",
				tagline: "Stand out from the crowd",
				description:
					"Complete brand identity packages including logo, colors, typography, and brand guidelines.",
				icon: "brush",
				priceFrom: 200000,
				priceTo: 800000,
				priceUnit: "project",
				featured: true,
				order: 3,
			},
			ctx,
		);

		// ========================================
		// Seed Team Members
		// ========================================
		console.log("Seeding team members...");
		await cms.api.collections.team_members.create(
			{
				name: "Sarah Chen",
				role: "Founder & Creative Director",
				bio: "Sarah has 15 years of experience in digital design. She founded Creative Studio to help businesses create meaningful digital experiences.",
				email: "sarah@creativestudio.com",
				socialLinks: {
					twitter: "https://twitter.com/sarahchen",
					linkedin: "https://linkedin.com/in/sarahchen",
				},
				order: 1,
			},
			ctx,
		);

		await cms.api.collections.team_members.create(
			{
				name: "Marcus Johnson",
				role: "Lead Developer",
				bio: "Marcus specializes in building scalable web applications. He's passionate about clean code and modern development practices.",
				email: "marcus@creativestudio.com",
				socialLinks: {
					github: "https://github.com/marcusj",
					linkedin: "https://linkedin.com/in/marcusjohnson",
				},
				order: 2,
			},
			ctx,
		);

		await cms.api.collections.team_members.create(
			{
				name: "Emma Rodriguez",
				role: "Senior Designer",
				bio: "Emma brings brands to life through thoughtful visual design. She has worked with clients ranging from startups to Fortune 500 companies.",
				email: "emma@creativestudio.com",
				socialLinks: {
					dribbble: "https://dribbble.com/emmarodriguez",
				},
				order: 3,
			},
			ctx,
		);

		// ========================================
		// Seed Projects
		// ========================================
		console.log("Seeding projects...");
		const project1 = await cms.api.collections.projects.create(
			{
				slug: "fintech-dashboard",
				title: "Fintech Dashboard",
				description:
					"A comprehensive financial dashboard for a leading fintech startup. Features real-time data visualization and intuitive user interface.",
				content: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "This project showcases our ability to handle complex data visualization...",
								},
							],
						},
					],
				},
				categoryId: webDesign.id,
				featured: true,
				status: "published",
				publishedAt: new Date(),
				metaTitle: "Fintech Dashboard Case Study",
				metaDescription:
					"See how we built a comprehensive financial dashboard for a fintech startup.",
			},
			ctx,
		);

		const project2 = await cms.api.collections.projects.create(
			{
				slug: "eco-brand-identity",
				title: "Eco Brand Identity",
				description:
					"Complete brand identity for an eco-friendly consumer goods company. Sustainable design meets modern aesthetics.",
				categoryId: branding.id,
				featured: true,
				status: "published",
				publishedAt: new Date(),
			},
			ctx,
		);

		const project3 = await cms.api.collections.projects.create(
			{
				slug: "fitness-app",
				title: "FitTrack Mobile App",
				description:
					"A fitness tracking app with personalized workout plans and progress tracking. Available on iOS and Android.",
				categoryId: mobile.id,
				featured: false,
				status: "published",
				publishedAt: new Date(),
			},
			ctx,
		);

		// ========================================
		// Seed Testimonials
		// ========================================
		console.log("Seeding testimonials...");
		await cms.api.collections.testimonials.create(
			{
				clientName: "John Smith",
				clientCompany: "TechCorp Inc.",
				clientRole: "CEO",
				content:
					"Creative Studio transformed our online presence. Their attention to detail and understanding of our brand was exceptional. Highly recommended!",
				rating: 5,
				featured: true,
				projectId: project1.id,
				order: 1,
			},
			ctx,
		);

		await cms.api.collections.testimonials.create(
			{
				clientName: "Maria Garcia",
				clientCompany: "GreenLife Co.",
				clientRole: "Marketing Director",
				content:
					"Working with Creative Studio was a pleasure. They delivered our brand identity on time and exceeded our expectations.",
				rating: 5,
				featured: true,
				projectId: project2.id,
				order: 2,
			},
			ctx,
		);

		// ========================================
		// Seed Homepage Config
		// ========================================
		console.log("Seeding homepage config...");
		await cms.api.globals.homepage.update(
			{
				heroTitle: "We Create Digital Experiences",
				heroSubtitle:
					"Award-winning design studio specializing in web development, branding, and digital strategy.",
				heroCta: "View Our Work",
				heroCtaLink: "/projects",
				featuredProjectIds: [project1.id, project2.id, project3.id],
				featuredServiceIds: [serviceWebDev.id],
				aboutTitle: "About Us",
				aboutContent:
					"We're a team of designers, developers, and strategists who love creating beautiful, functional digital products. Since 2015, we've helped over 100 clients bring their visions to life.",
			},
			ctx,
		);

		console.log("\n✓ Database seeded successfully!");
		console.log("\nSeeded:");
		console.log("  - 1 site settings global");
		console.log("  - 1 homepage global");
		console.log("  - 3 categories");
		console.log("  - 3 services");
		console.log("  - 3 team members");
		console.log("  - 3 projects");
		console.log("  - 2 testimonials");
	} catch (error) {
		console.error("Seeding failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

seed();
