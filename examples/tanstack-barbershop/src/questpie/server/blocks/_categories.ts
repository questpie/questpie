/**
 * Shared block category helpers for the barbershop example.
 *
 * Categories organize blocks in the admin block picker UI.
 */

import type {
	AdminConfigContext,
	BlockCategoryConfig,
} from "@questpie/admin/server";

export const sections = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Sections", sk: "Sekcie" },
	icon: c.icon("ph:layout"),
	order: 1,
});

export const content = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Content", sk: "Obsah" },
	icon: c.icon("ph:text-t"),
	order: 2,
});

export const layout = (c: AdminConfigContext["c"]): BlockCategoryConfig => ({
	label: { en: "Layout", sk: "Rozloženie" },
	icon: c.icon("ph:columns"),
	order: 3,
});
