/**
 * City Portal Server Functions
 *
 * All data fetching via createServerFn for proper SSR and security.
 */

import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { app, createServerContext } from "@/lib/server-helpers";

// ============================================================================
// Cities
// ============================================================================

export const getCities = createServerFn({ method: "GET" }).handler(async () => {
	const ctx = await createServerContext();
	const result = await app.api.collections.cities.find(
		{
			where: { isActive: true },
			orderBy: { name: "asc" },
		},
		ctx,
	);
	return { cities: result.docs };
});

export const getCityBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const result = await app.api.collections.cities.find(
			{
				where: { slug: data.slug },
				limit: 1,
			},
			ctx,
		);
		const city = result.docs[0] || null;
		if (!city) throw notFound();
		return { city };
	});

// ============================================================================
// Site Settings
// ============================================================================

export const getSiteSettings = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{
				where: { slug: data.citySlug },
				limit: 1,
			},
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) return null;

		const settings = await app.api.globals.siteSettings.get(
			{ scope: city.id, with: { logo: true, favicon: true, ogImage: true } },
			ctx,
		);
		return settings;
	});

// ============================================================================
// Pages
// ============================================================================

export const getHomepage = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		// Try "home" then "index"
		let page = await app.api.collections.pages.findOne(
			{ where: { slug: "home", city: city.id, isPublished: true } },
			ctx,
		);
		if (!page) {
			page = await app.api.collections.pages.findOne(
				{ where: { slug: "index", city: city.id, isPublished: true } },
				ctx,
			);
		}

		return { page };
	});

export const getPageBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; pageSlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const page = await app.api.collections.pages.findOne(
			{
				where: {
					slug: data.pageSlug,
					city: city.id,
					isPublished: true,
				},
			},
			ctx,
		);

		return { page };
	});

// ============================================================================
// News
// ============================================================================

export const getNewsList = createServerFn({ method: "GET" })
	.inputValidator(
		(data: { citySlug: string; category?: string; limit?: number }) => data,
	)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const where: any = {
			city: city.id,
			isPublished: true,
		};
		if (data.category && data.category !== "all") {
			where.category = data.category;
		}

		const result = await app.api.collections.news.find(
			{
				where,
				limit: data.limit || 20,
				orderBy: { isFeatured: "desc", publishedAt: "desc" },
			},
			ctx,
		);
		return { news: result.docs };
	});

export const getNewsBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; newsSlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const article = await app.api.collections.news.findOne(
			{
				where: {
					slug: data.newsSlug,
					city: city.id,
					isPublished: true,
				},
				with: { image: true },
			},
			ctx,
		);

		if (!article) throw notFound();
		return { article };
	});

// ============================================================================
// Announcements
// ============================================================================

export const getAnnouncementsList = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; showExpired?: boolean }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const where: any = { city: city.id };
		if (!data.showExpired) {
			where.validTo = { gte: new Date() };
		}

		const result = await app.api.collections.announcements.find(
			{
				where,
				orderBy: { isPinned: "desc", validFrom: "desc" },
				limit: 50,
			},
			ctx,
		);
		return { announcements: result.docs };
	});

// ============================================================================
// Documents
// ============================================================================

export const getDocumentsList = createServerFn({ method: "GET" })
	.inputValidator(
		(data: { citySlug: string; category?: string; limit?: number }) => data,
	)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const where: any = { city: city.id, isPublished: true };
		if (data.category && data.category !== "all") {
			where.category = data.category;
		}

		const result = await app.api.collections.documents.find(
			{
				where,
				limit: data.limit || 50,
				orderBy: { publishedDate: "desc" },
				with: { file: true },
			},
			ctx,
		);
		return { documents: result.docs };
	});

// ============================================================================
// Contacts
// ============================================================================

export const getContactPageData = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const result = await app.api.collections.contacts.find(
			{
				where: { city: city.id },
				orderBy: { order: "asc" },
				limit: 100,
			},
			ctx,
		);
		return { contacts: result.docs };
	});

// ============================================================================
// Submissions
// ============================================================================

export const submitContactForm = createServerFn({ method: "POST" })
	.inputValidator(
		(data: {
			citySlug: string;
			name: string;
			email: string;
			phone?: string;
			department: string;
			subject: string;
			message: string;
		}) => data,
	)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.api.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw new Error("City not found");

		await app.api.collections.submissions.create(
			{
				city: city.id,
				name: data.name,
				email: data.email,
				phone: data.phone || undefined,
				department: data.department,
				subject: data.subject,
				message: data.message,
				status: "new",
			},
			ctx,
		);

		return { success: true };
	});
