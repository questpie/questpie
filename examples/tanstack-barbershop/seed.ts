/**
 * Database Seeder
 *
 * Seeds the database with demo data for the TanStack barbershop example.
 * Usage: bun run seed.ts
 */

import { cms } from "./src/questpie/server/cms";

const UNSPLASH_IMAGES = {
	hero: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=1920&h=1080&fit=crop",
	barber1:
		"https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop",
	barber2:
		"https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop",
	barber3:
		"https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop",
	service1:
		"https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800&h=600&fit=crop",
	service2:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&h=600&fit=crop",
	service3:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&h=600&fit=crop",
} as const;

async function uploadImage(url: string, name: string, ctx: any) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download image: ${url}`);
	}

	const contentType = response.headers.get("content-type") || "image/jpeg";
	const extension = contentType.includes("png") ? "png" : "jpg";
	const buffer = await response.arrayBuffer();
	const file = new File([buffer], `${name}.${extension}`, {
		type: contentType,
	});

	const asset = await cms.api.collections.assets.upload(file, ctx);
	return asset.id as string;
}

async function seed() {
	console.log("Seeding database...\n");

	try {
		const ctxEn = await cms.createContext({
			accessMode: "system",
			locale: "en",
		});
		const ctxSk = await cms.createContext({
			accessMode: "system",
			locale: "sk",
		});

		// ========================================
		// Clean existing data
		// ========================================
		console.log("Cleaning existing data...");
		await cms.api.collections.reviews.delete({ where: {} }, ctxEn);
		await cms.api.collections.barbers.delete({ where: {} }, ctxEn);
		await cms.api.collections.services.delete({ where: {} }, ctxEn);
		await cms.api.collections.pages.delete({ where: {} }, ctxEn);
		await cms.api.collections.assets.delete({ where: {} }, ctxEn);
		console.log("  ✓ Data cleaned\n");

		// ========================================
		// Upload images
		// ========================================
		console.log("Uploading images...");
		const images: Record<string, string> = {};
		for (const [key, url] of Object.entries(UNSPLASH_IMAGES)) {
			images[key] = await uploadImage(url, key, ctxEn);
			console.log(`  ✓ ${key}`);
		}

		// ========================================
		// Site Settings (EN)
		// ========================================
		console.log("\nUpdating site settings (EN)...");
		await cms.api.globals.siteSettings.update(
			{
				shopName: "Sharp Cuts",
				tagline: "Precision grooming for modern clients",
				navigation: [
					{ label: "Home", href: "/" },
					{ label: "Services", href: "/services" },
					{ label: "Our Team", href: "/barbers" },
					{ label: "Contact", href: "/contact" },
				],
				ctaButtonText: "Book Now",
				ctaButtonLink: "/booking",
				footerTagline: "Your Style, Our Passion",
				footerLinks: [
					{ label: "Services", href: "/services" },
					{ label: "Our Team", href: "/barbers" },
					{ label: "Contact", href: "/contact" },
					{ label: "Privacy Policy", href: "/privacy" },
				],
				copyrightText: "Sharp Cuts. All rights reserved.",
				contactEmail: "hello@sharpcuts.com",
				contactPhone: "+421 900 000 000",
				address: "Lazaretska 12",
				city: "Bratislava",
				zipCode: "811 09",
				mapEmbedUrl: "https://maps.google.com/maps?q=Bratislava&output=embed",
				isOpen: true,
				bookingEnabled: true,
				metaTitle: "Sharp Cuts - Premium Barbershop",
				metaDescription:
					"Modern barbershop in the heart of the city. Haircuts, beard grooming, and hot towel shaves.",
				socialLinks: [
					{ platform: "instagram", url: "https://instagram.com/sharpcuts" },
					{ platform: "facebook", url: "https://facebook.com/sharpcuts" },
				],
			},
			ctxEn,
		);
		console.log("  ✓ Site settings (EN) updated");

		// ========================================
		// Site Settings (SK)
		// ========================================
		console.log("Updating site settings (SK)...");
		await cms.api.globals.siteSettings.update(
			{
				tagline: "Precízna starostlivosť pre moderných klientov",
				navigation: [
					{ label: "Domov", href: "/" },
					{ label: "Služby", href: "/services" },
					{ label: "Náš tím", href: "/barbers" },
					{ label: "Kontakt", href: "/contact" },
				],
				ctaButtonText: "Rezervovať",
				footerTagline: "Váš štýl, naša vášeň",
				footerLinks: [
					{ label: "Služby", href: "/services" },
					{ label: "Náš tím", href: "/barbers" },
					{ label: "Kontakt", href: "/contact" },
					{ label: "Ochrana súkromia", href: "/privacy" },
				],
				copyrightText: "Sharp Cuts. Všetky práva vyhradené.",
				metaTitle: "Sharp Cuts - Prémiový barbershop",
				metaDescription:
					"Moderný barbershop v srdci mesta. Strihanie, úprava brady a holenie s horúcim uterákom.",
			},
			ctxSk,
		);
		console.log("  ✓ Site settings (SK) updated");

		// ========================================
		// Services (EN)
		// ========================================
		console.log("\nCreating services (EN)...");
		const haircut = await cms.api.collections.services.create(
			{
				name: "Classic Haircut",
				description:
					"Traditional haircut with scissors and clippers. Includes wash and style.",
				price: 3500,
				duration: 45,
				image: images.service1,
				isActive: true,
			},
			ctxEn,
		);
		const fade = await cms.api.collections.services.create(
			{
				name: "Fade Cut",
				description: "Modern fade with sharp edges and a clean finish.",
				price: 4500,
				duration: 50,
				image: images.service2,
				isActive: true,
			},
			ctxEn,
		);
		const shave = await cms.api.collections.services.create(
			{
				name: "Hot Towel Shave",
				description: "Straight razor shave with hot towel and facial massage.",
				price: 4000,
				duration: 40,
				image: images.service3,
				isActive: true,
			},
			ctxEn,
		);
		console.log("  ✓ Services (EN) created");

		// ========================================
		// Services (SK)
		// ========================================
		console.log("Adding Slovak translations for services...");
		await cms.api.collections.services.update(
			{
				where: { id: haircut.id },
				data: {
					name: "Klasický strih",
					description:
						"Tradičný strih s nožnicami a strojčekom. Vrátane umytia a styling.",
				},
			},
			ctxSk,
		);
		await cms.api.collections.services.update(
			{
				where: { id: fade.id },
				data: {
					name: "Fade strih",
					description: "Moderný fade s ostrými hranami a čistým finišom.",
				},
			},
			ctxSk,
		);
		await cms.api.collections.services.update(
			{
				where: { id: shave.id },
				data: {
					name: "Holenie s horúcim uterákom",
					description: "Holenie britovou s horúcim uterákom a masážou tváre.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Services (SK) updated");

		// ========================================
		// Barbers (EN)
		// ========================================
		console.log("\nCreating barbers (EN)...");
		const barber1 = await cms.api.collections.barbers.create(
			{
				name: "Lukas Novak",
				slug: "lukas-novak",
				email: "lukas@sharpcuts.com",
				phone: "+421 900 111 111",
				bio: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "Master barber specializing in classic cuts and hot towel shaves.",
								},
							],
						},
					],
				},
				avatar: images.barber1,
				isActive: true,
				specialties: ["Classic Cuts", "Beard Shaping"],
				workingHours: {
					monday: { isOpen: true, start: "09:00", end: "18:00" },
					tuesday: { isOpen: true, start: "09:00", end: "18:00" },
					wednesday: { isOpen: true, start: "09:00", end: "18:00" },
					thursday: { isOpen: true, start: "09:00", end: "18:00" },
					friday: { isOpen: true, start: "09:00", end: "18:00" },
					saturday: { isOpen: true, start: "10:00", end: "16:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		const barber2 = await cms.api.collections.barbers.create(
			{
				name: "David Horvat",
				slug: "david-horvat",
				email: "david@sharpcuts.com",
				phone: "+421 900 222 222",
				bio: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "Known for sharp fades and modern styling.",
								},
							],
						},
					],
				},
				avatar: images.barber2,
				isActive: true,
				specialties: ["Skin Fades", "Modern Cuts"],
				workingHours: {
					monday: { isOpen: true, start: "11:00", end: "19:00" },
					tuesday: { isOpen: true, start: "11:00", end: "19:00" },
					wednesday: { isOpen: true, start: "11:00", end: "19:00" },
					thursday: { isOpen: true, start: "11:00", end: "19:00" },
					friday: { isOpen: true, start: "11:00", end: "19:00" },
					saturday: { isOpen: true, start: "10:00", end: "15:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		const barber3 = await cms.api.collections.barbers.create(
			{
				name: "Martin Kral",
				slug: "martin-kral",
				email: "martin@sharpcuts.com",
				phone: "+421 900 333 333",
				bio: {
					type: "doc",
					content: [
						{
							type: "paragraph",
							content: [
								{
									type: "text",
									text: "Detail-focused barber with a passion for precision.",
								},
							],
						},
					],
				},
				avatar: images.barber3,
				isActive: true,
				specialties: ["Precision Cuts", "Hot Towel Shave"],
				workingHours: {
					monday: { isOpen: true, start: "08:00", end: "16:00" },
					tuesday: { isOpen: true, start: "08:00", end: "16:00" },
					wednesday: { isOpen: true, start: "08:00", end: "16:00" },
					thursday: { isOpen: true, start: "08:00", end: "16:00" },
					friday: { isOpen: true, start: "08:00", end: "16:00" },
					saturday: { isOpen: false, start: "", end: "" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		console.log("  ✓ Barbers (EN) created");

		// ========================================
		// Barbers (SK)
		// ========================================
		console.log("Adding Slovak translations for barbers...");
		await cms.api.collections.barbers.update(
			{
				where: { id: barber1.id },
				data: {
					bio: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{
										type: "text",
										text: "Majster holič špecializujúci sa na klasické strihy a holenie s horúcim uterákom.",
									},
								],
							},
						],
					},
					specialties: ["Klasické strihy", "Tvarovanie brady"],
				},
			},
			ctxSk,
		);
		await cms.api.collections.barbers.update(
			{
				where: { id: barber2.id },
				data: {
					bio: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{
										type: "text",
										text: "Známy pre ostré fade strihy a moderný styling.",
									},
								],
							},
						],
					},
					specialties: ["Skin Fade", "Moderné strihy"],
				},
			},
			ctxSk,
		);
		await cms.api.collections.barbers.update(
			{
				where: { id: barber3.id },
				data: {
					bio: {
						type: "doc",
						content: [
							{
								type: "paragraph",
								content: [
									{
										type: "text",
										text: "Holič zameraný na detaily s vášňou pre precíznosť.",
									},
								],
							},
						],
					},
					specialties: ["Precízne strihy", "Holenie s horúcim uterákom"],
				},
			},
			ctxSk,
		);
		console.log("  ✓ Barbers (SK) updated");

		// ========================================
		// Barber Services (M:N)
		// ========================================
		console.log("\nLinking barbers and services...");
		await cms.api.collections.barberServices.create(
			{ barber: barber1.id, service: haircut.id },
			ctxEn,
		);
		await cms.api.collections.barberServices.create(
			{ barber: barber1.id, service: shave.id },
			ctxEn,
		);
		await cms.api.collections.barberServices.create(
			{ barber: barber2.id, service: fade.id },
			ctxEn,
		);
		await cms.api.collections.barberServices.create(
			{ barber: barber2.id, service: haircut.id },
			ctxEn,
		);
		await cms.api.collections.barberServices.create(
			{ barber: barber3.id, service: shave.id },
			ctxEn,
		);
		await cms.api.collections.barberServices.create(
			{ barber: barber3.id, service: haircut.id },
			ctxEn,
		);
		console.log("  ✓ Relations created");

		// ========================================
		// Reviews (EN)
		// ========================================
		console.log("\nCreating reviews (EN)...");
		const review1 = await cms.api.collections.reviews.create(
			{
				customerName: "Oliver R.",
				customerEmail: "oliver@example.com",
				barber: barber1.id,
				rating: "5",
				comment:
					"Best haircut I have had in years. Clean, precise, and relaxed.",
				isApproved: true,
				isFeatured: true,
			},
			ctxEn,
		);
		const review2 = await cms.api.collections.reviews.create(
			{
				customerName: "Tomas K.",
				customerEmail: "tomas@example.com",
				barber: barber2.id,
				rating: "5",
				comment: "Sharp fade and great attention to detail. Highly recommend.",
				isApproved: true,
				isFeatured: true,
			},
			ctxEn,
		);
		const review3 = await cms.api.collections.reviews.create(
			{
				customerName: "Peter M.",
				customerEmail: "peter@example.com",
				barber: barber3.id,
				rating: "4",
				comment: "Great service and atmosphere. Will come again.",
				isApproved: true,
				isFeatured: true,
			},
			ctxEn,
		);
		console.log("  ✓ Reviews (EN) created");

		// ========================================
		// Reviews (SK)
		// ========================================
		console.log("Adding Slovak translations for reviews...");
		await cms.api.collections.reviews.update(
			{
				where: { id: review1.id },
				data: {
					comment:
						"Najlepší strih, aký som mal za roky. Čistý, precízny a uvoľnený.",
				},
			},
			ctxSk,
		);
		await cms.api.collections.reviews.update(
			{
				where: { id: review2.id },
				data: {
					comment: "Ostrý fade a skvelé detaily. Vrelo odporúčam.",
				},
			},
			ctxSk,
		);
		await cms.api.collections.reviews.update(
			{
				where: { id: review3.id },
				data: {
					comment: "Skvělý servis a atmosféra. Určite prídem znova.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Reviews (SK) updated");

		// ========================================
		// Pages (EN)
		// ========================================
		console.log("\nCreating pages (EN)...");
		const homePage = await cms.api.collections.pages.create(
			{
				title: "Home",
				slug: "home",
				description: "Premium barbershop experience",
				isPublished: true,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "services-1", type: "services", children: [] },
						{ id: "team-1", type: "team", children: [] },
						{ id: "reviews-1", type: "reviews", children: [] },
						{ id: "cta-1", type: "cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: "Sharp Cuts. Clean Style.",
							subtitle: "Precision grooming in the heart of the city.",
							backgroundImage: images.hero,
							overlayOpacity: 60,
							alignment: "center",
							ctaText: "Book Appointment",
							ctaLink: "/booking",
							height: "large",
						},
						"services-1": {
							title: "Our Services",
							subtitle: "Tailored services for clean, confident looks.",
							showPrices: true,
							showDuration: true,
							columns: "3",
							limit: 6,
						},
						"team-1": {
							title: "Meet Our Team",
							subtitle: "Skilled barbers dedicated to your style.",
							columns: "3",
							limit: 3,
						},
						"reviews-1": {
							title: "What Clients Say",
							subtitle: "Real words from real clients.",
							limit: 6,
						},
						"cta-1": {
							title: "Ready for a Fresh Look?",
							description:
								"Book your appointment today and experience the difference.",
							buttonText: "Book Now",
							buttonLink: "/booking",
							variant: "highlight",
							size: "medium",
						},
					},
				},
				metaTitle: "Sharp Cuts - Premium Barbershop",
				metaDescription:
					"Book your next haircut, fade, or shave with our expert team.",
			},
			ctxEn,
		);
		console.log("  ✓ Home page (EN) created");

		// ========================================
		// Pages (SK)
		// ========================================
		console.log("Adding Slovak translations for pages...");
		console.log("[DEBUG] SK Context locale:", ctxSk.locale);
		console.log("[DEBUG] SK Context defaultLocale:", ctxSk.defaultLocale);
		await cms.api.collections.pages.update(
			{
				where: { id: homePage.id },
				data: {
					title: "Domov",
					description: "Prémiový barbershop zážitok",
					content: {
						_tree: [
							{ id: "hero-1", type: "hero", children: [] },
							{ id: "services-1", type: "services", children: [] },
							{ id: "team-1", type: "team", children: [] },
							{ id: "reviews-1", type: "reviews", children: [] },
							{ id: "cta-1", type: "cta", children: [] },
						],
						_values: {
							"hero-1": {
								title: "Sharp Cuts. Čistý štýl.",
								subtitle: "Precízna starostlivosť v srdci mesta.",
								backgroundImage: images.hero,
								overlayOpacity: 60,
								alignment: "center",
								ctaText: "Rezervovať termín",
								ctaLink: "/booking",
								height: "large",
							},
							"services-1": {
								title: "Naše služby",
								subtitle: "Služby na mieru pre čistý a sebavedomý vzhľad.",
								showPrices: true,
								showDuration: true,
								columns: "3",
								limit: 6,
							},
							"team-1": {
								title: "Náš tím",
								subtitle: "Skúsení holiči oddaní vášmu štýlu.",
								columns: "3",
								limit: 3,
							},
							"reviews-1": {
								title: "Čo hovoria klienti",
								subtitle: "Skutočné slová od skutočných klientov.",
								limit: 6,
							},
							"cta-1": {
								title: "Pripravený na nový vzhľad?",
								description: "Rezervujte si termín ešte dnes a zažite rozdiel.",
								buttonText: "Rezervovať",
								buttonLink: "/booking",
								variant: "highlight",
								size: "medium",
							},
						},
					},
					metaTitle: "Sharp Cuts - Prémiový Barbershop",
					metaDescription:
						"Rezervujte si váš ďalší strih, fade alebo holenie s naším expertným tímom.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Home page (SK) updated");

		// ========================================
		// DEBUG: Verify SK update worked
		// ========================================
		console.log("\n[DEBUG] Verifying SK translations...");
		const skPageVerify = await cms.api.collections.pages.findOne(
			{ where: { slug: "home" } },
			ctxSk,
		);
		console.log(
			"SK hero title:",
			skPageVerify?.content?._values?.["hero-1"]?.title,
		);
		console.log(
			"SK services title:",
			skPageVerify?.content?._values?.["services-1"]?.title,
		);

		const enPageVerify = await cms.api.collections.pages.findOne(
			{ where: { slug: "home" } },
			ctxEn,
		);
		console.log(
			"EN hero title:",
			enPageVerify?.content?._values?.["hero-1"]?.title,
		);
		console.log(
			"EN services title:",
			enPageVerify?.content?._values?.["services-1"]?.title,
		);

		console.log("\n✓ Database seeded successfully!\n");
		process.exit(0);
	} catch (error) {
		console.error("Seeding failed:", error);
		process.exit(1);
	}
}

seed();
