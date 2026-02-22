/**
 * Type-Safe Admin Routes
 *
 * Utilities for building type-safe routes for admin UI navigation.
 * Accepts the admin config to provide fully type-safe routing.
 */

import type { Questpie } from "questpie";
import type { CollectionNames, GlobalNames, PageDefinition } from "../builder";
import type { Admin } from "../builder/admin";

// ============================================================================
// Types
// ============================================================================

/**
 * Collection route actions
 */
export type CollectionAction = "list" | "create" | "edit" | "view";

/**
 * Parsed route information
 */
export type ParsedRoute<TApp extends Questpie<any>> =
	| { type: "dashboard" }
	| {
			type: "collection";
			collection: CollectionNames<TApp>;
			action: "list" | "create" | "edit";
			id?: string;
	  }
	| { type: "global"; global: GlobalNames<TApp> }
	| {
			type: "page";
			pageId: string;
			path: string;
			config: PageDefinition<string>;
	  }
	| { type: "unknown"; path: string };

/**
 * Admin routes builder result
 */
export interface AdminRoutes<TApp extends Questpie<any>> {
	/** Base path */
	basePath: string;

	/** Dashboard route */
	dashboard: () => string;

	/** Collection routes */
	collections: {
		/** List all items in a collection */
		list: <K extends CollectionNames<TApp>>(collection: K) => string;
		/** Create new item in a collection */
		create: <K extends CollectionNames<TApp>>(collection: K) => string;
		/** Edit/view a specific item */
		edit: <K extends CollectionNames<TApp>>(
			collection: K,
			id: string,
		) => string;
		/** Alias for edit */
		view: <K extends CollectionNames<TApp>>(
			collection: K,
			id: string,
		) => string;
		/** Get route for any action */
		route: <K extends CollectionNames<TApp>>(
			collection: K,
			action: CollectionAction,
			id?: string,
		) => string;
	};

	/** Global routes */
	globals: {
		/** Edit a global */
		edit: <K extends GlobalNames<TApp>>(global: K) => string;
	};

	/** Custom page routes */
	pages: {
		/** Get route for a custom page by ID */
		byId: (pageId: string) => string | null;
		/** Get all page routes as record */
		all: () => Record<string, string>;
		/** Get list of all page IDs */
		ids: () => string[];
	};

	/** Parse current route to determine what's being viewed */
	parse: (pathname: string) => ParsedRoute<TApp>;

	/** Check if a path matches a specific route */
	matches: {
		dashboard: (pathname: string) => boolean;
		collection: <K extends CollectionNames<TApp>>(
			pathname: string,
			collection?: K,
		) => boolean;
		global: <K extends GlobalNames<TApp>>(
			pathname: string,
			global?: K,
		) => boolean;
		page: (pathname: string, pageId?: string) => boolean;
	};

	/** Get URL with query params */
	withQuery: (
		path: string,
		params: Record<string, string | number | boolean | undefined | null>,
	) => string;
}

// ============================================================================
// Route Builder
// ============================================================================

/**
 * Create type-safe admin routes from admin config
 *
 * @example
 * ```tsx
 * import { createAdminRoutes } from '@questpie/admin/utils/routes'
 * import { barbershopAdmin } from './configs/admin'
 *
 * const routes = createAdminRoutes(barbershopAdmin)
 *
 * // Type-safe route generation
 * routes.dashboard()                    // "/admin"
 * routes.collections.list('posts')      // "/admin/collections/posts"
 * routes.collections.create('posts')    // "/admin/collections/posts/create"
 * routes.collections.edit('posts', '1') // "/admin/collections/posts/1"
 * routes.globals.edit('siteSettings')   // "/admin/globals/siteSettings"
 * routes.pages.byId('analytics')        // "/admin/analytics" (from page config)
 *
 * // Parse current route
 * const parsed = routes.parse('/admin/collections/posts/123')
 * // { type: 'collection', collection: 'posts', action: 'edit', id: '123' }
 * ```
 */
export function createAdminRoutes<TApp extends Questpie<any>>(
	admin: Admin,
	options: { basePath?: string } = {},
): AdminRoutes<TApp> {
	const basePath = options.basePath ?? "/admin";
	const pagesConfig = admin.getPages();

	// Build page path lookup
	const pagePathById: Record<string, string> = {};
	const pageIdByPath: Record<string, string> = {};
	const pageConfigByPath: Record<string, PageDefinition<string>> = {};

	for (const [id, config] of Object.entries(pagesConfig)) {
		const configPath = (config as any).path ?? id;
		const pagePath = configPath.startsWith("/")
			? configPath.slice(1)
			: configPath;
		pagePathById[id] = pagePath;
		pageIdByPath[pagePath] = id;
		pageConfigByPath[pagePath] = config as PageDefinition<string>;
	}

	// Helper to join path segments
	const joinPath = (...segments: string[]): string => {
		return segments.filter(Boolean).join("/");
	};

	// Collection routes
	const collections: AdminRoutes<TApp>["collections"] = {
		list: (collection) => joinPath(basePath, "collections", collection),

		create: (collection) =>
			joinPath(basePath, "collections", collection, "create"),

		edit: (collection, id) => joinPath(basePath, "collections", collection, id),

		view: (collection, id) => joinPath(basePath, "collections", collection, id),

		route: (collection, action, id) => {
			switch (action) {
				case "list":
					return collections.list(collection);
				case "create":
					return collections.create(collection);
				case "edit":
				case "view":
					if (!id) throw new Error(`ID required for ${action} action`);
					return collections.edit(collection, id);
				default:
					return collections.list(collection);
			}
		},
	};

	// Global routes
	const globals: AdminRoutes<TApp>["globals"] = {
		edit: (global) => joinPath(basePath, "globals", global),
	};

	// Page routes
	const pages: AdminRoutes<TApp>["pages"] = {
		byId: (pageId) => {
			const pagePath = pagePathById[pageId];
			if (!pagePath) return null;
			return joinPath(basePath, pagePath);
		},

		all: () => {
			const result: Record<string, string> = {};
			for (const [id, path] of Object.entries(pagePathById)) {
				result[id] = joinPath(basePath, path);
			}
			return result;
		},

		ids: () => Object.keys(pagePathById),
	};

	// Parse route
	const parse = (pathname: string): ParsedRoute<TApp> => {
		// Remove trailing slash and base path
		const cleanPath = pathname.replace(/\/$/, "");
		const relativePath = cleanPath.startsWith(basePath)
			? cleanPath.slice(basePath.length)
			: cleanPath;

		// Dashboard
		if (relativePath === "" || relativePath === "/") {
			return { type: "dashboard" };
		}

		const segments = relativePath.split("/").filter(Boolean);

		// Collections: /collections/:name/:action?
		if (segments[0] === "collections" && segments[1]) {
			const collection = segments[1] as CollectionNames<TApp>;

			if (!segments[2]) {
				return { type: "collection", collection, action: "list" };
			}

			if (segments[2] === "create") {
				return { type: "collection", collection, action: "create" };
			}

			return {
				type: "collection",
				collection,
				action: "edit",
				id: segments[2],
			};
		}

		// Globals: /globals/:name
		if (segments[0] === "globals" && segments[1]) {
			return { type: "global", global: segments[1] as GlobalNames<TApp> };
		}

		// Custom pages - check against configured pages
		const pageRelativePath = segments.join("/");
		if (pageIdByPath[pageRelativePath]) {
			return {
				type: "page",
				pageId: pageIdByPath[pageRelativePath],
				path: pageRelativePath,
				config: pageConfigByPath[pageRelativePath],
			};
		}

		// Also check if first segment matches a page
		if (pageIdByPath[segments[0]]) {
			return {
				type: "page",
				pageId: pageIdByPath[segments[0]],
				path: segments[0],
				config: pageConfigByPath[segments[0]],
			};
		}

		// Unknown/custom page
		return { type: "unknown", path: relativePath };
	};

	// Matchers
	const matches: AdminRoutes<TApp>["matches"] = {
		dashboard: (pathname) => {
			const parsed = parse(pathname);
			return parsed.type === "dashboard";
		},

		collection: (pathname, collection?) => {
			const parsed = parse(pathname);
			if (parsed.type !== "collection") return false;
			if (collection && parsed.collection !== collection) return false;
			return true;
		},

		global: (pathname, global?) => {
			const parsed = parse(pathname);
			if (parsed.type !== "global") return false;
			if (global && parsed.global !== global) return false;
			return true;
		},

		page: (pathname, pageId?) => {
			const parsed = parse(pathname);
			if (parsed.type !== "page") return false;
			if (pageId && parsed.pageId !== pageId) return false;
			return true;
		},
	};

	// Query string helper
	const withQuery = (
		path: string,
		params: Record<string, string | number | boolean | undefined | null>,
	): string => {
		return path + buildQueryString(params);
	};

	return {
		basePath,
		dashboard: () => basePath,
		collections,
		globals,
		pages,
		parse,
		matches,
		withQuery,
	};
}

// ============================================================================
// Standalone Route Builder (without admin config)
// ============================================================================

/**
 * Create admin routes without admin config (less type-safe, but works without context)
 *
 * @example
 * ```tsx
 * const routes = createAdminRoutesSimple({ basePath: '/admin' })
 * routes.collections.list('posts')
 * ```
 */
function createAdminRoutesSimple(
	options: { basePath?: string; pages?: Record<string, { path: string }> } = {},
) {
	const basePath = options.basePath ?? "/admin";
	const pagesConfig = options.pages ?? {};

	const joinPath = (...segments: string[]): string => {
		return segments.filter(Boolean).join("/");
	};

	return {
		basePath,
		dashboard: () => basePath,

		collections: {
			list: (collection: string) =>
				joinPath(basePath, "collections", collection),
			create: (collection: string) =>
				joinPath(basePath, "collections", collection, "create"),
			edit: (collection: string, id: string) =>
				joinPath(basePath, "collections", collection, id),
		},

		globals: {
			edit: (global: string) => joinPath(basePath, "globals", global),
		},

		pages: {
			byId: (pageId: string) => {
				const config = pagesConfig[pageId];
				if (!config) return null;
				const path = config.path.startsWith("/")
					? config.path.slice(1)
					: config.path;
				return joinPath(basePath, path);
			},
		},
	};
}

// ============================================================================
// Route Helpers
// ============================================================================

/**
 * Build a query string from params
 */
function buildQueryString(
	params: Record<string, string | number | boolean | undefined | null>,
): string {
	const entries = Object.entries(params)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		);

	return entries.length > 0 ? `?${entries.join("&")}` : "";
}

/**
 * Build a route with query params
 */
function withQuery(
	path: string,
	params: Record<string, string | number | boolean | undefined | null>,
): string {
	return path + buildQueryString(params);
}

/**
 * Extract collection info from a route path
 */
function parseCollectionRoute(
	pathname: string,
	basePath = "/admin",
): {
	collection: string;
	action: "list" | "create" | "edit";
	id?: string;
} | null {
	const cleanPath = pathname.replace(/\/$/, "");
	const relativePath = cleanPath.startsWith(basePath)
		? cleanPath.slice(basePath.length)
		: cleanPath;

	const match = relativePath.match(/^\/collections\/([^/]+)(?:\/([^/]+))?$/);
	if (!match) return null;

	const [, collection, actionOrId] = match;

	if (!actionOrId) {
		return { collection, action: "list" };
	}

	if (actionOrId === "create") {
		return { collection, action: "create" };
	}

	return { collection, action: "edit", id: actionOrId };
}

/**
 * Extract global info from a route path
 */
function parseGlobalRoute(
	pathname: string,
	basePath = "/admin",
): { global: string } | null {
	const cleanPath = pathname.replace(/\/$/, "");
	const relativePath = cleanPath.startsWith(basePath)
		? cleanPath.slice(basePath.length)
		: cleanPath;

	const match = relativePath.match(/^\/globals\/([^/]+)$/);
	if (!match) return null;

	return { global: match[1] };
}

// ============================================================================
// Navigation Helpers
// ============================================================================

/**
 * Create a navigation helper function
 *
 * @example
 * ```tsx
 * const routes = createAdminRoutes(admin)
 * const go = createNavigator(routes, navigate)
 *
 * // Navigate to routes
 * go.dashboard()
 * go.collection('posts')
 * go.collectionCreate('posts')
 * go.collectionEdit('posts', '123')
 * go.global('siteSettings')
 * go.page('analytics')
 * ```
 */
export function createNavigator<TApp extends Questpie<any>>(
	routes: AdminRoutes<TApp>,
	navigate: (path: string) => void,
) {
	return {
		/** Navigate to dashboard */
		dashboard: () => navigate(routes.dashboard()),

		/** Navigate to collection list */
		collection: <K extends CollectionNames<TApp>>(collection: K) =>
			navigate(routes.collections.list(collection)),

		/** Navigate to collection create */
		collectionCreate: <K extends CollectionNames<TApp>>(collection: K) =>
			navigate(routes.collections.create(collection)),

		/** Navigate to collection edit */
		collectionEdit: <K extends CollectionNames<TApp>>(
			collection: K,
			id: string,
		) => navigate(routes.collections.edit(collection, id)),

		/** Navigate to global edit */
		global: <K extends GlobalNames<TApp>>(global: K) =>
			navigate(routes.globals.edit(global)),

		/** Navigate to custom page */
		page: (pageId: string) => {
			const path = routes.pages.byId(pageId);
			if (path) navigate(path);
		},

		/** Navigate to any path */
		to: (path: string) => navigate(path),
	};
}

// ============================================================================
// Type Exports
// ============================================================================

export type { CollectionNames, GlobalNames } from "../builder";
