/**
 * useAdminRoutes Hook
 *
 * React hook for type-safe admin route navigation.
 * Uses the AdminProvider context to get the current admin configuration.
 */

import type { Questpie } from "questpie";
import * as React from "react";
import {
	selectAdmin,
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../runtime";
import {
	type AdminRoutes,
	type CollectionNames,
	createAdminRoutes,
	createNavigator,
	type GlobalNames,
} from "../utils/routes";

// ============================================================================
// Types
// ============================================================================

interface UseAdminRoutesOptions {
	/** Override the base path (default: from context or "/admin") */
	basePath?: string;
}

interface UseAdminRoutesResult<TApp extends Questpie<any>> {
	/** Routes builder */
	routes: AdminRoutes<TApp>;

	/** Navigate to dashboard */
	toDashboard: () => void;

	/** Navigate to collection list */
	toCollection: <K extends CollectionNames<TApp>>(collection: K) => void;

	/** Navigate to collection create */
	toCollectionCreate: <K extends CollectionNames<TApp>>(collection: K) => void;

	/** Navigate to collection edit */
	toCollectionEdit: <K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
	) => void;

	/** Navigate to global edit */
	toGlobal: <K extends GlobalNames<TApp>>(global: K) => void;

	/** Navigate to custom page */
	toPage: (pageId: string) => void;

	/** Get dashboard URL */
	dashboardUrl: () => string;

	/** Get collection list URL */
	collectionUrl: <K extends CollectionNames<TApp>>(collection: K) => string;

	/** Get collection create URL */
	collectionCreateUrl: <K extends CollectionNames<TApp>>(
		collection: K,
	) => string;

	/** Get collection edit URL */
	collectionEditUrl: <K extends CollectionNames<TApp>>(
		collection: K,
		id: string,
	) => string;

	/** Get global edit URL */
	globalUrl: <K extends GlobalNames<TApp>>(global: K) => string;

	/** Get custom page URL */
	pageUrl: (pageId: string) => string | null;

	/** Get all page URLs */
	allPageUrls: () => Record<string, string>;

	/** Parse current pathname */
	parse: AdminRoutes<TApp>["parse"];

	/** Check if pathname matches */
	matches: AdminRoutes<TApp>["matches"];
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for type-safe admin route navigation
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { toDashboard, toCollection, toCollectionEdit } = useAdminRoutes<App>()
 *
 *   return (
 *     <div>
 *       <button onClick={toDashboard}>Dashboard</button>
 *       <button onClick={() => toCollection('posts')}>View Posts</button>
 *       <button onClick={() => toCollectionEdit('posts', '123')}>Edit Post</button>
 *     </div>
 *   )
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Get URLs without navigating
 * function LinkList() {
 *   const { collectionUrl, globalUrl, pageUrl } = useAdminRoutes<App>()
 *
 *   return (
 *     <nav>
 *       <a href={collectionUrl('posts')}>Posts</a>
 *       <a href={collectionUrl('users')}>Users</a>
 *       <a href={globalUrl('siteSettings')}>Settings</a>
 *       <a href={pageUrl('analytics') ?? '#'}>Analytics</a>
 *     </nav>
 *   )
 * }
 * ```
 */
export function useAdminRoutes<TApp extends Questpie<any>>(
	options: UseAdminRoutesOptions = {},
): UseAdminRoutesResult<TApp> {
	const admin = useAdminStore(selectAdmin);
	const storeBasePath = useAdminStore(selectBasePath);
	const storeNavigate = useAdminStore(selectNavigate);

	const basePath = options.basePath ?? storeBasePath;

	// Create routes builder (memoized)
	const routes = React.useMemo(
		() => createAdminRoutes<TApp>(admin, { basePath }),
		[admin, basePath],
	);

	// Get navigate function from store
	const navigate = storeNavigate;

	// Create navigator (memoized)
	const nav = React.useMemo(
		() => createNavigator(routes, navigate),
		[routes, navigate],
	);

	return {
		routes,

		// Navigation functions
		toDashboard: nav.dashboard,
		toCollection: nav.collection,
		toCollectionCreate: nav.collectionCreate,
		toCollectionEdit: nav.collectionEdit,
		toGlobal: nav.global,
		toPage: nav.page,

		// URL getters
		dashboardUrl: routes.dashboard,
		collectionUrl: routes.collections.list,
		collectionCreateUrl: routes.collections.create,
		collectionEditUrl: routes.collections.edit,
		globalUrl: routes.globals.edit,
		pageUrl: routes.pages.byId,
		allPageUrls: routes.pages.all,

		// Parsing & matching
		parse: routes.parse,
		matches: routes.matches,
	};
}

// ============================================================================
// Standalone Hook (no context required)
// ============================================================================

/**
 * Hook for type-safe admin routes without requiring AdminProvider context
 *
 * @example
 * ```tsx
 * import { barbershopAdmin } from './configs/admin'
 *
 * function MyComponent() {
 *   const navigate = useNavigate() // from your router
 *   const { routes, go } = useAdminRoutesStandalone({
 *     admin: barbershopAdmin,
 *     basePath: '/admin',
 *     navigate,
 *   })
 *
 *   return <button onClick={go.dashboard}>Dashboard</button>
 * }
 * ```
 */
function useAdminRoutesStandalone<TApp extends Questpie<any>>(options: {
	admin: import("../builder/admin").Admin;
	basePath?: string;
	navigate: (path: string) => void;
}) {
	const { admin, basePath = "/admin", navigate } = options;

	const routes = React.useMemo(
		() => createAdminRoutes<TApp>(admin, { basePath }),
		[admin, basePath],
	);

	const go = React.useMemo(
		() => createNavigator(routes, navigate),
		[routes, navigate],
	);

	return { routes, go };
}

// ============================================================================
// Link Component Helper
// ============================================================================

/**
 * Props for admin link components
 */
export interface AdminLinkProps<TApp extends Questpie<any>> {
	/** Link to dashboard */
	to?: "dashboard";
	/** Link to collection */
	collection?: CollectionNames<TApp>;
	/** Collection action */
	action?: "list" | "create" | "edit";
	/** Item ID for edit action */
	id?: string;
	/** Link to global */
	global?: GlobalNames<TApp>;
	/** Link to custom page by ID */
	pageId?: string;
}

/**
 * Get href for admin link props
 *
 * @example
 * ```tsx
 * function AdminLink<TApp extends Questpie<any>>(
 *   props: AdminLinkProps<TApp> & { children: React.ReactNode }
 * ) {
 *   const { routes } = useAdminRoutes<TApp>()
 *   const href = getAdminLinkHref(routes, props)
 *   return <a href={href}>{props.children}</a>
 * }
 * ```
 */
export function getAdminLinkHref<TApp extends Questpie<any>>(
	routes: AdminRoutes<TApp>,
	props: AdminLinkProps<TApp>,
): string {
	if (props.to === "dashboard") {
		return routes.dashboard();
	}

	if (props.collection) {
		const action = props.action ?? "list";
		if (action === "create") {
			return routes.collections.create(props.collection);
		}
		if (action === "edit" && props.id) {
			return routes.collections.edit(props.collection, props.id);
		}
		return routes.collections.list(props.collection);
	}

	if (props.global) {
		return routes.globals.edit(props.global);
	}

	if (props.pageId) {
		return routes.pages.byId(props.pageId) ?? routes.dashboard();
	}

	return routes.dashboard();
}
