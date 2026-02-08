import type {
	AdminConfigContext,
	BlockCategoryConfig,
} from "@questpie/admin/server";
import { qb } from "./builder";

// ============================================================================
// Category Helpers
// ============================================================================

const sections = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Sections", sk: "Sekcie" },
	icon: c.icon("ph:layout"),
	order: 1,
});

const content = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Content", sk: "Obsah" },
	icon: c.icon("ph:text-t"),
	order: 2,
});

const layout = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Layout", sk: "Rozloženie" },
	icon: c.icon("ph:columns"),
	order: 3,
});

// ============================================================================
// Section Blocks
// ============================================================================

export const heroBlock = qb
	.block("hero")
	.admin(({ c }) => ({
		label: { en: "Hero Section", sk: "Hero sekcia" },
		icon: c.icon("ph:image"),
		category: sections(c),
		order: 1,
	}))
	.fields((f) => ({
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		backgroundImage: f.upload({
			label: { en: "Background Image", sk: "Obrázok pozadia" },
		}),
		overlayOpacity: f.number({
			label: { en: "Overlay Opacity", sk: "Priehľadnosť" },
			defaultValue: 60,
		}),
		alignment: f.select({
			label: { en: "Alignment", sk: "Zarovnanie" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "center",
		}),
		ctaText: f.text({
			label: { en: "CTA Text", sk: "Text tlačidla" },
			localized: true,
		}),
		ctaLink: f.text({ label: { en: "CTA Link", sk: "Odkaz tlačidla" } }),
		height: f.select({
			label: { en: "Height", sk: "Výška" },
			options: [
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
				{ value: "full", label: { en: "Full", sk: "Plná" } },
			],
			defaultValue: "medium",
		}),
	}));

export const servicesBlock = qb
	.block("services")
	.admin(({ c }) => ({
		label: { en: "Services Grid", sk: "Prehľad služieb" },
		icon: c.icon("ph:scissors"),
		category: sections(c),
		order: 2,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		showPrices: f.boolean({
			label: { en: "Show Prices", sk: "Zobraziť ceny" },
			defaultValue: true,
		}),
		showDuration: f.boolean({
			label: { en: "Show Duration", sk: "Zobraziť trvanie" },
			defaultValue: true,
		}),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
		limit: f.number({ label: { en: "Limit", sk: "Limit" }, defaultValue: 6 }),
	}))
	.prefetch(async ({ values, ctx }) => {
		const res = await (ctx.app as any).api.collections.services.find({
			limit: values.limit || 6,
			orderBy: { order: "asc" },
		});
		return { services: res.docs };
	});

export const teamBlock = qb
	.block("team")
	.admin(({ c }) => ({
		label: { en: "Team Grid", sk: "Náš tím" },
		icon: c.icon("ph:users"),
		category: sections(c),
		order: 3,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
		limit: f.number({ label: { en: "Limit", sk: "Limit" }, defaultValue: 4 }),
	}))
	.prefetch(async ({ values, ctx }) => {
		const res = await (ctx.app as any).api.collections.barbers.find({
			limit: values.limit || 4,
			where: { isActive: true },
		});
		return { barbers: res.docs };
	});

export const reviewsBlock = qb
	.block("reviews")
	.admin(({ c }) => ({
		label: { en: "Reviews", sk: "Recenzie" },
		icon: c.icon("ph:star"),
		category: sections(c),
		order: 4,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		limit: f.number({ label: { en: "Limit", sk: "Limit" }, defaultValue: 3 }),
	}))
	.prefetch(async ({ values, ctx }) => {
		const res = await (ctx.app as any).api.collections.reviews.find({
			limit: values.limit || 3,
			where: { rating: { gte: 4 } },
			orderBy: { createdAt: "desc" },
		});
		return { reviews: res.docs };
	});

export const ctaBlock = qb
	.block("cta")
	.admin(({ c }) => ({
		label: { en: "CTA", sk: "Výzva k akcii" },
		icon: c.icon("ph:megaphone"),
		category: sections(c),
		order: 5,
	}))
	.fields((f) => ({
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		description: f.textarea({
			label: { en: "Description", sk: "Popis" },
			localized: true,
		}),
		buttonText: f.text({
			label: { en: "Button Text", sk: "Text tlačidla" },
			localized: true,
		}),
		buttonLink: f.text({ label: { en: "Button Link", sk: "Odkaz tlačidla" } }),
		variant: f.select({
			label: { en: "Variant", sk: "Variant" },
			options: [
				{ value: "highlight", label: "Highlight" },
				{ value: "dark", label: "Dark" },
				{ value: "light", label: "Light" },
			],
			defaultValue: "highlight",
		}),
		size: f.select({
			label: { en: "Size", sk: "Veľkosť" },
			options: [
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
			],
			defaultValue: "medium",
		}),
	}));

export const bookingCtaBlock = qb
	.block("booking-cta")
	.admin(({ c }) => ({
		label: { en: "Booking CTA", sk: "Rezervačná výzva" },
		icon: c.icon("ph:calendar-plus"),
		category: sections(c),
		order: 6,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		description: f.textarea({
			label: { en: "Description", sk: "Popis" },
			localized: true,
		}),
		buttonText: f.text({
			label: { en: "Button Text", sk: "Text tlačidla" },
			localized: true,
		}),
		serviceId: f.text({
			label: { en: "Pre-select Service ID", sk: "Predvybraná služba" },
		}),
		barberId: f.text({
			label: { en: "Pre-select Barber ID", sk: "Predvybraný holič" },
		}),
		variant: f.select({
			label: { en: "Variant", sk: "Variant" },
			options: [
				{ value: "default", label: "Default" },
				{ value: "highlight", label: "Highlight" },
				{ value: "outline", label: "Outline" },
			],
			defaultValue: "highlight",
		}),
		size: f.select({
			label: { en: "Size", sk: "Veľkosť" },
			options: [
				{ value: "default", label: "Default" },
				{ value: "lg", label: "Large" },
			],
			defaultValue: "default",
		}),
	}));

export const barbersFeaturedBlock = qb
	.block("barbers-featured")
	.admin(({ c }) => ({
		label: { en: "Featured Barbers", sk: "Vybraní holiči" },
		icon: c.icon("ph:users-three"),
		category: sections(c),
		order: 7,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		barberIds: f.json({ label: { en: "Barber IDs", sk: "ID holičov" } }),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		const ids = (values.barberIds as string[]) || [];
		if (ids.length === 0) return { barbers: [] };
		const res = await (ctx.app as any).api.collections.barbers.find({
			where: { id: { in: ids } },
			limit: ids.length,
		});
		return { barbers: res.docs };
	});

export const servicesFeaturedBlock = qb
	.block("services-featured")
	.admin(({ c }) => ({
		label: { en: "Featured Services", sk: "Vybrané služby" },
		icon: c.icon("ph:star"),
		category: sections(c),
		order: 8,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		serviceIds: f.json({ label: { en: "Service IDs", sk: "ID služieb" } }),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		const ids = (values.serviceIds as string[]) || [];
		if (ids.length === 0) return { services: [] };
		const res = await (ctx.app as any).api.collections.services.find({
			where: { id: { in: ids } },
			limit: ids.length,
		});
		return { services: res.docs };
	});

export const reviewsGridBlock = qb
	.block("reviews-grid")
	.admin(({ c }) => ({
		label: { en: "Reviews Grid", sk: "Mriežka recenzií" },
		icon: c.icon("ph:star-half"),
		category: sections(c),
		order: 9,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		filter: f.select({
			label: { en: "Filter", sk: "Filter" },
			options: [
				{ value: "featured", label: "Featured" },
				{ value: "recent", label: "Recent" },
				{ value: "all", label: "All" },
			],
			defaultValue: "recent",
		}),
		limit: f.number({ label: { en: "Limit", sk: "Limit" }, defaultValue: 6 }),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		const where: Record<string, any> = {};
		if (values.filter === "featured") {
			where.rating = { gte: 4 };
		}
		const res = await (ctx.app as any).api.collections.reviews.find({
			limit: values.limit || 6,
			where,
			orderBy: { createdAt: "desc" },
		});
		return { reviews: res.docs };
	});

// ============================================================================
// Content Blocks
// ============================================================================

export const textBlock = qb
	.block("text")
	.admin(({ c }) => ({
		label: { en: "Text Block", sk: "Textový blok" },
		icon: c.icon("ph:text-t"),
		category: content(c),
		order: 1,
	}))
	.fields((f) => ({
		content: f.richText({
			label: { en: "Content", sk: "Obsah" },
			localized: true,
			required: true,
		}),
		maxWidth: f.select({
			label: { en: "Max Width", sk: "Max šírka" },
			options: [
				{ value: "narrow", label: { en: "Narrow", sk: "Úzky" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredný" } },
				{ value: "wide", label: { en: "Wide", sk: "Široký" } },
				{ value: "full", label: { en: "Full", sk: "Plný" } },
			],
			defaultValue: "medium",
		}),
		padding: f.select({
			label: { en: "Padding", sk: "Odsadenie" },
			options: [
				{ value: "none", label: { en: "None", sk: "Žiadne" } },
				{ value: "small", label: { en: "Small", sk: "Malé" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredné" } },
				{ value: "large", label: { en: "Large", sk: "Veľké" } },
			],
			defaultValue: "medium",
		}),
	}));

export const headingBlock = qb
	.block("heading")
	.admin(({ c }) => ({
		label: { en: "Heading", sk: "Nadpis" },
		icon: c.icon("ph:text-h-one"),
		category: content(c),
		order: 2,
	}))
	.fields((f) => ({
		text: f.text({
			label: { en: "Text", sk: "Text" },
			localized: true,
			required: true,
		}),
		level: f.select({
			label: { en: "Level", sk: "Úroveň" },
			options: [
				{ value: "h1", label: "H1" },
				{ value: "h2", label: "H2" },
				{ value: "h3", label: "H3" },
				{ value: "h4", label: "H4" },
			],
			defaultValue: "h2",
		}),
		align: f.select({
			label: { en: "Alignment", sk: "Zarovnanie" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "left",
		}),
		padding: f.select({
			label: { en: "Padding", sk: "Odsadenie" },
			options: [
				{ value: "none", label: { en: "None", sk: "Žiadne" } },
				{ value: "small", label: { en: "Small", sk: "Malé" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredné" } },
				{ value: "large", label: { en: "Large", sk: "Veľké" } },
			],
			defaultValue: "medium",
		}),
	}));

export const hoursBlock = qb
	.block("hours")
	.admin(({ c }) => ({
		label: { en: "Business Hours", sk: "Otváracie hodiny" },
		icon: c.icon("ph:clock"),
		category: content(c),
		order: 3,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		showClosed: f.boolean({
			label: { en: "Show Closed Days", sk: "Zobraziť zatvorené dni" },
			defaultValue: true,
		}),
	}))
	.prefetch(async ({ ctx }) => {
		const settings = await (ctx.app as any).api.globals.siteSettings.get({});
		return { businessHours: settings?.businessHours };
	});

export const contactInfoBlock = qb
	.block("contact-info")
	.admin(({ c }) => ({
		label: { en: "Contact Info", sk: "Kontaktné údaje" },
		icon: c.icon("ph:phone"),
		category: content(c),
		order: 4,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		showMap: f.boolean({
			label: { en: "Show Map", sk: "Zobraziť mapu" },
			defaultValue: true,
		}),
	}))
	.prefetch(async ({ ctx }) => {
		const settings = await (ctx.app as any).api.globals.siteSettings.get({});
		return {
			shopName: settings?.shopName,
			contactEmail: settings?.contactEmail,
			contactPhone: settings?.contactPhone,
			address: settings?.address,
			city: settings?.city,
			zipCode: settings?.zipCode,
			country: settings?.country,
			mapEmbedUrl: settings?.mapEmbedUrl,
		};
	});

export const galleryBlock = qb
	.block("gallery")
	.admin(({ c }) => ({
		label: { en: "Gallery", sk: "Galéria" },
		icon: c.icon("ph:images"),
		category: content(c),
		order: 5,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		images: f.json({ label: { en: "Images", sk: "Obrázky" } }),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
		gap: f.select({
			label: { en: "Gap", sk: "Medzera" },
			options: [
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			],
			defaultValue: "medium",
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		const imageIds =
			(values.images as any[])?.map((img: any) => img.id).filter(Boolean) || [];
		if (imageIds.length === 0) return { imageUrls: {} };
		const res = await (ctx.app as any).api.collections.uploads.find({
			where: { id: { in: imageIds } },
			limit: imageIds.length,
		});
		const imageUrls: Record<string, string> = {};
		for (const doc of res.docs) {
			imageUrls[doc.id] = doc.url;
		}
		return { imageUrls };
	});

export const imageTextBlock = qb
	.block("image-text")
	.admin(({ c }) => ({
		label: { en: "Image + Text", sk: "Obrázok + Text" },
		icon: c.icon("ph:layout"),
		category: content(c),
		order: 6,
	}))
	.fields((f) => ({
		image: f.upload({ label: { en: "Image", sk: "Obrázok" } }),
		imagePosition: f.select({
			label: { en: "Image Position", sk: "Pozícia obrázka" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "left",
		}),
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		content: f.richText({
			label: { en: "Content", sk: "Obsah" },
			localized: true,
		}),
		ctaText: f.text({
			label: { en: "CTA Text", sk: "Text tlačidla" },
			localized: true,
		}),
		ctaLink: f.text({ label: { en: "CTA Link", sk: "Odkaz" } }),
		imageAspect: f.select({
			label: { en: "Image Aspect", sk: "Pomer strán" },
			options: [
				{ value: "square", label: "Square" },
				{ value: "portrait", label: "Portrait" },
				{ value: "landscape", label: "Landscape" },
			],
			defaultValue: "square",
		}),
	}));

export const statsBlock = qb
	.block("stats")
	.admin(({ c }) => ({
		label: { en: "Stats", sk: "Štatistiky" },
		icon: c.icon("ph:chart-bar"),
		category: content(c),
		order: 7,
	}))
	.fields((f) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		stats: f.json({ label: { en: "Stats", sk: "Štatistiky" } }),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
	}));

// ============================================================================
// Layout Blocks
// ============================================================================

export const columnsBlock = qb
	.block("columns")
	.admin(({ c }) => ({
		label: { en: "Columns", sk: "Stĺpce" },
		icon: c.icon("ph:columns"),
		category: layout(c),
		order: 1,
	}))
	.allowChildren()
	.fields((f) => ({
		columns: f.select({
			label: { en: "Columns", sk: "Počet stĺpcov" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "2",
		}),
		gap: f.select({
			label: { en: "Gap", sk: "Medzera" },
			options: [
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			],
			defaultValue: "medium",
		}),
		padding: f.select({
			label: { en: "Padding", sk: "Odsadenie" },
			options: [
				{ value: "none", label: { en: "None", sk: "Žiadne" } },
				{ value: "small", label: { en: "Small", sk: "Malé" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredné" } },
				{ value: "large", label: { en: "Large", sk: "Veľké" } },
			],
			defaultValue: "medium",
		}),
	}));

export const spacerBlock = qb
	.block("spacer")
	.admin(({ c }) => ({
		label: { en: "Spacer", sk: "Medzera" },
		icon: c.icon("ph:arrows-out-vertical"),
		category: layout(c),
		order: 2,
	}))
	.fields((f) => ({
		size: f.select({
			label: { en: "Size", sk: "Veľkosť" },
			options: [
				{ value: "small", label: "S" },
				{ value: "medium", label: "M" },
				{ value: "large", label: "L" },
				{ value: "xlarge", label: "XL" },
			],
			defaultValue: "medium",
		}),
	}));

export const dividerBlock = qb
	.block("divider")
	.admin(({ c }) => ({
		label: { en: "Divider", sk: "Oddelovač" },
		icon: c.icon("ph:minus"),
		category: layout(c),
		order: 3,
	}))
	.fields((f) => ({
		style: f.select({
			label: { en: "Style", sk: "Štýl" },
			options: [
				{ value: "solid", label: "Solid" },
				{ value: "dashed", label: "Dashed" },
			],
			defaultValue: "solid",
		}),
		width: f.select({
			label: { en: "Width", sk: "Šírka" },
			options: [
				{ value: "full", label: { en: "Full", sk: "Plná" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "small", label: { en: "Small", sk: "Malá" } },
			],
			defaultValue: "full",
		}),
	}));

// ============================================================================
// Export all blocks
// ============================================================================

export const blocks = {
	hero: heroBlock,
	text: textBlock,
	heading: headingBlock,
	services: servicesBlock,
	team: teamBlock,
	reviews: reviewsBlock,
	cta: ctaBlock,
	columns: columnsBlock,
	spacer: spacerBlock,
	divider: dividerBlock,
	hours: hoursBlock,
	"contact-info": contactInfoBlock,
	"booking-cta": bookingCtaBlock,
	gallery: galleryBlock,
	"image-text": imageTextBlock,
	stats: statsBlock,
	"barbers-featured": barbersFeaturedBlock,
	"services-featured": servicesFeaturedBlock,
	"reviews-grid": reviewsGridBlock,
};
