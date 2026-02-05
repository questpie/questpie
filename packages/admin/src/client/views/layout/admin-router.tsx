/**
 * AdminRouter Component
 *
 * Handles routing for the admin UI based on URL segments.
 * Uses the view registry to resolve list/edit views dynamically.
 *
 * URL Patterns:
 * - /admin -> Dashboard
 * - /admin/collections/:name -> Collection list
 * - /admin/collections/:name/create -> Collection create
 * - /admin/collections/:name/:id -> Collection edit
 * - /admin/globals/:name -> Global edit
 * - /admin/:customPage -> Custom pages
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import type {
	ComponentRegistry,
	DashboardConfig,
	DefaultViewsConfig,
	PageDefinition,
} from "../../builder";
import { Card } from "../../components/index.js";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { parsePrefillParams } from "../../hooks/use-prefill-params";
import { useAdminStore } from "../../runtime/provider";
import FormView from "../collection/form-view";
import TableView from "../collection/table-view";
import { DashboardGrid } from "../dashboard/dashboard-grid";
import GlobalFormView from "../globals/global-form-view";

// ============================================================================
// Types
// ============================================================================

/**
 * Collection config as used by AdminRouter.
 * Compatible with CollectionBuilderState from admin.getCollections().
 */
export type CollectionRouterConfig = Record<string, any>;

/**
 * Global config as used by AdminRouter.
 * Compatible with GlobalBuilderState from admin.getGlobals().
 */
export type GlobalRouterConfig = Record<string, any>;

export interface AdminRouterProps {
	/**
	 * Current route segments (parsed from URL after /admin)
	 * Example: ["collections", "posts", "123"] for /admin/collections/posts/123
	 */
	segments: string[];

	/**
	 * Navigate function (router-specific)
	 */
	navigate: (path: string) => void;

	/**
	 * Base path for admin routes (default: "/admin")
	 */
	basePath?: string;

	/**
	 * Current URL search params (for prefill support)
	 * If not provided, reads from window.location.search
	 */
	searchParams?: URLSearchParams;

	/**
	 * Collection configurations.
	 * Accepts CollectionBuilderState objects from admin.getCollections()
	 */
	collections?: Record<string, CollectionRouterConfig>;

	/**
	 * Global configurations.
	 * Accepts GlobalBuilderState objects from admin.getGlobals()
	 */
	globals?: Record<string, GlobalRouterConfig>;

	/**
	 * Custom pages
	 */
	pages?: Record<string, PageDefinition<string>>;

	/**
	 * Dashboard component (legacy - use dashboardConfig instead)
	 */
	DashboardComponent?: React.ComponentType;

	/**
	 * Dashboard configuration (widgets, title, etc.)
	 */
	dashboardConfig?: DashboardConfig;

	/**
	 * Default views configuration
	 */
	defaultViews?: DefaultViewsConfig;

	/**
	 * Custom collection components (override default views)
	 */
	collectionComponents?: Record<
		string,
		{
			List?: React.ComponentType;
			Form?: React.ComponentType;
		}
	>;

	/**
	 * Custom global components
	 */
	globalComponents?: Record<
		string,
		{
			Form?: React.ComponentType;
		}
	>;

	/**
	 * Render custom form fields for collection
	 */
	renderFormFields?: (collection: string) => React.ReactNode;

	/**
	 * Component registry
	 */
	registry?: ComponentRegistry;

	/**
	 * Not found component
	 */
	NotFoundComponent?: React.ComponentType;
}

// ============================================================================
// Internal Hook - Resolve props from store
// ============================================================================

function useRouterProps(props: {
	collections?: Record<string, CollectionRouterConfig>;
	globals?: Record<string, GlobalRouterConfig>;
	pages?: Record<string, PageDefinition<string>>;
	dashboardConfig?: DashboardConfig;
	DashboardComponent?: React.ComponentType;
	defaultViews?: DefaultViewsConfig;
}): {
	collections: Record<string, CollectionRouterConfig>;
	globals: Record<string, GlobalRouterConfig>;
	pages: Record<string, PageDefinition<string>>;
	dashboardConfig?: DashboardConfig;
	DashboardComponent?: React.ComponentType;
	defaultViews?: DefaultViewsConfig;
} {
	// Subscribe to admin from store reactively
	const admin = useAdminStore((s) => s.admin);

	// Fetch server-side admin config for dashboard
	const { data: serverConfig } = useAdminConfig();

	const storeCollections = admin.getCollections();
	const storeGlobals = admin.getGlobals();
	const storePages = admin.getPages();
	const storeDashboard = admin.getDashboard();
	const storeDefaultViews = admin.getDefaultViews();

	// Server dashboard takes priority when it has items; otherwise fall back to local config
	const mergedDashboard = React.useMemo<DashboardConfig | undefined>(() => {
		const serverDashboard = serverConfig?.dashboard;

		// If server has items, use server config entirely
		if (serverDashboard?.items?.length) {
			return serverDashboard as DashboardConfig;
		}

		// Otherwise fall back to local config
		return props.dashboardConfig ?? storeDashboard;
	}, [props.dashboardConfig, storeDashboard, serverConfig?.dashboard]);

	return {
		collections: props.collections ?? storeCollections,
		globals: props.globals ?? storeGlobals,
		pages: props.pages ?? storePages,
		dashboardConfig: mergedDashboard,
		DashboardComponent:
			props.DashboardComponent ?? (storeDashboard as any)?.component,
		defaultViews: props.defaultViews ?? storeDefaultViews,
	};
}

// ============================================================================
// Route Matching
// ============================================================================

type RouteMatch =
	| { type: "dashboard" }
	| { type: "collection-list"; name: string }
	| { type: "collection-create"; name: string }
	| { type: "collection-edit"; name: string; id: string }
	| { type: "global-edit"; name: string }
	| { type: "page"; name: string; config: PageDefinition<string> }
	| { type: "not-found" };

function matchRoute(
	segments: string[],
	_collections: Record<string, unknown> = {},
	globals: Record<string, unknown> = {},
	pages: Record<string, PageDefinition<string>> = {},
): RouteMatch {
	if (segments.length === 0) {
		return { type: "dashboard" };
	}

	const [first, second, third] = segments;

	// Collections: /collections/:name/...
	if (first === "collections" && second) {
		if (!third) {
			return { type: "collection-list", name: second };
		}
		if (third === "create") {
			return { type: "collection-create", name: second };
		}
		return { type: "collection-edit", name: second, id: third };
	}

	// Globals: /globals/:name
	if (first === "globals" && second && globals[second]) {
		return { type: "global-edit", name: second };
	}

	// Custom pages
	for (const [name, config] of Object.entries(pages)) {
		if (!config?.path) continue;
		const pagePath = config.path.replace(/^\//, "");
		if (first === pagePath || segments.join("/") === pagePath) {
			return { type: "page", name, config };
		}
	}

	return { type: "not-found" };
}

// ============================================================================
// Sub-components
// ============================================================================

function DefaultDashboard({
	config,
}: {
	config?: DefaultViewsConfig["dashboard"];
}) {
	const date = new Date().toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<div className="container ">
			<div className="mb-8 flex items-end justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">
						{config?.header?.title || "Dashboard"}
					</h1>
					{config?.header?.showDate !== false && (
						<p className="text-muted-foreground mt-1 font-mono text-xs uppercase tracking-widest">
							{date}
						</p>
					)}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<Card className="relative overflow-hidden p-6">
					<div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-primary/10 blur-3xl" />
					<div className="relative">
						<div className="mb-4 flex items-center gap-3">
							<div className="h-2 w-2 rounded-full bg-primary glow-primary-sm" />
							<h3 className="font-mono text-xs font-bold uppercase tracking-widest text-primary">
								System Status
							</h3>
						</div>
						<h2 className="mb-2 text-xl font-bold">
							{config?.welcomeCard?.title || "Welcome back"}
						</h2>
						<p className="text-sm leading-relaxed text-muted-foreground">
							{config?.welcomeCard?.description ||
								"Select a collection from the sidebar to manage your content."}
						</p>
					</div>
				</Card>
			</div>
		</div>
	);
}

function DefaultNotFound() {
	return (
		<div className="container ">
			<h1 className="mb-4 text-2xl font-bold">Page Not Found</h1>
			<p className="text-muted-foreground">
				The page you're looking for doesn't exist.
			</p>
		</div>
	);
}

function LazyPageRenderer({ config }: { config: PageDefinition<string> }) {
	const [Component, setComponent] = React.useState<React.ComponentType | null>(
		null,
	);
	const [loading, setLoading] = React.useState(true);
	const [error, setError] = React.useState<Error | null>(null);

	React.useEffect(() => {
		let mounted = true;

		async function load() {
			try {
				if (typeof config.component === "function") {
					const result = (config.component as () => any)();
					if (result?.then) {
						const mod = await result;
						if (mounted) {
							setComponent(() => mod.default || mod);
						}
					} else {
						if (mounted) {
							setComponent(() => config.component as React.ComponentType);
						}
					}
				} else if (config.component) {
					if (mounted) {
						setComponent(() => config.component as React.ComponentType);
					}
				}
			} catch (err) {
				if (mounted) {
					setError(err instanceof Error ? err : new Error("Failed to load"));
				}
			} finally {
				if (mounted) {
					setLoading(false);
				}
			}
		}

		load();
		return () => {
			mounted = false;
		};
	}, [config.component]);

	if (loading) {
		return (
			<div className="flex h-64 items-center justify-center text-muted-foreground">
				<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="container ">
				<h1 className="mb-4 text-2xl font-bold text-destructive">Error</h1>
				<p className="text-muted-foreground">{error.message}</p>
			</div>
		);
	}

	return Component ? <Component /> : <DefaultNotFound />;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * AdminRouter Component
 *
 * Routes to the appropriate view based on URL segments.
 * Uses the view registry to resolve list/edit views dynamically.
 *
 * When used inside AdminProvider, collections/globals/pages are automatically
 * read from context if not provided as props.
 *
 * @example
 * ```tsx
 * // With AdminProvider (automatic)
 * <AdminProvider admin={admin} client={client}>
 *   <AdminRouter segments={segments} navigate={navigate} />
 * </AdminProvider>
 *
 * // Without AdminProvider (manual)
 * <AdminRouter
 *   segments={segments}
 *   navigate={navigate}
 *   collections={collections}
 *   globals={globals}
 * />
 * ```
 */
export function AdminRouter({
	segments,
	navigate,
	basePath = "/admin",
	searchParams: searchParamsProp,
	collections: collectionsProp,
	globals: globalsProp,
	pages: pagesProp,
	DashboardComponent: DashboardComponentProp,
	dashboardConfig: dashboardConfigProp,
	defaultViews: defaultViewsProp,
	collectionComponents = {},
	globalComponents = {},
	renderFormFields,
	registry,
	NotFoundComponent,
}: AdminRouterProps): React.ReactElement {
	// Get search params (from prop or window.location)
	const searchParams = React.useMemo(() => {
		if (searchParamsProp) return searchParamsProp;
		if (typeof window !== "undefined") {
			return new URLSearchParams(window.location.search);
		}
		return new URLSearchParams();
	}, [searchParamsProp]);

	// Parse prefill params from URL
	const prefillValues = React.useMemo(
		() => parsePrefillParams(searchParams),
		[searchParams],
	);

	// Resolve props from store or use provided values
	const {
		collections,
		globals,
		pages,
		dashboardConfig,
		DashboardComponent,
		defaultViews,
	} = useRouterProps({
		collections: collectionsProp,
		globals: globalsProp,
		pages: pagesProp,
		dashboardConfig: dashboardConfigProp,
		DashboardComponent: DashboardComponentProp,
		defaultViews: defaultViewsProp,
	});

	const route = matchRoute(segments, collections, globals, pages);

	// Dashboard
	if (route.type === "dashboard") {
		// Priority 1: defaultViews.dashboard.component
		if (defaultViews?.dashboard?.component) {
			const Component = defaultViews.dashboard.component;
			return <Component />;
		}

		// Priority 2: Legacy DashboardComponent prop
		if (DashboardComponent) {
			return <DashboardComponent />;
		}

		// Priority 3: DashboardGrid (if items or widgets exist)
		if (dashboardConfig?.items?.length || dashboardConfig?.widgets?.length) {
			return (
				<DashboardGrid
					config={dashboardConfig}
					basePath={basePath}
					navigate={navigate}
				/>
			);
		}

		// Priority 4: Default Dashboard
		return <DefaultDashboard config={defaultViews?.dashboard} />;
	}

	// Collection List - use TableView from registry
	if (route.type === "collection-list") {
		const { name } = route;
		const config = collections[name];
		const custom = collectionComponents[name];

		// Priority 1: Custom component override
		if (custom?.List) {
			return <custom.List />;
		}

		// Priority 2: TableView from registry (default list view)
		// Key forces remount when collection changes to reset all internal state
		return (
			<TableView
				key={name}
				collection={name}
				config={config}
				navigate={navigate}
				basePath={basePath}
				showSearch={defaultViews?.collectionList?.showSearch}
				showFilters={defaultViews?.collectionList?.showFilters}
				showToolbar={defaultViews?.collectionList?.showToolbar}
				realtime={defaultViews?.collectionList?.realtime}
			/>
		);
	}

	// Collection Create/Edit - use FormView from registry
	if (route.type === "collection-create" || route.type === "collection-edit") {
		const { name } = route;
		const id = route.type === "collection-edit" ? route.id : undefined;
		const config = collections[name];
		const custom = collectionComponents[name];
		const formDefaults = defaultViews?.collectionForm;

		// Priority 1: Custom component override
		if (custom?.Form) {
			return <custom.Form />;
		}

		// Only apply prefill values when creating (not editing)
		const defaultValues =
			route.type === "collection-create" &&
			Object.keys(prefillValues).length > 0
				? prefillValues
				: undefined;

		// Priority 2: FormView from registry (default edit view)
		// Key forces remount when collection/id changes to reset all internal state
		return (
			<FormView
				key={`${name}-${id ?? "create"}`}
				collection={name}
				id={id}
				config={config}
				navigate={navigate}
				basePath={basePath}
				defaultValues={defaultValues}
				registry={registry}
				allCollectionsConfig={collections}
				showMeta={formDefaults?.showMeta}
			/>
		);
	}

	// Global Edit
	if (route.type === "global-edit") {
		const { name } = route;
		const config = globals[name];
		const custom = globalComponents[name];

		if (custom?.Form) {
			return <custom.Form />;
		}

		// Key forces remount when global changes to reset all internal state
		return (
			<GlobalFormView
				key={name}
				global={name}
				config={config}
				navigate={navigate}
				basePath={basePath}
				registry={registry}
				allGlobalsConfig={globals}
			/>
		);
	}

	// Custom Page
	if (route.type === "page") {
		return <LazyPageRenderer config={route.config} />;
	}

	// Not Found
	const NotFound = NotFoundComponent || DefaultNotFound;
	return <NotFound />;
}
