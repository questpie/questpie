import { seed } from "questpie";

export default seed({
	id: "siteSettings",
	description: "Site settings with EN and SK translations",
	category: "required",
	async run({ globals, createContext, log }) {
		const ctxEn = await createContext({
			accessMode: "system",
			locale: "en",
		});
		const ctxSk = await createContext({
			accessMode: "system",
			locale: "sk",
		});

		log("Updating site settings (EN)...");
		await globals.siteSettings.update(
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

		log("Updating site settings (SK)...");
		await globals.siteSettings.update(
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

		log("Site settings seeded");
	},
});
