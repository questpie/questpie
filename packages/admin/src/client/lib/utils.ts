import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a string for display by converting camelCase/PascalCase to Title Case with spaces.
 *
 * Use this for formatting field names, collection names, column headers, etc.
 *
 * @example
 * formatLabel("blogPosts") // "Blog Posts"
 * formatLabel("userSettings") // "User Settings"
 * formatLabel("firstName") // "First Name"
 */
export function formatLabel(str: string): string {
  return str
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

/**
 * @deprecated Use `formatLabel` instead
 */
export const formatCollectionName = formatLabel;
