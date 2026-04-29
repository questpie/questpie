import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/**
 * Format a string for display by converting camelCase, snake_case, and kebab-case to Title Case.
 *
 * Use this for formatting field names, collection names, column headers, etc.
 *
 * @example
 * formatLabel("blogPosts") // "Blog Posts"
 * formatLabel("blog_posts") // "Blog Posts"
 * formatLabel("userSettings") // "User Settings"
 * formatLabel("firstName") // "First Name"
 */
export function formatLabel(str: string): string {
	const normalized = str
		.replace(/[_-]+/g, " ")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.replace(/\s+/g, " ")
		.trim();

	return normalized.replace(/\b\w/g, (s) => s.toUpperCase());
}
