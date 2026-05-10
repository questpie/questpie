/**
 * Admin Shell Types
 *
 * Server-side configuration for generic admin shell regions. Product-specific
 * UI, such as chat rails or task inspectors, should plug into these regions
 * through component references instead of being hardcoded in the admin package.
 */

import type { ComponentReference } from "./common.js";

export type AdminShellRailPlacement = "left" | "right";

export interface AdminShellRouteRules {
	/**
	 * Route prefixes or exact paths where this region should render.
	 * Relative values are resolved against the admin base path.
	 * Empty/omitted include means all admin routes.
	 */
	include?: string[];
	/** Route prefixes or exact paths where this region should be hidden. */
	exclude?: string[];
	/** How include/exclude rules are matched. Defaults to "prefix". */
	match?: "prefix" | "exact";
}

export interface ServerAdminShellRailConfig {
	/** Client component reference rendered inside the shell rail. */
	component: ComponentReference;
	/**
	 * Where to place the rail relative to the main content.
	 * "left" renders between the primary sidebar and content.
	 * @default "left"
	 */
	placement?: AdminShellRailPlacement;
	/** CSS width. Numbers are treated as pixels. */
	width?: number | string;
	/** CSS min-width. Numbers are treated as pixels. */
	minWidth?: number | string;
	/** CSS max-width. Numbers are treated as pixels. */
	maxWidth?: number | string;
	/** Hide the rail below the md breakpoint. Defaults to true. */
	hiddenOnMobile?: boolean;
	/** Optional route rules controlling where this rail appears. */
	routes?: AdminShellRouteRules;
	/** Additional class name for the rail container. */
	className?: string;
}

export interface ServerAdminShellConfig {
	/**
	 * Secondary side region for contextual app UI, such as recent work,
	 * conversations, inspectors, or project switchers.
	 */
	secondaryRail?: ServerAdminShellRailConfig;
}
