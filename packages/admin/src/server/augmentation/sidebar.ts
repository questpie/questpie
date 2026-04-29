/**
 * Sidebar Types
 *
 * Server-side sidebar configuration: items, sections, contributions,
 * and sidebar context types.
 */

import type { I18nText } from "questpie/shared";

import type { ComponentReference } from "./common.js";
import type { ComponentFactory } from "./views.js";

// ============================================================================
// Server-Side Sidebar Configuration
// ============================================================================

/**
 * Server-side sidebar item types
 */
export type ServerSidebarItem =
	| ServerSidebarCollectionItem
	| ServerSidebarGlobalItem
	| ServerSidebarPageItem
	| ServerSidebarLinkItem
	| ServerSidebarDividerItem;

/**
 * Collection item in sidebar
 */
export interface ServerSidebarCollectionItem {
	type: "collection";
	/** Collection name (validated against registered collections) */
	collection: string;
	/** Override display label */
	label?: I18nText;
	/** Override icon */
	icon?: ComponentReference;
}

/**
 * Global item in sidebar
 */
export interface ServerSidebarGlobalItem {
	type: "global";
	/** Global name (validated against registered globals) */
	global: string;
	/** Override display label */
	label?: I18nText;
	/** Override icon */
	icon?: ComponentReference;
}

/**
 * Custom page item in sidebar
 */
export interface ServerSidebarPageItem {
	type: "page";
	/** Page ID (resolved by client) */
	pageId: string;
	/** Display label */
	label?: I18nText;
	/** Icon */
	icon?: ComponentReference;
}

/**
 * External link item in sidebar
 */
export interface ServerSidebarLinkItem {
	type: "link";
	/** Display label */
	label: I18nText;
	/** Link URL */
	href: string;
	/** Icon */
	icon?: ComponentReference;
	/** Open in new tab */
	external?: boolean;
}

/**
 * Divider item in sidebar
 */
export interface ServerSidebarDividerItem {
	type: "divider";
}

/**
 * Sidebar section
 */
export interface ServerSidebarSection {
	/** Section ID (for targeting/extending) */
	id: string;
	/** Section title */
	title?: I18nText;
	/** Section icon */
	icon?: ComponentReference;
	/** Whether this section can be collapsed/expanded by the user */
	collapsible?: boolean;
	/** Section items */
	items?: ServerSidebarItem[];
	/** Nested subsections */
	sections?: ServerSidebarSection[];
}

/**
 * Server-side sidebar configuration (final merged output)
 */
export interface ServerSidebarConfig {
	/** Sidebar sections */
	sections: ServerSidebarSection[];
}

// ============================================================================
// Composable Sidebar Contributions (§5.8)
// ============================================================================

/**
 * Sidebar contribution — what a module or user config contributes.
 * Multiple contributions are merged by createApp() (§5.8.3).
 * Resolved from callback: `sidebar: ({ s, c }) => ({ sections: [...], items: [...] })`
 */
export interface SidebarContribution {
	/** Section definitions — merged by id across modules. Later wins for title/icon. */
	sections?: SidebarSectionDef[];
	/** Items — appended to sections by sectionId. Module resolution order. */
	items?: SidebarItemDef[];
}

/**
 * Sidebar section definition for contributions.
 */
export interface SidebarSectionDef {
	/** Unique section ID — used for targeting from other modules. */
	id: string;
	/** Section title. */
	title?: I18nText;
	/** Section icon. */
	icon?: ComponentReference;
	/** Whether section is collapsible. */
	collapsible?: boolean;
}

/**
 * Sidebar item definition for contributions.
 * Each item references a sectionId to indicate which section it belongs to.
 */
export interface SidebarItemDef extends Omit<ServerSidebarItem, "type"> {
	/** Which section this item belongs to. */
	sectionId: string;
	/** 'start' to prepend, default is 'end' (append). */
	position?: "start" | "end";
	/** Item type. */
	type: "collection" | "global" | "page" | "link" | "divider";
	/** Collection slug (when type = "collection"). */
	collection?: string;
	/** Global slug (when type = "global"). */
	global?: string;
	/** Page ID (when type = "page"). */
	pageId?: string;
	/** Display label (for links, overrides). */
	label?: I18nText;
	/** URL (for links). */
	href?: string;
	/** Icon reference. */
	icon?: ComponentReference;
	/** Open in new tab (for links). */
	external?: boolean;
}

// ============================================================================
// Sidebar Proxy & Context Types
// ============================================================================

/**
 * Sidebar proxy — provided in sidebar callbacks as `s`.
 * Creates serializable contribution objects.
 */
export interface SidebarProxy {
	/** Define a sidebar section. */
	section(def: SidebarSectionDef): SidebarSectionDef;
	/** Define a sidebar item. */
	item(def: SidebarItemDef): SidebarItemDef;
}

/**
 * Context for sidebar callbacks on module() and config().
 */
export interface SidebarCallbackContext {
	/** Sidebar builder proxy. */
	s: SidebarProxy;
	/** Component proxy (scoped to registered components). */
	c: ComponentFactory;
}

/**
 * Sidebar callback type for module() and config().
 */
export type SidebarCallback = (
	ctx: SidebarCallbackContext,
) => SidebarContribution;

/**
 * Context for sidebar config function
 */
export interface SidebarConfigContext<
	TComponents extends Record<string, any> | string = string,
> {
	/** Sidebar builder helpers */
	s: {
		/** Create sidebar config */
		sidebar: (config: ServerSidebarConfig) => ServerSidebarConfig;
		/** Create a section */
		section: (
			config: Omit<ServerSidebarSection, "items"> & {
				items?: ServerSidebarItem[];
			},
		) => ServerSidebarSection;
	};
	/** Component helpers (from registered component registry) */
	c: ComponentFactory<TComponents>;
}
