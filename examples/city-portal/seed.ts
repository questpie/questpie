/**
 * City Portal Seed Script
 *
 * Seeds the database with sample British cities, varied branding, and content.
 * Usage: bun run seed.ts [--force]
 */

import { app } from "./src/questpie/server/app";

// ============================================================================
// Helper: TipTap Rich Text
// ============================================================================

function richText(paragraphs: string[]) {
	return {
		type: "doc",
		content: paragraphs.map((text) => ({
			type: "paragraph",
			content: [{ type: "text", text }],
		})),
	};
}

// ============================================================================
// City data
// ============================================================================

const britishCities = [
	{
		name: "London",
		slug: "london",
		population: 8982000,
		email: "contact@london.gov.uk",
		phone: "+44 20 7983 4000",
		address: "City Hall, The Queen's Walk, London SE1 2AA",
		website: "https://www.london.gov.uk",
		isActive: true,
		primaryColour: "#1e40af", // Blue
		tagline: "The heart of the nation",
	},
	{
		name: "Manchester",
		slug: "manchester",
		population: 547627,
		email: "info@manchester.gov.uk",
		phone: "+44 161 234 5000",
		address: "Town Hall, Albert Square, Manchester M60 2LA",
		website: "https://www.manchester.gov.uk",
		isActive: true,
		primaryColour: "#dc2626", // Red
		tagline: "Original modern city",
	},
	{
		name: "Birmingham",
		slug: "birmingham",
		population: 1141816,
		email: "contact@birmingham.gov.uk",
		phone: "+44 121 303 1111",
		address: "Council House, Victoria Square, Birmingham B1 1BB",
		website: "https://www.birmingham.gov.uk",
		isActive: true,
		primaryColour: "#16a34a", // Green
		tagline: "City of a thousand trades",
	},
	{
		name: "Bristol",
		slug: "bristol",
		population: 467099,
		email: "contact@bristol.gov.uk",
		phone: "+44 117 922 2000",
		address: "City Hall, College Green, Bristol BS1 5TR",
		website: "https://www.bristol.gov.uk",
		isActive: true,
		primaryColour: "#9333ea", // Purple
		tagline: "Where innovation meets heritage",
	},
	{
		name: "Leeds",
		slug: "leeds",
		population: 793139,
		email: "info@leeds.gov.uk",
		phone: "+44 113 222 4444",
		address: "Leeds Civic Hall, Calverley Street, Leeds LS1 1UR",
		website: "https://www.leeds.gov.uk",
		isActive: true,
		primaryColour: "#ea580c", // Orange
		tagline: "The northern powerhouse",
	},
];

// ============================================================================
// Main Seed
// ============================================================================

async function seed() {
	const force = process.argv.includes("--force");

	console.log("🌱 Starting City Portal seed...\n");

	const ctx = await app.createContext({
		accessMode: "system",
	});

	// ========================================
	// Idempotency check
	// ========================================
	const existing = await app.api.collections.cities.find(
		{ where: { slug: "london" }, limit: 1 },
		ctx,
	);
	if (existing.totalDocs > 0 && !force) {
		console.log("Database already seeded. Use --force to re-seed.");
		process.exit(0);
	}

	// ========================================
	// Clean existing data (if re-seeding)
	// ========================================
	if (force) {
		console.log("Cleaning existing data...");
		const cleanupSteps: [string, () => Promise<unknown>][] = [
			[
				"submissions",
				() => app.api.collections.submissions.delete({ where: {} }, ctx),
			],
			[
				"documents",
				() => app.api.collections.documents.delete({ where: {} }, ctx),
			],
			[
				"announcements",
				() => app.api.collections.announcements.delete({ where: {} }, ctx),
			],
			["news", () => app.api.collections.news.delete({ where: {} }, ctx)],
			[
				"contacts",
				() => app.api.collections.contacts.delete({ where: {} }, ctx),
			],
			["pages", () => app.api.collections.pages.delete({ where: {} }, ctx)],
			[
				"cityMembers",
				() => app.api.collections.cityMembers.delete({ where: {} }, ctx),
			],
			["cities", () => app.api.collections.cities.delete({ where: {} }, ctx)],
		];
		for (const [name, fn] of cleanupSteps) {
			try {
				await fn();
				console.log(`  ✓ ${name}`);
			} catch (e) {
				console.log(
					`  ⚠ ${name} (skipped: ${e instanceof Error ? e.message : e})`,
				);
			}
		}
		console.log("");
	}

	// ========================================
	// Cities
	// ========================================
	console.log("Creating cities...");
	const cityIds: Record<string, string> = {};

	for (const city of britishCities) {
		const result = await app.api.collections.cities.create(
			{
				name: city.name,
				slug: city.slug,
				population: city.population,
				email: city.email,
				phone: city.phone,
				address: city.address,
				website: city.website,
				isActive: city.isActive,
			},
			ctx,
		);
		cityIds[city.slug] = result.id;
		console.log(`  ✓ ${city.name}`);
	}
	console.log("");

	// ========================================
	// Site Settings (scoped per city)
	// ========================================
	console.log("Updating site settings...");

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];
		const cityCtx = await app.createContext({
			accessMode: "system",
			cityId,
		});

		await app.api.globals.siteSettings.update(
			{
				siteName: `${city.name} Council`,
				tagline: city.tagline,
				primaryColour: city.primaryColour,
				secondaryColour: "#64748b",
				navigation: [
					{ label: "Home", href: "/", isExternal: false },
					{ label: "News", href: "/news", isExternal: false },
					{
						label: "Announcements",
						href: "/announcements",
						isExternal: false,
					},
					{ label: "Documents", href: "/documents", isExternal: false },
					{ label: "Contact", href: "/contact", isExternal: false },
				],
				footerText: `Your ${city.name} council, ${city.tagline.toLowerCase()}.`,
				footerLinks: [
					{
						label: "Privacy Policy",
						href: "/pages/privacy",
						isExternal: false,
					},
					{
						label: "Accessibility",
						href: "/pages/accessibility",
						isExternal: false,
					},
					{ label: "Contact Us", href: "/contact", isExternal: false },
				],
				copyrightText: `${city.name} Council. All rights reserved.`,
				contactEmail: city.email,
				contactPhone: city.phone,
				address: city.address,
				openingHours:
					"Monday - Friday: 9:00 - 17:00\nSaturday - Sunday: Closed",
				metaTitle: `${city.name} Council - Official Website`,
				metaDescription: `Official website of ${city.name} Council. Find information about local services, news, and how to contact us.`,
				socialLinks: [
					{
						platform: "facebook",
						url: `https://facebook.com/${city.slug}council`,
					},
					{
						platform: "twitter",
						url: `https://twitter.com/${city.slug}council`,
					},
				],
			},
			cityCtx,
		);
		console.log(`  ✓ ${city.name} (${city.primaryColour})`);
	}
	console.log("");

	// ========================================
	// Contacts
	// ========================================
	console.log("Creating contacts...");

	const departments = [
		{
			dept: "Planning Department",
			desc: "Planning applications and building regulations",
		},
		{ dept: "Housing Services", desc: "Council housing and housing advice" },
		{ dept: "Council Tax", desc: "Council tax payments and enquiries" },
		{
			dept: "Waste & Recycling",
			desc: "Bin collections and recycling services",
		},
		{
			dept: "Environmental Health",
			desc: "Public health and environmental issues",
		},
		{
			dept: "Highways & Transport",
			desc: "Road maintenance and transport services",
		},
	];

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (let i = 0; i < departments.length; i++) {
			const { dept, desc } = departments[i];

			await app.api.collections.contacts.create(
				{
					city: cityId,
					department: dept,
					description: desc,
					email: `${dept.toLowerCase().replace(/\s+/g, ".")}@${city.slug}.gov.uk`,
					phone: city.phone,
					officeHours: "Monday - Friday: 9:00 - 17:00",
					order: i,
				},
				ctx,
			);
		}
		console.log(`  ✓ ${city.name} (${departments.length} departments)`);
	}
	console.log("");

	// ========================================
	// News
	// ========================================
	console.log("Creating news articles...");

	const newsArticles = [
		{
			title: "New recycling scheme launches next month",
			category: "community",
			excerpt:
				"Residents will be able to recycle more items as part of our expanded service.",
			isFeatured: true,
			daysAgo: 1,
		},
		{
			title: "Council approves new housing development",
			category: "planning",
			excerpt:
				"A major new housing development has been approved following community consultation.",
			isFeatured: false,
			daysAgo: 3,
		},
		{
			title: "Summer events programme announced",
			category: "events",
			excerpt:
				"Check out the exciting events happening in your area this summer.",
			isFeatured: true,
			daysAgo: 5,
		},
		{
			title: "Transport improvements underway",
			category: "transport",
			excerpt: "Work begins on major road and public transport improvements.",
			isFeatured: false,
			daysAgo: 7,
		},
		{
			title: "Budget consultation opens for 2025/26",
			category: "council",
			excerpt:
				"Have your say on how the council allocates its budget for the coming year.",
			isFeatured: false,
			daysAgo: 10,
		},
		{
			title: "Free swimming sessions for under 16s",
			category: "community",
			excerpt:
				"New programme offers free swimming at all council-run leisure centres during school holidays.",
			isFeatured: true,
			daysAgo: 14,
		},
		{
			title: "New cycle lanes approved for city centre",
			category: "transport",
			excerpt:
				"Protected cycle infrastructure to be installed along major routes following successful trial.",
			isFeatured: false,
			daysAgo: 18,
		},
		{
			title: "Council tax support scheme extended",
			category: "general",
			excerpt:
				"Additional support available for residents struggling with council tax payments.",
			isFeatured: false,
			daysAgo: 21,
		},
	];

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (const article of newsArticles) {
			const publishedAt = new Date();
			publishedAt.setDate(publishedAt.getDate() - article.daysAgo);

			await app.api.collections.news.create(
				{
					city: cityId,
					title: article.title,
					slug: article.title
						.toLowerCase()
						.replace(/[^a-z0-9]+/g, "-")
						.replace(/^-|-$/g, ""),
					category: article.category as any,
					excerpt: article.excerpt,
					content: richText([
						article.excerpt,
						`This is an example news article for ${city.name} Council. In a real deployment, this would contain the full article content with images, links, and detailed information.`,
					]),
					isPublished: true,
					isFeatured: article.isFeatured,
					publishedAt: publishedAt.toISOString(),
					author: `${city.name} Council`,
				},
				ctx,
			);
		}
		console.log(`  ✓ ${city.name} (${newsArticles.length} articles)`);
	}
	console.log("");

	// ========================================
	// Announcements
	// ========================================
	console.log("Creating announcements...");

	const announcements = [
		{
			title: "Road closure on Main Street",
			category: "notice",
			body: "Main Street will be closed for essential maintenance works from Monday to Friday. Alternative routes are available via Park Road.",
			isPinned: true,
		},
		{
			title: "Planning application: New community centre",
			category: "planning",
			body: "We are seeking public feedback on plans for a new community centre on the former library site.",
			isPinned: false,
		},
		{
			title: "Public consultation: Parks strategy",
			category: "consultation",
			body: "Share your views on our future parks and open spaces strategy. The consultation runs until the end of the month.",
			isPinned: false,
		},
		{
			title: "Graduate trainee programme 2025",
			category: "job",
			body: "Applications are now open for our graduate trainee programme. We offer placements across multiple departments.",
			isPinned: false,
		},
		{
			title: "Summer festival volunteer registration",
			category: "event",
			body: "Register as a volunteer for this year's summer festival. Help us make it the best one yet!",
			isPinned: false,
		},
	];

	const validFrom = new Date();
	const validTo = new Date();
	validTo.setMonth(validTo.getMonth() + 2);

	// Date-only strings for f.date() fields
	const validFromStr = validFrom.toISOString().split("T")[0];
	const validToStr = validTo.toISOString().split("T")[0];

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (const announcement of announcements) {
			await app.api.collections.announcements.create(
				{
					city: cityId,
					title: announcement.title,
					category: announcement.category as any,
					content: richText([announcement.body]),
					isPinned: announcement.isPinned,
					validFrom: validFromStr,
					validTo: validToStr,
				},
				ctx,
			);
		}
		console.log(`  ✓ ${city.name} (${announcements.length} announcements)`);
	}
	console.log("");

	// ========================================
	// Documents (skip — file field is required and we have no files to upload)
	// ========================================
	console.log(
		"Skipping documents (file upload required — seed via admin UI).\n",
	);

	// ========================================
	// Pages (with block content)
	// ========================================
	console.log("Creating pages...");

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		// Homepage
		await app.api.collections.pages.create(
			{
				city: cityId,
				title: `Welcome to ${city.name}`,
				slug: "home",
				excerpt: `Welcome to the official ${city.name} Council website.`,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "news-1", type: "latest-news", children: [] },
						{ id: "cta-1", type: "cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: `Welcome to ${city.name}`,
							subtitle: `${city.tagline}. Your council, working for you.`,
							alignment: "center",
							height: "large",
							ctaText: "View News",
							ctaLink: `/${city.slug}/news`,
							overlayOpacity: 60,
							showSearch: false,
						},
						"news-1": {
							title: "Latest News",
							count: 3,
							showFeatured: true,
							category: "all",
							layout: "grid",
						},
						"cta-1": {
							title: "Get in Touch",
							description:
								"Have a question or need help with council services? We are here to help.",
							buttonText: "Contact Us",
							buttonLink: `/${city.slug}/contact`,
							variant: "highlight",
						},
					},
				} as any,
				isPublished: true,
				showInNav: false,
				order: 0,
			},
			ctx,
		);

		// About page
		await app.api.collections.pages.create(
			{
				city: cityId,
				title: "About Us",
				slug: "about",
				excerpt: `Learn about ${city.name} Council and our services.`,
				content: {
					_tree: [{ id: "text-1", type: "text", children: [] }],
					_values: {
						"text-1": {
							content: richText([
								`About ${city.name} Council`,
								`${city.name} Council is committed to providing high-quality services to our residents. With a population of ${city.population?.toLocaleString()}, we serve one of the most vibrant communities in the country.`,
								`Our mission is to make ${city.name} a great place to live, work, and visit.`,
							]),
							maxWidth: "medium",
							padding: "large",
						},
					},
				} as any,
				isPublished: true,
				showInNav: true,
				order: 1,
			},
			ctx,
		);

		// Services page
		await app.api.collections.pages.create(
			{
				city: cityId,
				title: "Services",
				slug: "services",
				excerpt: "Discover the services we offer to residents.",
				content: {
					_tree: [
						{ id: "heading-1", type: "heading", children: [] },
						{ id: "contacts-1", type: "contacts-list", children: [] },
					],
					_values: {
						"heading-1": {
							text: "Our Services",
							level: "h2",
							align: "left",
						},
						"contacts-1": {
							title: "Council Departments",
							showAll: true,
						},
					},
				} as any,
				isPublished: true,
				showInNav: true,
				order: 2,
			},
			ctx,
		);

		console.log(`  ✓ ${city.name} (3 pages with block content)`);
	}
	console.log("");

	// ========================================
	// Done
	// ========================================
	console.log("✅ Seed completed successfully!");
	console.log("\nYou can now:");
	console.log("  Visit http://localhost:3001/ for the city landing page");
	console.log("  Visit the admin at http://localhost:3001/admin");
	console.log("  View cities at:");
	for (const city of britishCities) {
		console.log(
			`    - http://localhost:3001/${city.slug} (${city.primaryColour})`,
		);
	}

	process.exit(0);
}

seed().catch((error) => {
	console.error("\n❌ Seed failed:", error);
	process.exit(1);
});
