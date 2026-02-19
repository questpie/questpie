/**
 * Database Seeder
 *
 * Seeds the database with demo data for the TanStack barbershop example.
 * Usage: bun run seed.ts
 */

import { app } from "./src/questpie/server/app";

// ============================================================================
// Image URLs
// ============================================================================

const IMAGES = {
	// Heroes
	heroHome:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=1920&h=1080&fit=crop",
	heroServices:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=1920&h=1080&fit=crop",
	heroAbout:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=1920&h=1080&fit=crop",
	heroGallery:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1920&h=1080&fit=crop",

	// Barbers
	barber1:
		"https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop",
	barber2:
		"https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop",
	barber3:
		"https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&h=400&fit=crop",
	barber4:
		"https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop",

	// Services
	serviceHaircut:
		"https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=800&h=600&fit=crop",
	serviceFade:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&h=600&fit=crop",
	serviceShave:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&h=600&fit=crop",
	serviceBeard:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&h=600&fit=crop",
	serviceKids:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&h=600&fit=crop",
	serviceGrooming:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&h=600&fit=crop",

	// About / Image-Text
	shopInterior:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=800&h=800&fit=crop",
	shopDetail:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&h=800&fit=crop",

	// Gallery
	gallery1:
		"https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=600&h=600&fit=crop",
	gallery2:
		"https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=600&h=600&fit=crop",
	gallery3:
		"https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=600&h=600&fit=crop",
	gallery4:
		"https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=600&h=600&fit=crop",
	gallery5:
		"https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?w=600&h=600&fit=crop",
	gallery6:
		"https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=600&h=600&fit=crop",
} as const;

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

function richTextFormatted(
	blocks: Array<
		string | { text: string; bold?: boolean; italic?: boolean; link?: string }[]
	>,
) {
	return {
		type: "doc",
		content: blocks.map((block) => {
			if (typeof block === "string") {
				return {
					type: "paragraph",
					content: [{ type: "text", text: block }],
				};
			}
			return {
				type: "paragraph",
				content: block.map((part) => {
					const marks: Array<{ type: string; attrs?: Record<string, any> }> =
						[];
					if (part.bold) marks.push({ type: "bold" });
					if (part.italic) marks.push({ type: "italic" });
					if (part.link)
						marks.push({
							type: "link",
							attrs: { href: part.link, target: "_blank" },
						});
					return { type: "text", text: part.text, marks };
				}),
			};
		}),
	};
}

// ============================================================================
// Upload Helper
// ============================================================================

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

	const asset = await app.api.collections.assets.upload(file, ctx);
	return asset.id as string;
}

// ============================================================================
// Main Seed
// ============================================================================

async function seed() {
	const force = process.argv.includes("--force");

	console.log("🌱 Seeding database...\n");

	try {
		const ctxEn = await app.createContext({
			accessMode: "system",
			locale: "en",
		});
		const ctxSk = await app.createContext({
			accessMode: "system",
			locale: "sk",
		});

		// ========================================
		// Idempotency check
		// ========================================
		const existing = await app.api.collections.pages.find(
			{ where: { slug: { eq: "home" } }, limit: 1 },
			ctxEn,
		);
		if (existing.totalDocs > 0 && !force) {
			console.log("Database already seeded. Use --force to re-seed.");
			process.exit(0);
		}

		// ========================================
		// Clean existing data
		// ========================================
		console.log("Cleaning existing data...");
		// Delete in FK-safe order: junction tables → dependents → parents → assets
		const cleanupSteps: [string, () => Promise<unknown>][] = [
			[
				"appointments",
				() => app.api.collections.appointments.delete({ where: {} }, ctxEn),
			],
			[
				"barberServices",
				() => app.api.collections.barberServices.delete({ where: {} }, ctxEn),
			],
			[
				"reviews",
				() => app.api.collections.reviews.delete({ where: {} }, ctxEn),
			],
			[
				"barbers",
				() => app.api.collections.barbers.delete({ where: {} }, ctxEn),
			],
			[
				"services",
				() => app.api.collections.services.delete({ where: {} }, ctxEn),
			],
			["pages", () => app.api.collections.pages.delete({ where: {} }, ctxEn)],
			["assets", () => app.api.collections.assets.delete({ where: {} }, ctxEn)],
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

		// ========================================
		// Upload images
		// ========================================
		console.log("Uploading images...");
		const img: Record<string, string> = {};
		for (const [key, url] of Object.entries(IMAGES)) {
			img[key] = await uploadImage(url, key, ctxEn);
			console.log(`  ✓ ${key}`);
		}
		console.log("");

		// ========================================
		// Site Settings (EN)
		// ========================================
		console.log("Updating site settings (EN)...");
		await app.api.globals.siteSettings.update(
			{
				shopName: "Sharp Cuts",
				tagline: "Precision grooming for the modern gentleman",
				navigation: [
					{ label: "Home", href: "/" },
					{ label: "Services", href: "/services" },
					{ label: "About", href: "/about" },
					{ label: "Gallery", href: "/gallery" },
					{ label: "Contact", href: "/contact" },
				],
				ctaButtonText: "Book Now",
				ctaButtonLink: "/booking",
				footerTagline: "Your Style, Our Passion",
				footerLinks: [
					{ label: "Services", href: "/services" },
					{ label: "About Us", href: "/about" },
					{ label: "Gallery", href: "/gallery" },
					{ label: "Contact", href: "/contact" },
					{ label: "Privacy Policy", href: "/privacy" },
				],
				copyrightText: "Sharp Cuts. All rights reserved.",
				contactEmail: "hello@sharpcuts.com",
				contactPhone: "+421 900 000 000",
				address: "Lazaretská 12",
				city: "Bratislava",
				zipCode: "811 09",
				country: "Slovakia",
				mapEmbedUrl: "https://maps.google.com/maps?q=Bratislava&output=embed",
				isOpen: true,
				bookingEnabled: true,
				businessHours: {
					monday: { isOpen: true, start: "09:00", end: "18:00" },
					tuesday: { isOpen: true, start: "09:00", end: "18:00" },
					wednesday: { isOpen: true, start: "09:00", end: "18:00" },
					thursday: { isOpen: true, start: "09:00", end: "20:00" },
					friday: { isOpen: true, start: "09:00", end: "20:00" },
					saturday: { isOpen: true, start: "10:00", end: "16:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
				metaTitle: "Sharp Cuts - Premium Barbershop in Bratislava",
				metaDescription:
					"Modern barbershop in the heart of Bratislava. Haircuts, beard grooming, hot towel shaves, and more.",
				socialLinks: [
					{ platform: "instagram", url: "https://instagram.com/sharpcuts" },
					{ platform: "facebook", url: "https://facebook.com/sharpcuts" },
					{ platform: "tiktok", url: "https://tiktok.com/@sharpcuts" },
				],
			},
			ctxEn,
		);
		console.log("  ✓ Site settings (EN)");

		// ========================================
		// Site Settings (SK)
		// ========================================
		console.log("Updating site settings (SK)...");
		await app.api.globals.siteSettings.update(
			{
				tagline: "Precízna starostlivosť pre moderného gentlemana",
				navigation: [
					{ label: "Domov", href: "/" },
					{ label: "Služby", href: "/services" },
					{ label: "O nás", href: "/about" },
					{ label: "Galéria", href: "/gallery" },
					{ label: "Kontakt", href: "/contact" },
				],
				ctaButtonText: "Rezervovať",
				footerTagline: "Váš štýl, naša vášeň",
				footerLinks: [
					{ label: "Služby", href: "/services" },
					{ label: "O nás", href: "/about" },
					{ label: "Galéria", href: "/gallery" },
					{ label: "Kontakt", href: "/contact" },
					{ label: "Ochrana súkromia", href: "/privacy" },
				],
				copyrightText: "Sharp Cuts. Všetky práva vyhradené.",
				metaTitle: "Sharp Cuts - Prémiový barbershop v Bratislave",
				metaDescription:
					"Moderný barbershop v srdci Bratislavy. Strihanie, úprava brady, holenie s horúcim uterákom a viac.",
			},
			ctxSk,
		);
		console.log("  ✓ Site settings (SK)\n");

		// ========================================
		// Services (EN + SK)
		// ========================================
		console.log("Creating services...");
		const haircut = await app.api.collections.services.create(
			{
				name: "Classic Haircut",
				description:
					"Traditional haircut with scissors and clippers. Includes wash, cut, and style.",
				price: 3500,
				duration: 45,
				image: img.serviceHaircut,
				isActive: true,
			},
			ctxEn,
		);
		const fade = await app.api.collections.services.create(
			{
				name: "Skin Fade",
				description:
					"Modern skin fade with razor-sharp lines and a seamless blend.",
				price: 4500,
				duration: 50,
				image: img.serviceFade,
				isActive: true,
			},
			ctxEn,
		);
		const shave = await app.api.collections.services.create(
			{
				name: "Hot Towel Shave",
				description:
					"Straight razor shave with steamed towels, pre-shave oil, and moisturizer.",
				price: 4000,
				duration: 40,
				image: img.serviceShave,
				isActive: true,
			},
			ctxEn,
		);
		const beardTrim = await app.api.collections.services.create(
			{
				name: "Beard Sculpting",
				description:
					"Precision beard shaping with hot towel treatment and beard oil finish.",
				price: 3000,
				duration: 30,
				image: img.serviceBeard,
				isActive: true,
			},
			ctxEn,
		);
		const kidscut = await app.api.collections.services.create(
			{
				name: "Junior Cut",
				description:
					"Haircut for kids under 12. Patient service in a relaxed atmosphere.",
				price: 2500,
				duration: 30,
				image: img.serviceKids,
				isActive: true,
			},
			ctxEn,
		);
		const grooming = await app.api.collections.services.create(
			{
				name: "Full Grooming Package",
				description:
					"The complete experience: haircut, beard sculpting, hot towel shave, and facial treatment.",
				price: 8500,
				duration: 90,
				image: img.serviceGrooming,
				isActive: true,
			},
			ctxEn,
		);
		console.log("  ✓ 6 services (EN)");

		// SK translations
		await app.api.collections.services.update(
			{
				where: { id: haircut.id },
				data: {
					name: "Klasický strih",
					description:
						"Tradičný strih nožnicami a strojčekom. Zahŕňa umytie, strih a styling.",
				},
			},
			ctxSk,
		);
		await app.api.collections.services.update(
			{
				where: { id: fade.id },
				data: {
					name: "Skin Fade",
					description:
						"Moderný skin fade s ostrou líniou a plynulým prechodom.",
				},
			},
			ctxSk,
		);
		await app.api.collections.services.update(
			{
				where: { id: shave.id },
				data: {
					name: "Holenie s horúcim uterákom",
					description:
						"Holenie britvou s parenými uterákmi, prípravným olejom a hydratáciou.",
				},
			},
			ctxSk,
		);
		await app.api.collections.services.update(
			{
				where: { id: beardTrim.id },
				data: {
					name: "Tvarovanie brady",
					description:
						"Precízne tvarovanie brady s horúcim uterákom a finálnym olejom na bradu.",
				},
			},
			ctxSk,
		);
		await app.api.collections.services.update(
			{
				where: { id: kidscut.id },
				data: {
					name: "Detský strih",
					description:
						"Strih pre deti do 12 rokov. Trpezlivý prístup v uvoľnenej atmosfére.",
				},
			},
			ctxSk,
		);
		await app.api.collections.services.update(
			{
				where: { id: grooming.id },
				data: {
					name: "Kompletný balíček",
					description:
						"Kompletný zážitok: strih, tvarovanie brady, holenie s horúcim uterákom a ošetrenie tváre.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ 6 services (SK)\n");

		// ========================================
		// Barbers (EN + SK)
		// ========================================
		console.log("Creating barbers...");
		const barber1 = await app.api.collections.barbers.create(
			{
				name: "Lukáš Novák",
				slug: "lukas-novak",
				email: "lukas@sharpcuts.com",
				phone: "+421 900 111 111",
				bio: richText([
					"Master barber with over 10 years of experience in classic and modern techniques.",
					"Lukáš trained in London and Vienna before opening Sharp Cuts. His specialties include precision scissor work and traditional hot towel shaves. Known for his calm, focused approach — every client leaves feeling their best.",
				]),
				avatar: img.barber1,
				isActive: true,
				specialties: ["Classic Cuts", "Hot Towel Shave", "Beard Sculpting"],
				workingHours: {
					monday: { isOpen: true, start: "09:00", end: "18:00" },
					tuesday: { isOpen: true, start: "09:00", end: "18:00" },
					wednesday: { isOpen: true, start: "09:00", end: "18:00" },
					thursday: { isOpen: true, start: "09:00", end: "20:00" },
					friday: { isOpen: true, start: "09:00", end: "20:00" },
					saturday: { isOpen: true, start: "10:00", end: "16:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		const barber2 = await app.api.collections.barbers.create(
			{
				name: "David Horváth",
				slug: "david-horvath",
				email: "david@sharpcuts.com",
				phone: "+421 900 222 222",
				bio: richText([
					"Creative stylist with a passion for skin fades and modern textures.",
					"David is the go-to barber for sharp, contemporary looks. He stays on top of global trends and brings them to Bratislava. His Instagram-worthy fades have earned him a loyal following among younger clients.",
				]),
				avatar: img.barber2,
				isActive: true,
				specialties: ["Skin Fades", "Modern Textures", "Hair Design"],
				workingHours: {
					monday: { isOpen: true, start: "11:00", end: "19:00" },
					tuesday: { isOpen: true, start: "11:00", end: "19:00" },
					wednesday: { isOpen: true, start: "11:00", end: "19:00" },
					thursday: { isOpen: true, start: "11:00", end: "21:00" },
					friday: { isOpen: true, start: "11:00", end: "21:00" },
					saturday: { isOpen: true, start: "10:00", end: "16:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		const barber3 = await app.api.collections.barbers.create(
			{
				name: "Martin Kráľ",
				slug: "martin-kral",
				email: "martin@sharpcuts.com",
				phone: "+421 900 333 333",
				bio: richText([
					"Detail-oriented barber who believes every cut tells a story.",
					"Martin brings a meticulous eye and steady hand to every appointment. Before barbering, he studied fine art — and it shows in his precise lines and thoughtful approach to each client's unique features.",
				]),
				avatar: img.barber3,
				isActive: true,
				specialties: ["Precision Cuts", "Beard Detailing", "Grooming Packages"],
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
		const barber4 = await app.api.collections.barbers.create(
			{
				name: "Tomáš Sedlák",
				slug: "tomas-sedlak",
				email: "tomas@sharpcuts.com",
				phone: "+421 900 444 444",
				bio: richText([
					"The youngest member of the team with fresh ideas and endless energy.",
					"Tomáš joined Sharp Cuts straight from barber academy and quickly proved himself. He's great with kids and nervous first-timers, creating a relaxed vibe that makes everyone feel welcome.",
				]),
				avatar: img.barber4,
				isActive: true,
				specialties: ["Junior Cuts", "Fades", "First-Timer Friendly"],
				workingHours: {
					monday: { isOpen: true, start: "10:00", end: "18:00" },
					tuesday: { isOpen: true, start: "10:00", end: "18:00" },
					wednesday: { isOpen: false, start: "", end: "" },
					thursday: { isOpen: true, start: "10:00", end: "18:00" },
					friday: { isOpen: true, start: "10:00", end: "20:00" },
					saturday: { isOpen: true, start: "09:00", end: "15:00" },
					sunday: { isOpen: false, start: "", end: "" },
				},
			},
			ctxEn,
		);
		console.log("  ✓ 4 barbers (EN)");

		// SK translations for barbers
		await app.api.collections.barbers.update(
			{
				where: { id: barber1.id },
				data: {
					bio: richText([
						"Majster holič s viac ako 10-ročnými skúsenosťami v klasických aj moderných technikách.",
						"Lukáš sa školil v Londýne a Viedni predtým, než otvoril Sharp Cuts. Jeho špecialitou sú precízne nožnicové strihy a tradičné holenie s horúcim uterákom.",
					]),
					specialties: [
						"Klasické strihy",
						"Holenie s horúcim uterákom",
						"Tvarovanie brady",
					],
				},
			},
			ctxSk,
		);
		await app.api.collections.barbers.update(
			{
				where: { id: barber2.id },
				data: {
					bio: richText([
						"Kreatívny stylista s vášňou pre skin fade a moderné textúry.",
						"David je holič prvej voľby pre ostré, súčasné strihy. Sleduje globálne trendy a prináša ich do Bratislavy.",
					]),
					specialties: ["Skin Fade", "Moderné textúry", "Dizajn vlasov"],
				},
			},
			ctxSk,
		);
		await app.api.collections.barbers.update(
			{
				where: { id: barber3.id },
				data: {
					bio: richText([
						"Holič zameraný na detaily, ktorý verí, že každý strih rozpráva príbeh.",
						"Martin prináša precízne oko a stabilnú ruku ku každému termínu. Pred holením študoval výtvarné umenie — a je to vidieť.",
					]),
					specialties: [
						"Precízne strihy",
						"Detailná úprava brady",
						"Kompletné balíčky",
					],
				},
			},
			ctxSk,
		);
		await app.api.collections.barbers.update(
			{
				where: { id: barber4.id },
				data: {
					bio: richText([
						"Najmladší člen tímu s čerstvými nápadmi a nekonečnou energiou.",
						"Tomáš nastúpil do Sharp Cuts priamo z akadémie a rýchlo sa osvedčil. Je skvelý s deťmi a nervóznymi nováčikmi.",
					]),
					specialties: [
						"Detské strihy",
						"Fade strihy",
						"Ideálny pre prvé návštevy",
					],
				},
			},
			ctxSk,
		);
		console.log("  ✓ 4 barbers (SK)\n");

		// ========================================
		// Barber ↔ Service links
		// ========================================
		console.log("Linking barbers and services...");
		const links = [
			[barber1, [haircut, shave, beardTrim, grooming]],
			[barber2, [fade, haircut, beardTrim]],
			[barber3, [haircut, shave, beardTrim, grooming]],
			[barber4, [haircut, fade, kidscut]],
		] as const;
		for (const [barber, services] of links) {
			for (const service of services) {
				await app.api.collections.barberServices.create(
					{ barber: barber.id, service: service.id },
					ctxEn,
				);
			}
		}
		console.log("  ✓ Relations created\n");

		// ========================================
		// Reviews (EN + SK)
		// ========================================
		console.log("Creating reviews...");
		const reviewsData = [
			{
				en: {
					customerName: "Oliver R.",
					customerEmail: "oliver@example.com",
					barber: barber1.id,
					rating: "5",
					comment:
						"Best haircut I've had in years. Lukáš is a true craftsman — precise, patient, and the hot towel shave was incredible.",
					isApproved: true,
					isFeatured: true,
				},
				sk: {
					comment:
						"Najlepší strih za dlhé roky. Lukáš je ozajstný majster — precízny, trpezlivý a holenie s horúcim uterákom bolo neuveriteľné.",
				},
			},
			{
				en: {
					customerName: "Tomáš K.",
					customerEmail: "tomas@example.com",
					barber: barber2.id,
					rating: "5",
					comment:
						"David's fade work is on another level. Sharp lines, perfect blend. I get compliments every time I walk out of here.",
					isApproved: true,
					isFeatured: true,
				},
				sk: {
					comment:
						"Davidove fade strihy sú z iného sveta. Ostré línie, perfektný prechod. Zakaždým dostanem komplimenty.",
				},
			},
			{
				en: {
					customerName: "Peter M.",
					customerEmail: "peter@example.com",
					barber: barber3.id,
					rating: "5",
					comment:
						"Martin treats every appointment like an art project. Attention to detail is unmatched. Highly recommend the grooming package.",
					isApproved: true,
					isFeatured: true,
				},
				sk: {
					comment:
						"Martin pristupuje ku každému termínu ako k umeleckému projektu. Pozornosť k detailom je neprekonateľná.",
				},
			},
			{
				en: {
					customerName: "Marek S.",
					customerEmail: "marek@example.com",
					barber: barber4.id,
					rating: "5",
					comment:
						"Brought my 8-year-old son here for the first time. Tomáš was so patient and fun — my kid actually wants to come back!",
					isApproved: true,
					isFeatured: true,
				},
				sk: {
					comment:
						"Priviedol som svojho 8-ročného syna prvýkrát. Tomáš bol trpezlivý a zábavný — syn sa chce vrátiť!",
				},
			},
			{
				en: {
					customerName: "Jana V.",
					customerEmail: "jana@example.com",
					barber: barber1.id,
					rating: "4",
					comment:
						"Came in for a quick trim and got an amazing experience. Great atmosphere, friendly staff, and solid work. Only minus — hard to get a Saturday slot!",
					isApproved: true,
					isFeatured: false,
				},
				sk: {
					comment:
						"Prišla som na rýchly strih a zažila skvelý zážitok. Super atmosféra, priateľský personál. Jediné mínus — ťažko sa dostať v sobotu!",
				},
			},
			{
				en: {
					customerName: "Andrej N.",
					customerEmail: "andrej@example.com",
					barber: barber2.id,
					rating: "5",
					comment:
						"I've been to barbershops all over Europe and Sharp Cuts is easily in my top 3. David understood exactly what I wanted without me saying much.",
					isApproved: true,
					isFeatured: true,
				},
				sk: {
					comment:
						"Bol som v barbershopoch po celej Európe a Sharp Cuts je ľahko v mojom top 3. David presne pochopil, čo chcem.",
				},
			},
		];

		const reviewIds: string[] = [];
		for (const r of reviewsData) {
			const review = await app.api.collections.reviews.create(r.en, ctxEn);
			reviewIds.push(review.id);
			await app.api.collections.reviews.update(
				{ where: { id: review.id }, data: r.sk },
				ctxSk,
			);
		}
		console.log(`  ✓ ${reviewsData.length} reviews (EN + SK)\n`);

		// ========================================
		// PAGES
		// ========================================
		console.log("Creating pages...");

		// ── HOME PAGE ──────────────────────────────────────────────────────────

		const homePage = await app.api.collections.pages.create(
			{
				title: "Home",
				slug: "home",
				description: "Premium barbershop experience in the heart of the city",
				isPublished: true,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{ id: "services-1", type: "services", children: [] },
						{ id: "divider-1", type: "divider", children: [] },
						{
							id: "image-text-1",
							type: "image-text",
							children: [],
						},
						{ id: "spacer-2", type: "spacer", children: [] },
						{ id: "team-1", type: "team", children: [] },
						{ id: "stats-1", type: "stats", children: [] },
						{ id: "reviews-1", type: "reviews", children: [] },
						{ id: "cta-1", type: "cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: "Sharp Cuts. Clean Style.",
							subtitle:
								"Precision grooming in the heart of Bratislava. Walk-ins welcome, appointments preferred.",
							backgroundImage: img.heroHome,
							overlayOpacity: 55,
							alignment: "center",
							ctaText: "Book Your Appointment",
							ctaLink: "/booking",
							height: "large",
						},
						"spacer-1": { size: "medium" },
						"services-1": {
							title: "Our Services",
							subtitle:
								"From classic cuts to full grooming packages — we've got you covered.",
							mode: "auto",
							showPrices: true,
							showDuration: true,
							columns: "3",
							limit: 6,
						},
						"divider-1": { style: "solid", width: "medium" },
						"image-text-1": {
							image: img.shopInterior,
							imagePosition: "left",
							title: "More Than a Haircut",
							content: richTextFormatted([
								"At Sharp Cuts, we believe grooming is a ritual, not a chore. Our shop is designed to be a place where you can slow down, relax, and leave looking and feeling your absolute best.",
								[
									{ text: "Every service comes with a ", bold: false },
									{ text: "complimentary drink", bold: true },
									{
										text: " — espresso, craft beer, or whisky on the rocks. Because the details matter.",
										bold: false,
									},
								],
							]),
							ctaText: "Learn More",
							ctaLink: "/about",
							imageAspect: "square",
						},
						"spacer-2": { size: "small" },
						"team-1": {
							title: "Meet the Team",
							subtitle:
								"Four skilled barbers, each bringing their own style and expertise.",
							mode: "auto",
							columns: "4",
							limit: 4,
						},
						"stats-1": {
							title: "Sharp Cuts in Numbers",
							stats: [
								{
									value: "10,000+",
									label: "Haircuts",
									description: "Happy clients and counting",
								},
								{
									value: "4",
									label: "Expert Barbers",
									description: "Each with unique specialties",
								},
								{
									value: "10+",
									label: "Years",
									description: "Of experience combined",
								},
								{
									value: "4.9★",
									label: "Rating",
									description: "Based on 500+ reviews",
								},
							],
							columns: "4",
						},
						"reviews-1": {
							title: "What Our Clients Say",
							subtitle:
								"Don't take our word for it — hear from the people who sit in our chairs.",
							filter: "featured",
							limit: 3,
							columns: "3",
						},
						"cta-1": {
							title: "Ready for a Fresh Look?",
							description:
								"Book your appointment today. Walk-ins are welcome, but appointments guarantee your spot.",
							buttonText: "Book Now",
							buttonLink: "/booking",
							variant: "highlight",
							size: "large",
						},
					},
				},
				metaTitle: "Sharp Cuts - Premium Barbershop in Bratislava",
				metaDescription:
					"Book your next haircut, fade, or shave with our expert barbers. Walk-ins welcome.",
			},
			ctxEn,
		);

		// Home page SK
		await app.api.collections.pages.update(
			{
				where: { id: homePage.id },
				data: {
					title: "Domov",
					description: "Prémiový barbershop zážitok v srdci mesta",
					content: {
						_tree: [
							{ id: "hero-1", type: "hero", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{ id: "services-1", type: "services", children: [] },
							{ id: "divider-1", type: "divider", children: [] },
							{ id: "image-text-1", type: "image-text", children: [] },
							{ id: "spacer-2", type: "spacer", children: [] },
							{ id: "team-1", type: "team", children: [] },
							{ id: "stats-1", type: "stats", children: [] },
							{ id: "reviews-1", type: "reviews", children: [] },
							{ id: "cta-1", type: "cta", children: [] },
						],
						_values: {
							"hero-1": {
								title: "Sharp Cuts. Čistý štýl.",
								subtitle:
									"Precízna starostlivosť v srdci Bratislavy. Vitajte aj bez rezervácie.",
								backgroundImage: img.heroHome,
								overlayOpacity: 55,
								alignment: "center",
								ctaText: "Rezervovať termín",
								ctaLink: "/booking",
								height: "large",
							},
							"spacer-1": { size: "medium" },
							"services-1": {
								title: "Naše služby",
								subtitle:
									"Od klasických strihov po kompletné balíčky — postaráme sa o vás.",
								mode: "auto",
								showPrices: true,
								showDuration: true,
								columns: "3",
								limit: 6,
							},
							"divider-1": { style: "solid", width: "medium" },
							"image-text-1": {
								image: img.shopInterior,
								imagePosition: "left",
								title: "Viac než strih",
								content: richTextFormatted([
									"V Sharp Cuts veríme, že starostlivosť je rituál, nie povinnosť. Náš priestor je navrhnutý tak, aby ste si oddýchli a odišli s pocitom, že vyzeráte skvelo.",
									[
										{ text: "Ku každej službe ", bold: false },
										{ text: "nápoj zdarma", bold: true },
										{
											text: " — espresso, craft pivo alebo whisky. Pretože na detailoch záleží.",
											bold: false,
										},
									],
								]),
								ctaText: "Zistiť viac",
								ctaLink: "/about",
								imageAspect: "square",
							},
							"spacer-2": { size: "small" },
							"team-1": {
								title: "Náš tím",
								subtitle:
									"Štyria skúsení holiči, každý s vlastným štýlom a špecializáciou.",
								mode: "auto",
								columns: "4",
								limit: 4,
							},
							"stats-1": {
								title: "Sharp Cuts v číslach",
								stats: [
									{
										value: "10 000+",
										label: "Strihov",
										description: "Spokojných klientov a pribúda",
									},
									{
										value: "4",
										label: "Holiči",
										description: "Každý s unikátnymi špecialitami",
									},
									{
										value: "10+",
										label: "Rokov",
										description: "Kombinovaných skúseností",
									},
									{
										value: "4.9★",
										label: "Hodnotenie",
										description: "Na základe 500+ recenzií",
									},
								],
								columns: "4",
							},
							"reviews-1": {
								title: "Čo hovoria klienti",
								subtitle:
									"Neverte len nám — počúvajte tých, čo sedia v našich kreslách.",
								filter: "featured",
								limit: 3,
								columns: "3",
							},
							"cta-1": {
								title: "Pripravený na zmenu?",
								description:
									"Rezervujte si termín ešte dnes. Prijímame aj bez rezervácie, ale termín vám garantuje miesto.",
								buttonText: "Rezervovať",
								buttonLink: "/booking",
								variant: "highlight",
								size: "large",
							},
						},
					},
					metaTitle: "Sharp Cuts - Prémiový barbershop v Bratislave",
					metaDescription:
						"Rezervujte si strih, fade alebo holenie u našich expertných holičov.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Home page (EN + SK)");

		// ── SERVICES PAGE ──────────────────────────────────────────────────────

		const servicesPage = await app.api.collections.pages.create(
			{
				title: "Services",
				slug: "services",
				description: "All our services and pricing",
				isPublished: true,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "services-1", type: "services", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{ id: "heading-1", type: "heading", children: [] },
						{
							id: "services-2",
							type: "services",
							children: [],
						},
						{ id: "spacer-2", type: "spacer", children: [] },
						{ id: "image-text-1", type: "image-text", children: [] },
						{ id: "booking-cta-1", type: "booking-cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: "Our Services",
							subtitle:
								"Quality grooming tailored to your style. Every service includes a complimentary drink.",
							backgroundImage: img.heroServices,
							overlayOpacity: 60,
							alignment: "center",
							height: "medium",
						},
						"services-1": {
							title: "Full Service Menu",
							subtitle:
								"Choose from our range of professional grooming services.",
							mode: "auto",
							showPrices: true,
							showDuration: true,
							columns: "3",
							limit: 6,
						},
						"spacer-1": { size: "large" },
						"heading-1": {
							text: "Most Popular",
							level: "h2",
							align: "center",
							padding: "small",
						},
						"services-2": {
							title: "",
							subtitle:
								"Our clients' favorites — tried, tested, and always requested.",
							mode: "manual",
							services: [haircut.id, fade.id, grooming.id],
							showPrices: true,
							showDuration: true,
							columns: "3",
						},
						"spacer-2": { size: "medium" },
						"image-text-1": {
							image: img.shopDetail,
							imagePosition: "right",
							title: "The Full Grooming Experience",
							content: richText([
								"Our signature package combines a haircut, beard sculpting, hot towel shave, and facial treatment into one 90-minute session.",
								"It's the perfect way to reset — whether before a big event or just because you deserve it. Includes premium products from our curated collection.",
							]),
							ctaText: "Book the Package",
							ctaLink: "/booking",
							imageAspect: "portrait",
						},
						"booking-cta-1": {
							title: "Know What You Want?",
							description:
								"Skip the browsing and book directly. Choose your service, pick a barber, and select your time.",
							buttonText: "Book Appointment",
							variant: "highlight",
							size: "lg",
						},
					},
				},
				metaTitle: "Services & Pricing - Sharp Cuts Barbershop",
				metaDescription:
					"View our full menu of barbershop services, from classic haircuts to premium grooming packages.",
			},
			ctxEn,
		);

		// Services page SK
		await app.api.collections.pages.update(
			{
				where: { id: servicesPage.id },
				data: {
					title: "Služby",
					description: "Všetky naše služby a cenník",
					content: {
						_tree: [
							{ id: "hero-1", type: "hero", children: [] },
							{ id: "services-1", type: "services", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{ id: "heading-1", type: "heading", children: [] },
							{
								id: "services-2",
								type: "services",
								children: [],
							},
							{ id: "spacer-2", type: "spacer", children: [] },
							{ id: "image-text-1", type: "image-text", children: [] },
							{ id: "booking-cta-1", type: "booking-cta", children: [] },
						],
						_values: {
							"hero-1": {
								title: "Naše služby",
								subtitle:
									"Kvalitná starostlivosť prispôsobená vášmu štýlu. Ku každej službe nápoj zdarma.",
								backgroundImage: img.heroServices,
								overlayOpacity: 60,
								alignment: "center",
								height: "medium",
							},
							"services-1": {
								title: "Kompletný cenník",
								subtitle: "Vyberte si z našej ponuky profesionálnych služieb.",
								mode: "auto",
								showPrices: true,
								showDuration: true,
								columns: "3",
								limit: 6,
							},
							"spacer-1": { size: "large" },
							"heading-1": {
								text: "Najpopulárnejšie",
								level: "h2",
								align: "center",
								padding: "small",
							},
							"services-2": {
								title: "",
								subtitle: "Obľúbené u klientov — overené a vždy žiadané.",
								mode: "manual",
								services: [haircut.id, fade.id, grooming.id],
								showPrices: true,
								showDuration: true,
								columns: "3",
							},
							"spacer-2": { size: "medium" },
							"image-text-1": {
								image: img.shopDetail,
								imagePosition: "right",
								title: "Kompletný zážitok",
								content: richText([
									"Náš prémiový balíček kombinuje strih, tvarovanie brady, holenie s horúcim uterákom a ošetrenie tváre do jednej 90-minútovej relácie.",
									"Je to ideálny spôsob, ako sa zresetovať. Zahŕňa prémiové produkty z našej zbierky.",
								]),
								ctaText: "Rezervovať balíček",
								ctaLink: "/booking",
								imageAspect: "portrait",
							},
							"booking-cta-1": {
								title: "Viete, čo chcete?",
								description:
									"Preskočte prezeranie a rezervujte priamo. Vyberte službu, holiča a čas.",
								buttonText: "Rezervovať termín",
								variant: "highlight",
								size: "lg",
							},
						},
					},
					metaTitle: "Služby a cenník - Sharp Cuts Barbershop",
					metaDescription:
						"Pozrite si náš kompletný cenník — od klasických strihov po prémiové balíčky.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Services page (EN + SK)");

		// ── ABOUT PAGE ─────────────────────────────────────────────────────────

		const aboutPage = await app.api.collections.pages.create(
			{
				title: "About Us",
				slug: "about",
				description: "Our story and philosophy",
				isPublished: true,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "image-text-1", type: "image-text", children: [] },
						{ id: "divider-1", type: "divider", children: [] },
						{ id: "image-text-2", type: "image-text", children: [] },
						{ id: "stats-1", type: "stats", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{
							id: "team-1",
							type: "team",
							children: [],
						},
						{ id: "reviews-1", type: "reviews", children: [] },
						{ id: "cta-1", type: "cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: "Our Story",
							subtitle:
								"From a single chair in a garage to the city's favorite barbershop.",
							backgroundImage: img.heroAbout,
							overlayOpacity: 65,
							alignment: "center",
							height: "medium",
						},
						"image-text-1": {
							image: img.shopInterior,
							imagePosition: "left",
							title: "Started With a Vision",
							content: richTextFormatted([
								"Sharp Cuts was founded in 2018 by Lukáš Novák, who believed Bratislava deserved a barbershop that combined old-school craftsmanship with modern sensibility.",
								[
									{ text: "What started as a ", bold: false },
									{ text: "one-chair operation", bold: true },
									{
										text: " in a converted garage has grown into a four-chair shop in the heart of the city. But the philosophy hasn't changed: ",
										bold: false,
									},
									{
										text: "every client deserves undivided attention and exceptional work.",
										italic: true,
									},
								],
							]),
							imageAspect: "square",
						},
						"divider-1": { style: "solid", width: "medium" },
						"image-text-2": {
							image: img.shopDetail,
							imagePosition: "right",
							title: "What Sets Us Apart",
							content: richText([
								"We don't rush. Every appointment gets its full time — no double-booking, no cutting corners. We use premium products, maintain the highest hygiene standards, and invest in continuous training.",
								"Our space is designed to feel like a retreat. Leather chairs, warm wood, good music, and complimentary drinks. It's not just a haircut — it's your time.",
							]),
							imageAspect: "landscape",
						},
						"stats-1": {
							title: "",
							stats: [
								{
									value: "2018",
									label: "Founded",
									description: "Started with a dream and a chair",
								},
								{
									value: "4",
									label: "Barbers",
									description: "Each handpicked for their craft",
								},
								{
									value: "10,000+",
									label: "Clients Served",
									description: "And growing every month",
								},
								{
									value: "98%",
									label: "Return Rate",
									description: "Clients who come back",
								},
							],
							columns: "4",
						},
						"spacer-1": { size: "medium" },
						"team-1": {
							title: "The Team Behind the Chairs",
							subtitle:
								"Four barbers, four different styles — but one shared commitment to quality.",
							mode: "manual",
							barbers: [barber1.id, barber2.id, barber3.id, barber4.id],
							columns: "4",
							showBio: true,
						},
						"reviews-1": {
							title: "What People Are Saying",
							subtitle: "",
							filter: "featured",
							limit: 4,
							columns: "2",
						},
						"cta-1": {
							title: "Come See for Yourself",
							description:
								"We're on Lazaretská 12, Bratislava. Drop by for a visit or book your first appointment online.",
							buttonText: "Book Now",
							buttonLink: "/booking",
							variant: "dark",
							size: "medium",
						},
					},
				},
				metaTitle: "About Sharp Cuts - Our Story",
				metaDescription:
					"Learn about Sharp Cuts — Bratislava's premier barbershop, our philosophy, and the team behind the chairs.",
			},
			ctxEn,
		);

		// About page SK
		await app.api.collections.pages.update(
			{
				where: { id: aboutPage.id },
				data: {
					title: "O nás",
					description: "Náš príbeh a filozofia",
					content: {
						_tree: [
							{ id: "hero-1", type: "hero", children: [] },
							{ id: "image-text-1", type: "image-text", children: [] },
							{ id: "divider-1", type: "divider", children: [] },
							{ id: "image-text-2", type: "image-text", children: [] },
							{ id: "stats-1", type: "stats", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{
								id: "team-1",
								type: "team",
								children: [],
							},
							{ id: "reviews-1", type: "reviews", children: [] },
							{ id: "cta-1", type: "cta", children: [] },
						],
						_values: {
							"hero-1": {
								title: "Náš príbeh",
								subtitle:
									"Od jedného kresla v garáži po obľúbený barbershop v meste.",
								backgroundImage: img.heroAbout,
								overlayOpacity: 65,
								alignment: "center",
								height: "medium",
							},
							"image-text-1": {
								image: img.shopInterior,
								imagePosition: "left",
								title: "Začalo to víziou",
								content: richText([
									"Sharp Cuts založil v roku 2018 Lukáš Novák, ktorý veril, že Bratislava si zaslúži barbershop spájajúci tradičné remeslo s moderným cítením.",
									"To, čo začalo ako prevádzka s jedným kreslom v garáži, vyrástlo na štvorkreslový salón v srdci mesta. Filozofia sa však nezmenila: každý klient si zaslúži plnú pozornosť.",
								]),
								imageAspect: "square",
							},
							"divider-1": { style: "solid", width: "medium" },
							"image-text-2": {
								image: img.shopDetail,
								imagePosition: "right",
								title: "Čo nás odlišuje",
								content: richText([
									"Neponáhľame sa. Každý termín dostane plný čas — žiadne dvojité rezervácie. Používame prémiové produkty a investujeme do neustáleho vzdelávania.",
									"Náš priestor je navrhnutý ako úkryt. Kožené kreslá, teplé drevo, dobrá hudba a nápoj zdarma. Nie je to len strih — je to váš čas.",
								]),
								imageAspect: "landscape",
							},
							"stats-1": {
								title: "",
								stats: [
									{
										value: "2018",
										label: "Založené",
										description: "Začalo to snom a jedným kreslom",
									},
									{
										value: "4",
										label: "Holiči",
										description: "Každý vybraný pre svoje remeslo",
									},
									{
										value: "10 000+",
										label: "Obslúžených",
										description: "A každý mesiac viac",
									},
									{
										value: "98%",
										label: "Návratnosť",
										description: "Klientov, ktorí sa vracajú",
									},
								],
								columns: "4",
							},
							"spacer-1": { size: "medium" },
							"team-1": {
								title: "Tím za kreslami",
								subtitle:
									"Štyria holiči, štyri štýly — ale spoločný záväzok ku kvalite.",
								mode: "manual",
								barbers: [barber1.id, barber2.id, barber3.id, barber4.id],
								columns: "4",
								showBio: true,
							},
							"reviews-1": {
								title: "Čo hovoria ľudia",
								subtitle: "",
								filter: "featured",
								limit: 4,
								columns: "2",
							},
							"cta-1": {
								title: "Príďte sa presvedčiť",
								description:
									"Nájdete nás na Lazaretskej 12, Bratislava. Zastavte sa alebo si rezervujte prvý termín online.",
								buttonText: "Rezervovať",
								buttonLink: "/booking",
								variant: "dark",
								size: "medium",
							},
						},
					},
					metaTitle: "O Sharp Cuts - Náš príbeh",
					metaDescription:
						"Spoznajte Sharp Cuts — prémiový barbershop v Bratislave, našu filozofiu a tím.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ About page (EN + SK)");

		// ── GALLERY PAGE ───────────────────────────────────────────────────────

		const galleryPage = await app.api.collections.pages.create(
			{
				title: "Gallery",
				slug: "gallery",
				description: "See our work",
				isPublished: true,
				content: {
					_tree: [
						{ id: "hero-1", type: "hero", children: [] },
						{ id: "heading-1", type: "heading", children: [] },
						{ id: "gallery-1", type: "gallery", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{ id: "heading-2", type: "heading", children: [] },
						{ id: "text-1", type: "text", children: [] },
						{ id: "gallery-2", type: "gallery", children: [] },
						{ id: "booking-cta-1", type: "booking-cta", children: [] },
					],
					_values: {
						"hero-1": {
							title: "Our Work",
							subtitle: "Every cut is a craft. Every client is a canvas.",
							backgroundImage: img.heroGallery,
							overlayOpacity: 60,
							alignment: "center",
							height: "small",
						},
						"heading-1": {
							text: "Recent Cuts & Styles",
							level: "h2",
							align: "center",
							padding: "medium",
						},
						"gallery-1": {
							title: "",
							images: [
								img.gallery1,
								img.gallery2,
								img.gallery3,
								img.gallery4,
								img.gallery5,
								img.gallery6,
							],
							columns: "3",
							gap: "medium",
						},
						"spacer-1": { size: "large" },
						"heading-2": {
							text: "The Shop",
							level: "h2",
							align: "center",
							padding: "small",
						},
						"text-1": {
							content: richText([
								"Our space on Lazaretská street was designed to blend industrial edge with warmth. Exposed brick, leather chairs, warm lighting, and a curated playlist — every detail is intentional.",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"gallery-2": {
							title: "",
							images: [img.shopInterior, img.shopDetail],
							columns: "2",
							gap: "large",
						},
						"booking-cta-1": {
							title: "Like What You See?",
							description:
								"Book your appointment and let us create something great for you.",
							buttonText: "Book Now",
							variant: "highlight",
							size: "lg",
						},
					},
				},
				metaTitle: "Gallery - Sharp Cuts Barbershop",
				metaDescription:
					"Browse our portfolio of haircuts, fades, and beard work. See the Sharp Cuts difference.",
			},
			ctxEn,
		);

		// Gallery page SK
		await app.api.collections.pages.update(
			{
				where: { id: galleryPage.id },
				data: {
					title: "Galéria",
					description: "Pozrite si našu prácu",
					content: {
						_tree: [
							{ id: "hero-1", type: "hero", children: [] },
							{ id: "heading-1", type: "heading", children: [] },
							{ id: "gallery-1", type: "gallery", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{ id: "heading-2", type: "heading", children: [] },
							{ id: "text-1", type: "text", children: [] },
							{ id: "gallery-2", type: "gallery", children: [] },
							{ id: "booking-cta-1", type: "booking-cta", children: [] },
						],
						_values: {
							"hero-1": {
								title: "Naša práca",
								subtitle: "Každý strih je remeslo. Každý klient je plátno.",
								backgroundImage: img.heroGallery,
								overlayOpacity: 60,
								alignment: "center",
								height: "small",
							},
							"heading-1": {
								text: "Najnovšie strihy a štýly",
								level: "h2",
								align: "center",
								padding: "medium",
							},
							"gallery-1": {
								title: "",
								images: [
									img.gallery1,
									img.gallery2,
									img.gallery3,
									img.gallery4,
									img.gallery5,
									img.gallery6,
								],
								columns: "3",
								gap: "medium",
							},
							"spacer-1": { size: "large" },
							"heading-2": {
								text: "Náš priestor",
								level: "h2",
								align: "center",
								padding: "small",
							},
							"text-1": {
								content: richText([
									"Náš priestor na Lazaretskej bol navrhnutý tak, aby spájal industriálny charakter s teplom. Odhalené tehly, kožené kreslá, teplé osvetlenie a kurátorský playlist.",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"gallery-2": {
								title: "",
								images: [img.shopInterior, img.shopDetail],
								columns: "2",
								gap: "large",
							},
							"booking-cta-1": {
								title: "Páči sa vám, čo vidíte?",
								description:
									"Rezervujte si termín a nechajte nás vytvoriť niečo skvelé.",
								buttonText: "Rezervovať",
								variant: "highlight",
								size: "lg",
							},
						},
					},
					metaTitle: "Galéria - Sharp Cuts Barbershop",
					metaDescription:
						"Prezrite si naše portfólio strihov, fade-ov a úprav brady.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Gallery page (EN + SK)");

		// ── CONTACT PAGE ───────────────────────────────────────────────────────

		const contactPage = await app.api.collections.pages.create(
			{
				title: "Contact",
				slug: "contact",
				description: "Get in touch with us",
				isPublished: true,
				content: {
					_tree: [
						{ id: "heading-1", type: "heading", children: [] },
						{ id: "text-1", type: "text", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{
							id: "columns-1",
							type: "columns",
							children: [
								{
									id: "contact-info-1",
									type: "contact-info",
									children: [],
								},
								{ id: "hours-1", type: "hours", children: [] },
							],
						},
						{ id: "spacer-2", type: "spacer", children: [] },
						{ id: "cta-1", type: "cta", children: [] },
					],
					_values: {
						"heading-1": {
							text: "Get in Touch",
							level: "h1",
							align: "center",
							padding: "large",
						},
						"text-1": {
							content: richText([
								"We're always happy to hear from you. Whether you have a question, want to give feedback, or just want to say hi — reach out anytime. For appointments, use our online booking or give us a call.",
							]),
							maxWidth: "medium",
							padding: "none",
						},
						"spacer-1": { size: "medium" },
						"columns-1": {
							columns: "2",
							gap: "large",
							padding: "medium",
						},
						"contact-info-1": {
							title: "Find Us",
							showMap: true,
						},
						"hours-1": {
							title: "Opening Hours",
							showClosed: true,
						},
						"spacer-2": { size: "medium" },
						"cta-1": {
							title: "Prefer to Book Online?",
							description:
								"Choose your service, pick a barber, and find a time that works for you.",
							buttonText: "Book Appointment",
							buttonLink: "/booking",
							variant: "light",
							size: "medium",
						},
					},
				},
				metaTitle: "Contact Us - Sharp Cuts Barbershop",
				metaDescription:
					"Visit us at Lazaretská 12, Bratislava. Call, email, or book your appointment online.",
			},
			ctxEn,
		);

		// Contact page SK
		await app.api.collections.pages.update(
			{
				where: { id: contactPage.id },
				data: {
					title: "Kontakt",
					description: "Kontaktujte nás",
					content: {
						_tree: [
							{ id: "heading-1", type: "heading", children: [] },
							{ id: "text-1", type: "text", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{
								id: "columns-1",
								type: "columns",
								children: [
									{
										id: "contact-info-1",
										type: "contact-info",
										children: [],
									},
									{ id: "hours-1", type: "hours", children: [] },
								],
							},
							{ id: "spacer-2", type: "spacer", children: [] },
							{ id: "cta-1", type: "cta", children: [] },
						],
						_values: {
							"heading-1": {
								text: "Kontaktujte nás",
								level: "h1",
								align: "center",
								padding: "large",
							},
							"text-1": {
								content: richText([
									"Radi sa ozveme. Či máte otázku, chcete dať spätnú väzbu alebo sa len pozdraviť — ozvite sa kedykoľvek. Na rezerváciu použite náš online systém alebo nám zavolajte.",
								]),
								maxWidth: "medium",
								padding: "none",
							},
							"spacer-1": { size: "medium" },
							"columns-1": {
								columns: "2",
								gap: "large",
								padding: "medium",
							},
							"contact-info-1": {
								title: "Kde nás nájdete",
								showMap: true,
							},
							"hours-1": {
								title: "Otváracie hodiny",
								showClosed: true,
							},
							"spacer-2": { size: "medium" },
							"cta-1": {
								title: "Radšej online?",
								description:
									"Vyberte službu, holiča a čas, ktorý vám vyhovuje.",
								buttonText: "Rezervovať termín",
								buttonLink: "/booking",
								variant: "light",
								size: "medium",
							},
						},
					},
					metaTitle: "Kontakt - Sharp Cuts Barbershop",
					metaDescription:
						"Navštívte nás na Lazaretskej 12 v Bratislave. Volajte, píšte, alebo si rezervujte online.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Contact page (EN + SK)");

		// ── PRIVACY POLICY PAGE ─────────────────────────────────────────────────

		const privacyPage = await app.api.collections.pages.create(
			{
				title: "Privacy Policy",
				slug: "privacy",
				description: "Our privacy policy and data handling practices",
				isPublished: true,
				content: {
					_tree: [
						{ id: "heading-1", type: "heading", children: [] },
						{ id: "text-1", type: "text", children: [] },
						{ id: "spacer-1", type: "spacer", children: [] },
						{ id: "heading-2", type: "heading", children: [] },
						{ id: "text-2", type: "text", children: [] },
						{ id: "spacer-2", type: "spacer", children: [] },
						{ id: "heading-3", type: "heading", children: [] },
						{ id: "text-3", type: "text", children: [] },
						{ id: "spacer-3", type: "spacer", children: [] },
						{ id: "heading-4", type: "heading", children: [] },
						{ id: "text-4", type: "text", children: [] },
						{ id: "spacer-4", type: "spacer", children: [] },
						{ id: "heading-5", type: "heading", children: [] },
						{ id: "text-5", type: "text", children: [] },
						{ id: "spacer-5", type: "spacer", children: [] },
						{ id: "heading-6", type: "heading", children: [] },
						{ id: "text-6", type: "text", children: [] },
					],
					_values: {
						"heading-1": {
							text: "Privacy Policy",
							level: "h1",
							align: "center",
							padding: "large",
						},
						"text-1": {
							content: richText([
								"Last updated: January 2025",
								"At Sharp Cuts, we take your privacy seriously. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you visit our barbershop or use our online booking system.",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"spacer-1": { size: "medium" },
						"heading-2": {
							text: "Information We Collect",
							level: "h2",
							align: "left",
							padding: "small",
						},
						"text-2": {
							content: richText([
								"We collect information that you provide directly to us, including:",
								"• Name and contact information (email, phone number)",
								"• Appointment preferences and history",
								"• Payment information (processed securely through our payment provider)",
								"• Communications you send to us",
								"We do not sell, trade, or otherwise transfer your personal information to outside parties.",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"spacer-2": { size: "medium" },
						"heading-3": {
							text: "How We Use Your Information",
							level: "h2",
							align: "left",
							padding: "small",
						},
						"text-3": {
							content: richText([
								"We use the information we collect to:",
								"• Process and manage your appointments",
								"• Send appointment confirmations and reminders",
								"• Respond to your inquiries and requests",
								"• Improve our services and customer experience",
								"• Send promotional communications (with your consent)",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"spacer-3": { size: "medium" },
						"heading-4": {
							text: "Data Security",
							level: "h2",
							align: "left",
							padding: "small",
						},
						"text-4": {
							content: richText([
								"We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction.",
								"However, no method of transmission over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"spacer-4": { size: "medium" },
						"heading-5": {
							text: "Your Rights",
							level: "h2",
							align: "left",
							padding: "small",
						},
						"text-5": {
							content: richText([
								"Under applicable data protection laws, you have the right to:",
								"• Access, correct, or delete your personal data",
								"• Object to or restrict processing of your data",
								"• Withdraw consent at any time",
								"• Lodge a complaint with a supervisory authority",
								"To exercise these rights, please contact us at hello@sharpcuts.com.",
							]),
							maxWidth: "medium",
							padding: "small",
						},
						"spacer-5": { size: "medium" },
						"heading-6": {
							text: "Contact Us",
							level: "h2",
							align: "left",
							padding: "small",
						},
						"text-6": {
							content: richText([
								"If you have any questions about this Privacy Policy, please contact us:",
								"Email: hello@sharpcuts.com",
								"Phone: +421 900 000 000",
								"Address: Lazaretská 12, 811 09 Bratislava, Slovakia",
							]),
							maxWidth: "medium",
							padding: "small",
						},
					},
				},
				metaTitle: "Privacy Policy - Sharp Cuts Barbershop",
				metaDescription:
					"Read our privacy policy to understand how Sharp Cuts handles your personal data.",
			},
			ctxEn,
		);

		// Privacy page SK
		await app.api.collections.pages.update(
			{
				where: { id: privacyPage.id },
				data: {
					title: "Ochrana súkromia",
					description: "Naše zásady ochrany súkromia a spracovania údajov",
					content: {
						_tree: [
							{ id: "heading-1", type: "heading", children: [] },
							{ id: "text-1", type: "text", children: [] },
							{ id: "spacer-1", type: "spacer", children: [] },
							{ id: "heading-2", type: "heading", children: [] },
							{ id: "text-2", type: "text", children: [] },
							{ id: "spacer-2", type: "spacer", children: [] },
							{ id: "heading-3", type: "heading", children: [] },
							{ id: "text-3", type: "text", children: [] },
							{ id: "spacer-3", type: "spacer", children: [] },
							{ id: "heading-4", type: "heading", children: [] },
							{ id: "text-4", type: "text", children: [] },
							{ id: "spacer-4", type: "spacer", children: [] },
							{ id: "heading-5", type: "heading", children: [] },
							{ id: "text-5", type: "text", children: [] },
							{ id: "spacer-5", type: "spacer", children: [] },
							{ id: "heading-6", type: "heading", children: [] },
							{ id: "text-6", type: "text", children: [] },
						],
						_values: {
							"heading-1": {
								text: "Ochrana súkromia",
								level: "h1",
								align: "center",
								padding: "large",
							},
							"text-1": {
								content: richText([
									"Posledná aktualizácia: Január 2025",
									"V Sharp Cuts berieme vaše súkromie vážne. Tieto zásady ochrany súkromia vysvetľujú, ako zhromažďujeme, používame, zverejňujeme a chránime vaše údaje pri návšteve nášho barbershopu alebo pri používaní nášho online rezervačného systému.",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"spacer-1": { size: "medium" },
							"heading-2": {
								text: "Údaje, ktoré zhromažďujeme",
								level: "h2",
								align: "left",
								padding: "small",
							},
							"text-2": {
								content: richText([
									"Zhromažďujeme údaje, ktoré nám priamo poskytnete, vrátane:",
									"• Meno a kontaktné údaje (e-mail, telefónne číslo)",
									"• Preferencie a história rezervácií",
									"• Platobné údaje (spracované bezpečne cez nášho platobného poskytovateľa)",
									"• Komunikácia, ktorú nám posielate",
									"Vaše osobné údaje nepredávame, neobchodujeme s nimi ani ich inak neprenášame tretím stranám.",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"spacer-2": { size: "medium" },
							"heading-3": {
								text: "Ako používame vaše údaje",
								level: "h2",
								align: "left",
								padding: "small",
							},
							"text-3": {
								content: richText([
									"Zhromaždené údaje používame na:",
									"• Spracovanie a správu vašich rezervácií",
									"• Zasielanie potvrdení a pripomienok termínov",
									"• Odpovede na vaše otázky a požiadavky",
									"• Zlepšovanie našich služieb a zákazníckej skúsenosti",
									"• Zasielanie propagačných materiálov (s vaším súhlasom)",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"spacer-3": { size: "medium" },
							"heading-4": {
								text: "Bezpečnosť údajov",
								level: "h2",
								align: "left",
								padding: "small",
							},
							"text-4": {
								content: richText([
									"Implementujeme primerané technické a organizačné bezpečnostné opatrenia na ochranu vašich osobných údajov pred neoprávneným prístupom, zmenou, zverejnením alebo zničením.",
									"Žiadna metóda prenosu cez internet alebo elektronického ukladania však nie je 100% bezpečná a nemôžeme zaručiť absolútnu bezpečnosť.",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"spacer-4": { size: "medium" },
							"heading-5": {
								text: "Vaše práva",
								level: "h2",
								align: "left",
								padding: "small",
							},
							"text-5": {
								content: richText([
									"Podľa platných zákonov o ochrane údajov máte právo:",
									"• Získať prístup k svojim osobným údajom, opraviť ich alebo vymazať",
									"• Namietať proti spracovaniu údajov alebo ho obmedziť",
									"• Kedykoľvek odvolať súhlas",
									"• Podať sťažnosť dozornému orgánu",
									"Ak chcete uplatniť tieto práva, kontaktujte nás na hello@sharpcuts.com.",
								]),
								maxWidth: "medium",
								padding: "small",
							},
							"spacer-5": { size: "medium" },
							"heading-6": {
								text: "Kontaktujte nás",
								level: "h2",
								align: "left",
								padding: "small",
							},
							"text-6": {
								content: richText([
									"Ak máte akékoľvek otázky týkajúce sa týchto zásad ochrany súkromia, kontaktujte nás:",
									"E-mail: hello@sharpcuts.com",
									"Telefón: +421 900 000 000",
									"Adresa: Lazaretská 12, 811 09 Bratislava, Slovensko",
								]),
								maxWidth: "medium",
								padding: "small",
							},
						},
					},
					metaTitle: "Ochrana súkromia - Sharp Cuts Barbershop",
					metaDescription:
						"Prečítajte si naše zásady ochrany súkromia a zistite, ako Sharp Cuts nakladá s vašimi osobnými údajmi.",
				},
			},
			ctxSk,
		);
		console.log("  ✓ Privacy Policy page (EN + SK)");

		console.log("\n✅ Database seeded successfully!\n");
		console.log("Pages created:");
		console.log("  • Home     (/)");
		console.log("  • Services (/services)");
		console.log("  • About    (/about)");
		console.log("  • Gallery  (/gallery)");
		console.log("  • Contact  (/contact)");
		console.log("  • Privacy  (/privacy)\n");
		process.exit(0);
	} catch (error) {
		console.error("Seeding failed:", error);
		process.exit(1);
	}
}

seed();
