/**
 * Shared block category helpers for the city portal.
 *
 * Categories organize blocks in the admin block picker UI.
 */

import type {
	AdminConfigContext,
	BlockCategoryConfig,
} from "@questpie/admin/factories";
export const sections = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: "Sections",
	icon: c.icon("ph:layout"),
	order: 1,
});

export const content = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: "Content",
	icon: c.icon("ph:text-t"),
	order: 2,
});

export const layout = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: "Layout",
	icon: c.icon("ph:columns"),
	order: 3,
});

export const dynamic = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: "Dynamic",
	icon: c.icon("ph:arrows-clockwise"),
	order: 4,
});
