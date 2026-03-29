/**
 * Shared server-side helpers for data fetching.
 *
 * `createRequestContext()` creates a lean RequestContext (session, locale, db)
 * for passing as the 2nd argument to CRUD operations like `app.collections.*.find({}, ctx)`.
 *
 * This is NOT the rich AppContext you get in route handlers / hooks / block prefetch.
 * For scripts and standalone code, use `createContext()` from `#questpie` instead.
 */

import { getRequestHeaders } from "@tanstack/react-start/server";

import { app } from "#questpie";

/**
 * Extract locale from cookie header.
 */
export function getLocaleFromCookie(cookieHeader?: string): "en" | "sk" {
	if (!cookieHeader) return "en";
	const match = cookieHeader.match(/barbershop-locale=([^;]+)/);
	return match?.[1] === "sk" ? "sk" : "en";
}

/**
 * Get locale from request headers.
 */
export function getRequestLocale(overrideLocale?: string): "en" | "sk" {
	if (overrideLocale === "en" || overrideLocale === "sk") {
		return overrideLocale;
	}
	const headers = getRequestHeaders();
	const cookie = headers.get("cookie");
	return getLocaleFromCookie(cookie || undefined);
}

/**
 * Create a locale-scoped RequestContext for CRUD operations.
 * Pass the result as the 2nd argument to `app.collections.*.find({}, ctx)`.
 */
export async function createRequestContext(locale?: string) {
	const resolvedLocale = getRequestLocale(locale);
	return app.createContext({
		accessMode: "system",
		locale: resolvedLocale,
	});
}
