/**
 * usePrefillParams Hook
 *
 * Reads prefill parameters from URL query string for pre-populating form fields.
 * Supports the pattern: ?prefill.fieldName=value
 *
 * @example
 * ```tsx
 * // URL: /admin/collections/barbers/create?prefill.services=123
 *
 * const prefill = usePrefillParams();
 * // prefill = { services: "123" }
 *
 * <CollectionForm defaultValues={prefill} ... />
 * ```
 */

import * as React from "react";

/**
 * Parse prefill parameters from a URLSearchParams object
 */
export function parsePrefillParams(
	searchParams: URLSearchParams,
): Record<string, unknown> {
	const prefill: Record<string, unknown> = {};

	for (const [key, value] of searchParams.entries()) {
		if (key.startsWith("prefill.")) {
			const fieldName = key.slice("prefill.".length);
			if (fieldName) {
				// Try to parse JSON for complex values (arrays, objects)
				try {
					// Check if value looks like JSON
					if (
						value.startsWith("[") ||
						value.startsWith("{") ||
						value === "true" ||
						value === "false" ||
						value === "null" ||
						!isNaN(Number(value))
					) {
						prefill[fieldName] = JSON.parse(value);
					} else {
						prefill[fieldName] = value;
					}
				} catch {
					// If parsing fails, use as string
					prefill[fieldName] = value;
				}
			}
		}
	}

	return prefill;
}

/**
 * Parse prefill parameters from URL string
 */
function parsePrefillParamsFromUrl(url: string): Record<string, unknown> {
	try {
		const urlObj = new URL(url, "http://localhost");
		return parsePrefillParams(urlObj.searchParams);
	} catch {
		return {};
	}
}

/**
 * Hook to read prefill parameters from current URL
 *
 * @returns Object with field names as keys and prefill values
 */
function usePrefillParams(): Record<string, unknown> {
	const [prefill, setPrefill] = React.useState<Record<string, unknown>>({});

	React.useEffect(() => {
		if (typeof window === "undefined") return;

		// Parse initial URL
		const searchParams = new URLSearchParams(window.location.search);
		setPrefill(parsePrefillParams(searchParams));

		// Listen for URL changes (for SPA navigation)
		const handlePopState = () => {
			const params = new URLSearchParams(window.location.search);
			setPrefill(parsePrefillParams(params));
		};

		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	return prefill;
}

/**
 * Build URL with prefill parameters
 *
 * @param baseUrl - Base URL to add params to
 * @param prefillData - Object with field names and values to prefill
 * @returns URL with prefill query params
 *
 * @example
 * ```ts
 * buildPrefillUrl("/admin/collections/barbers/create", { services: "123" })
 * // Returns: "/admin/collections/barbers/create?prefill.services=123"
 *
 * buildPrefillUrl("/admin/collections/posts/create", { tags: ["a", "b"] })
 * // Returns: "/admin/collections/posts/create?prefill.tags=%5B%22a%22%2C%22b%22%5D"
 * ```
 */
export function buildPrefillUrl(
	baseUrl: string,
	prefillData: Record<string, unknown>,
): string {
	const url = new URL(baseUrl, "http://localhost");

	for (const [key, value] of Object.entries(prefillData)) {
		if (value !== undefined && value !== null) {
			const stringValue =
				typeof value === "object" ? JSON.stringify(value) : String(value);
			url.searchParams.set(`prefill.${key}`, stringValue);
		}
	}

	// Return path + search (without origin for relative URLs)
	return url.pathname + url.search;
}
