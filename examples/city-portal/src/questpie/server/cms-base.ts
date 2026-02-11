/**
 * CMS Base Builder
 *
 * Contains the full CMS configuration (collections, globals, auth, etc.)
 * EXCEPT blocks. This allows blocks to import BaseCMS for typed ctx.app
 * access in prefetch functions without circular type dependencies.
 *
 * Dependency graph:
 *   cms-base.ts  <--type-only--  blocks.ts
 *        \                          /
 *         \---runtime----> cms.ts <--runtime--
 */

import { qb } from "@/questpie/server/builder";
import {
	announcements,
	cities,
	cityMembers,
	contacts,
	documents,
	news,
	pages,
	submissions,
} from "@/questpie/server/collections";
import { siteSettings } from "./globals";
import { sidebar } from "./sidebar";

export const cmsBase = qb
	.use(sidebar)
	.collections({
		cities,
		cityMembers,
		pages,
		news,
		announcements,
		documents,
		contacts,
		submissions,
	})
	.globals({ siteSettings })
	.branding({
		name: "City Portal",
	})
	.locale({
		locales: [
			{
				code: "en",
				label: "English",
				fallback: true,
				flagCountryCode: "gb",
			},
		],
		defaultLocale: "en",
	})
	.adminLocale({
		locales: ["en"],
		defaultLocale: "en",
	})
	.auth({
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		baseURL: process.env.APP_URL || "http://localhost:3001",
		basePath: "/api/cms/auth",
		secret:
			process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
	});

/**
 * Inferred CMS type WITHOUT blocks.
 * Use this in block prefetch functions for typed ctx.app access.
 */
export type BaseCMS = (typeof cmsBase)["$inferCms"];
