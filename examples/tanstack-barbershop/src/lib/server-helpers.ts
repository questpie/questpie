/**
 * Shared server-side helpers for data fetching
 */

import { getRequestHeaders } from "@tanstack/react-start/server";
import { app } from "@/questpie/server/app";

/**
 * Extract locale from cookie header
 */
export function getLocaleFromCookie(cookieHeader?: string): "en" | "sk" {
	if (!cookieHeader) return "en";
	const match = cookieHeader.match(/barbershop-locale=([^;]+)/);
	return match?.[1] === "sk" ? "sk" : "en";
}

/**
 * Get locale from request headers
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
 * Create app context for server-side data fetching
 */
export async function createServerContext(locale?: string) {
	const resolvedLocale = getRequestLocale(locale);
	return app.createContext({
		accessMode: "system",
		locale: resolvedLocale,
	});
}

export { app };
