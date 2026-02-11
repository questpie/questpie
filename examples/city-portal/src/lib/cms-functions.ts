/**
 * City Portal CMS Functions
 *
 * Helper functions for fetching data from the CMS.
 */

import { createClient } from "questpie/client";
import type { AppCMS } from "@/questpie/server/cms";

const baseURL =
	typeof window !== "undefined" ? "/api" : "http://localhost:3001/api";

export const cmsClient = createClient<AppCMS>({
	baseURL,
});

/**
 * Get a city by its slug
 */
export async function getCityBySlug({ slug }: { slug: string }) {
	const result = await cmsClient.api.collections.cities.find({
		where: { slug },
		limit: 1,
	});

	return { city: result.docs[0] || null };
}

/**
 * Get site settings for a city
 */
export async function getSiteSettings({ citySlug }: { citySlug: string }) {
	// First get the city to get its ID
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return null;

	// Get site settings scoped to this city
	const settings = await cmsClient.api.globals.siteSettings.get({
		scope: city.id,
	});

	return settings;
}

/**
 * Get a page by slug for a specific city
 */
export async function getPageBySlug({
	citySlug,
	pageSlug,
}: {
	citySlug: string;
	pageSlug: string;
}) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { page: null };

	const result = await cmsClient.api.collections.pages.find({
		where: {
			slug: pageSlug,
			city: city.id,
			isPublished: true,
		},
		limit: 1,
	});

	return { page: result.docs[0] || null };
}

/**
 * Get homepage for a city
 */
export async function getHomepage({ citySlug }: { citySlug: string }) {
	// Try to find a page with slug "home" or "index"
	let result = await getPageBySlug({ citySlug, pageSlug: "home" });

	if (!result.page) {
		result = await getPageBySlug({ citySlug, pageSlug: "index" });
	}

	return result;
}

/**
 * Get latest news for a city
 */
export async function getLatestNews({
	citySlug,
	limit = 3,
}: {
	citySlug: string;
	limit?: number;
}) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { news: [] };

	const result = await cmsClient.api.collections.news.find({
		where: {
			city: city.id,
			isPublished: true,
		},
		limit,
		orderBy: [{ isFeatured: "desc" }, { publishedAt: "desc" }],
	});

	return { news: result.docs };
}

/**
 * Get announcements for a city
 */
export async function getAnnouncements({
	citySlug,
	limit = 5,
	showExpired = false,
}: {
	citySlug: string;
	limit?: number;
	showExpired?: boolean;
}) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { announcements: [] };

	const where: any = {
		city: city.id,
	};

	if (!showExpired) {
		where.validTo = { gte: new Date() };
	}

	const result = await cmsClient.api.collections.announcements.find({
		where,
		limit,
		orderBy: { isPinned: "desc", validFrom: "desc" },
	});

	return { announcements: result.docs };
}

/**
 * Get contacts for a city
 */
export async function getContacts({
	citySlug,
	limit = 100,
}: {
	citySlug: string;
	limit?: number;
}) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { contacts: [] };

	const result = await cmsClient.api.collections.contacts.find({
		where: { city: city.id },
		limit,
		orderBy: { order: "asc" },
	});

	return { contacts: result.docs };
}

/**
 * Get documents for a city
 */
export async function getDocuments({
	citySlug,
	category,
	limit = 10,
}: {
	citySlug: string;
	category?: string;
	limit?: number;
}) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { documents: [] };

	const where: any = {
		city: city.id,
		isPublished: true,
	};

	if (category && category !== "all") {
		where.category = category;
	}

	const result = await cmsClient.api.collections.documents.find({
		where,
		limit,
		orderBy: { publishedDate: "desc" },
	});

	return { documents: result.docs };
}

/**
 * Get navigation pages for a city
 */
export async function getNavigationPages({ citySlug }: { citySlug: string }) {
	const { city } = await getCityBySlug({ slug: citySlug });
	if (!city) return { pages: [] };

	const result = await cmsClient.api.collections.pages.find({
		where: {
			city: city.id,
			isPublished: true,
			showInNav: true,
		},
		orderBy: { order: "asc" },
	});

	return { pages: result.docs };
}
