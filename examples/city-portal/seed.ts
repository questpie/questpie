/**
 * City Portal Seed Script
 *
 * Seeds the database with sample British cities and content.
 */

import { cmsClient } from "./src/lib/cms-functions";

const britishCities = [
	{
		name: "London",
		slug: "london",
		population: 8982000,
		email: "contact@london.gov.uk",
		phone: "+44 20 7983 4000",
		address: "City Hall, The Queen's Walk, London SE1 2AA",
		isActive: true,
	},
	{
		name: "Manchester",
		slug: "manchester",
		population: 547627,
		email: "info@manchester.gov.uk",
		phone: "+44 161 234 5000",
		address: "Town Hall, Albert Square, Manchester M60 2LA",
		isActive: true,
	},
	{
		name: "Birmingham",
		slug: "birmingham",
		population: 1141816,
		email: "contact@birmingham.gov.uk",
		phone: "+44 121 303 1111",
		address: "Council House, Victoria Square, Birmingham B1 1BB",
		isActive: true,
	},
	{
		name: "Bristol",
		slug: "bristol",
		population: 467099,
		email: "contact@bristol.gov.uk",
		phone: "+44 117 922 2000",
		address: "City Hall, College Green, Bristol BS1 5TR",
		isActive: true,
	},
	{
		name: "Leeds",
		slug: "leeds",
		population: 793139,
		email: "info@leeds.gov.uk",
		phone: "+44 113 222 4444",
		address: "Leeds Civic Hall, Calverley Street, Leeds LS1 1UR",
		isActive: true,
	},
];

async function seedCities() {
	console.log("🏙️  Seeding cities...");

	const cityIds: Record<string, string> = {};

	for (const city of britishCities) {
		// Check if city already exists
		const existing = await cmsClient.api.collections.cities.find({
			where: { slug: city.slug },
			limit: 1,
		});

		if (existing.docs.length > 0) {
			console.log(`  ✓ ${city.name} already exists`);
			cityIds[city.slug] = existing.docs[0].id;
			continue;
		}

		// Create city
		const result = await cmsClient.api.collections.cities.create({
			...city,
		});
		cityIds[city.slug] = result.id;
		console.log(`  ✓ Created ${city.name}`);
	}

	return cityIds;
}

async function seedSiteSettings(cityIds: Record<string, string>) {
	console.log("⚙️  Seeding site settings...");

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		// Update site settings for this city
		await cmsClient.api.globals.siteSettings.update({
			scope: cityId,
			data: {
				siteName: `${city.name} Council`,
				tagline: "Working for our community",
				primaryColour: "#1e40af",
				secondaryColour: "#64748b",
				navigation: [
					{ label: "Home", href: "/", isExternal: false },
					{ label: "News", href: "/news", isExternal: false },
					{ label: "Services", href: "/services", isExternal: false },
					{ label: "Contact", href: "/contact", isExternal: false },
				],
				footerText: `Your ${city.name} council, working for you.`,
				footerLinks: [
					{ label: "Privacy Policy", href: "/privacy", isExternal: false },
					{ label: "Accessibility", href: "/accessibility", isExternal: false },
					{ label: "Contact Us", href: "/contact", isExternal: false },
				],
				copyrightText: `${city.name} Council. All rights reserved.`,
				contactEmail: city.email,
				contactPhone: city.phone,
				address: city.address,
				metaTitle: `${city.name} Council - Official Website`,
				metaDescription: `Official website of ${city.name} Council. Find information about local services, news, and how to contact us.`,
			},
		});
		console.log(`  ✓ Site settings for ${city.name}`);
	}
}

async function seedContacts(cityIds: Record<string, string>) {
	console.log("📞 Seeding contacts...");

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

			await cmsClient.api.collections.contacts.create({
				city: cityId,
				department: dept,
				description: desc,
				email: `${dept.toLowerCase().replace(/\s+/g, ".")}@${city.slug}.gov.uk`,
				phone: city.phone,
				officeHours: "Monday - Friday: 9:00 - 17:00",
				order: i,
			});
		}
		console.log(`  ✓ Contacts for ${city.name}`);
	}
}

async function seedNews(cityIds: Record<string, string>) {
	console.log("📰 Seeding news articles...");

	const newsArticles = [
		{
			title: "New recycling scheme launches next month",
			category: "environment",
			excerpt:
				"Residents will be able to recycle more items as part of our expanded service.",
			isFeatured: true,
		},
		{
			title: "Council approves new housing development",
			category: "planning",
			excerpt:
				"A major new housing development has been approved following community consultation.",
			isFeatured: false,
		},
		{
			title: "Summer events programme announced",
			category: "events",
			excerpt:
				"Check out the exciting events happening in your area this summer.",
			isFeatured: true,
		},
		{
			title: "Transport improvements underway",
			category: "transport",
			excerpt: "Work begins on major road and public transport improvements.",
			isFeatured: false,
		},
	];

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (const article of newsArticles) {
			await cmsClient.api.collections.news.create({
				city: cityId,
				...article,
				slug: article.title.toLowerCase().replace(/\s+/g, "-"),
				content: `<p>${article.excerpt}</p><p>More details coming soon...</p>`,
				isPublished: true,
				publishedAt: new Date().toISOString(),
				author: "City Council",
			});
		}
		console.log(`  ✓ News articles for ${city.name}`);
	}
}

async function seedAnnouncements(cityIds: Record<string, string>) {
	console.log("📢 Seeding announcements...");

	const announcements = [
		{
			title: "Road closure on Main Street",
			category: "notice",
			content:
				"Main Street will be closed for essential maintenance works from Monday to Friday.",
			isPinned: true,
		},
		{
			title: "Planning application: New community center",
			category: "planning",
			content:
				"We are seeking public feedback on plans for a new community center.",
			isPinned: false,
		},
		{
			title: "Public consultation: Parks strategy",
			category: "consultation",
			content: "Share your views on our future parks and open spaces strategy.",
			isPinned: false,
		},
	];

	const validFrom = new Date();
	const validTo = new Date();
	validTo.setMonth(validTo.getMonth() + 1);

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (const announcement of announcements) {
			await cmsClient.api.collections.announcements.create({
				city: cityId,
				...announcement,
				validFrom: validFrom.toISOString(),
				validTo: validTo.toISOString(),
			});
		}
		console.log(`  ✓ Announcements for ${city.name}`);
	}
}

async function seedDocuments(cityIds: Record<string, string>) {
	console.log("📄 Seeding documents...");

	const documents = [
		{ title: "Annual Report 2024", category: "report" },
		{ title: "Budget Summary", category: "budget" },
		{ title: "Planning Policy Framework", category: "policy" },
		{ title: "Community Strategy", category: "strategy" },
	];

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		for (const doc of documents) {
			await cmsClient.api.collections.documents.create({
				city: cityId,
				...doc,
				description: `Official ${doc.title} for ${city.name}`,
				publishedDate: new Date().toISOString(),
				isPublished: true,
			});
		}
		console.log(`  ✓ Documents for ${city.name}`);
	}
}

async function seedPages(cityIds: Record<string, string>) {
	console.log("📄 Seeding pages...");

	for (const city of britishCities) {
		const cityId = cityIds[city.slug];

		// Create homepage
		await cmsClient.api.collections.pages.create({
			city: cityId,
			title: `Welcome to ${city.name}`,
			slug: "home",
			excerpt: `Welcome to the official ${city.name} Council website.`,
			content: [],
			isPublished: true,
			showInNav: false,
			order: 0,
		});

		// Create about page
		await cmsClient.api.collections.pages.create({
			city: cityId,
			title: "About Us",
			slug: "about",
			excerpt: `Learn about ${city.name} Council and our services.`,
			content: [],
			isPublished: true,
			showInNav: true,
			order: 1,
		});

		// Create services page
		await cmsClient.api.collections.pages.create({
			city: cityId,
			title: "Services",
			slug: "services",
			excerpt: "Discover the services we offer to residents.",
			content: [],
			isPublished: true,
			showInNav: true,
			order: 2,
		});

		console.log(`  ✓ Pages for ${city.name}`);
	}
}

async function main() {
	console.log("🌱 Starting City Portal seed...\n");

	try {
		// Seed cities first
		const cityIds = await seedCities();

		// Seed site settings for each city
		await seedSiteSettings(cityIds);

		// Seed contacts
		await seedContacts(cityIds);

		// Seed news articles
		await seedNews(cityIds);

		// Seed announcements
		await seedAnnouncements(cityIds);

		// Seed documents
		await seedDocuments(cityIds);

		// Seed pages
		await seedPages(cityIds);

		console.log("\n✅ Seed completed successfully!");
		console.log("\nYou can now:");
		console.log("  • Visit the admin at http://localhost:3001/admin");
		console.log("  • View cities at:");
		for (const city of britishCities) {
			console.log(`    - http://localhost:3001/${city.slug}`);
		}
	} catch (error) {
		console.error("\n❌ Seed failed:", error);
		process.exit(1);
	}
}

main();
