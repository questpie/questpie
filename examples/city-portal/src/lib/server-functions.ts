/**
 * City Portal Server Functions
 *
 * All data fetching via createServerFn for proper SSR and security.
 */

import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { app, createServerContext } from "@/lib/server-helpers";

/**
 * Recursively narrows `unknown` to `Record<string, {}>` so return types
 * satisfy TanStack Start's deep `extends {}` constraint on ServerFn results.
 * json/blocks/richText columns are typed as `unknown` by drizzle but are
 * always JSON objects at runtime.
 * Preserves Date, RegExp, and other builtins as-is.
 */
type JsonSafe<T> = unknown extends T
	? Record<string, {}>
	: T extends Date | RegExp | Function
		? T
		: T extends readonly (infer U)[]
			? JsonSafe<U>[]
			: T extends object
				? { [K in keyof T]: JsonSafe<T[K]> }
				: T;

// ============================================================================
// Cities
// ============================================================================

export const getCities = createServerFn({ method: "GET" }).handler(async () => {
	const ctx = await createServerContext();
	const result = await app.collections.cities.find(
		{
			where: { isActive: true },
			orderBy: { name: "asc" },
			with: { logo: true },
		},
		ctx,
	);
	return { cities: result.docs };
});

export const getCityBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { slug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const result = await app.collections.cities.find(
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
		const cityResult = await app.collections.cities.find(
			{
				where: { slug: data.citySlug },
				limit: 1,
			},
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) return null;

		const settings = await app.globals.site_settings.get(
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
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		// Try "home" then "index"
		let page = await app.collections.pages.findOne(
			{ where: { slug: "home", city: city.id, isPublished: true } },
			ctx,
		);
		if (!page) {
			page = await app.collections.pages.findOne(
				{ where: { slug: "index", city: city.id, isPublished: true } },
				ctx,
			);
		}

		const result = { page };
		return result as JsonSafe<typeof result>;
	});

export const getPageBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; pageSlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const page = await app.collections.pages.findOne(
			{
				where: {
					slug: data.pageSlug,
					city: city.id,
					isPublished: true,
				},
			},
			ctx,
		);

		const result = { page };
		return result as JsonSafe<typeof result>;
	});

// ============================================================================
// News
// ============================================================================

const NEWS_CATEGORIES = [
	"general",
	"council",
	"events",
	"planning",
	"community",
	"transport",
] as const;

type NewsCategory = (typeof NEWS_CATEGORIES)[number];

function narrowNewsCategory(
	category: string | undefined,
): NewsCategory | undefined {
	if (!category || category === "all") {
		return undefined;
	}

	return NEWS_CATEGORIES.includes(category as NewsCategory)
		? (category as NewsCategory)
		: undefined;
}

const DOCUMENT_CATEGORIES = [
	"policy",
	"minutes",
	"budget",
	"planning",
	"strategy",
	"report",
	"form",
	"guide",
	"other",
] as const;

type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

function narrowDocumentCategory(
	category: string | undefined,
): DocumentCategory | undefined {
	if (!category || category === "all") {
		return undefined;
	}

	return DOCUMENT_CATEGORIES.includes(category as DocumentCategory)
		? (category as DocumentCategory)
		: undefined;
}

const SUBMISSION_DEPARTMENTS = [
	"general",
	"planning",
	"housing",
	"environment",
	"council-tax",
	"benefits",
	"parking",
	"waste",
	"other",
] as const;

type SubmissionDepartment = (typeof SUBMISSION_DEPARTMENTS)[number];

function narrowSubmissionDepartment(department: string): SubmissionDepartment {
	return SUBMISSION_DEPARTMENTS.includes(department as SubmissionDepartment)
		? (department as SubmissionDepartment)
		: "other";
}

export const getNewsList = createServerFn({ method: "GET" })
	.inputValidator(
		(data: { citySlug: string; category?: string; limit?: number }) => data,
	)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const newsCategory = narrowNewsCategory(data.category);

		const result = await app.collections.news.find(
			{
				where: {
					city: city.id,
					isPublished: true,
					...(newsCategory ? { category: newsCategory } : {}),
				},
				limit: data.limit || 20,
				orderBy: { isFeatured: "desc", publishedAt: "desc" },
				with: { image: true },
			},
			ctx,
		);
		const out = { news: result.docs };
		return out as JsonSafe<typeof out>;
	});

export const getNewsBySlug = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; newsSlug: string }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const article = await app.collections.news.findOne(
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
		const out = { article };
		return out as JsonSafe<typeof out>;
	});

// ============================================================================
// Announcements
// ============================================================================

export const getAnnouncementsList = createServerFn({ method: "GET" })
	.inputValidator((data: { citySlug: string; showExpired?: boolean }) => data)
	.handler(async ({ data }) => {
		const ctx = await createServerContext();
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const result = await app.collections.announcements.find(
			{
				where: {
					city: city.id,
					...(data.showExpired
						? {}
						: { validTo: { gte: new Date().toISOString() } }),
				},
				orderBy: { isPinned: "desc", validFrom: "desc" },
				limit: 50,
			},
			ctx,
		);
		const out = { announcements: result.docs };
		return out as JsonSafe<typeof out>;
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
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const documentCategory = narrowDocumentCategory(data.category);

		const result = await app.collections.documents.find(
			{
				where: {
					city: city.id,
					isPublished: true,
					...(documentCategory ? { category: documentCategory } : {}),
				},
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
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw notFound();

		const result = await app.collections.contacts.find(
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
		const cityResult = await app.collections.cities.find(
			{ where: { slug: data.citySlug }, limit: 1 },
			ctx,
		);
		const city = cityResult.docs[0];
		if (!city) throw new Error("City not found");

		await app.collections.submissions.create(
			{
				city: city.id,
				name: data.name,
				email: data.email,
				phone: data.phone || undefined,
				department: narrowSubmissionDepartment(data.department),
				subject: data.subject,
				message: data.message,
				status: "new",
			},
			ctx,
		);

		return { success: true };
	});
