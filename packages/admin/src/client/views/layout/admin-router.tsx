/**
 * AdminRouter Component
 *
 * Handles routing for the admin UI based on URL segments.
 * Uses the view registry to resolve list/form views dynamically.
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

import type { PageDefinition } from "../../builder/page/page.js";
import type { MaybeLazyComponent } from "../../builder/types/common.js";
import type { ComponentRegistry } from "../../builder/types/field-types.js";
import type { DashboardConfig } from "../../builder/types/ui-config.js";
import { Card } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useQueryClient } from "@tanstack/react-query";
import { useSuspenseAdminConfig } from "../../hooks/use-admin-config";
import { getCollectionMetaQueryOptions } from "../../hooks/use-collection-meta";
import { useCollectionSchema } from "../../hooks/use-collection-schema";
import { getGlobalMetaQueryOptions } from "../../hooks/use-global-meta";
import { useGlobalSchema } from "../../hooks/use-global-schema";
import { parsePrefillParams } from "../../hooks/use-prefill-params";
import { selectClient, useAdminStore } from "../../runtime/provider";
import { DashboardGrid } from "../dashboard/dashboard-grid";

// ============================================================================
// Constants
// ============================================================================

// Module-level constants for empty objects to avoid recreating on each render
const EMPTY_COLLECTION_COMPONENTS: Record<string, any> = {};
const EMPTY_GLOBAL_COMPONENTS: Record<string, any> = {};

// ============================================================================
// Types
// ============================================================================

/**
 * Collection config as used by AdminRouter.
 * Compatible with CollectionBuilderState from admin.getCollections().
 */
type CollectionRouterConfig = Record<string, any>;

/**
 * Global config as used by AdminRouter.
 * Compatible with GlobalBuilderState from admin.getGlobals().
 */
type GlobalRouterConfig = Record<string, any>;

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
// Internal Hook - Resolve config from store (Suspense-based)
// ============================================================================

interface RouterConfig {
	collections: Record<string, CollectionRouterConfig>;
	globals: Record<string, GlobalRouterConfig>;
	pages: Record<string, PageDefinition<string>>;
	views: Record<string, any>;
	dashboardConfig?: DashboardConfig;
	DashboardComponent?: React.ComponentType;
}

/**
 * Hook that resolves router configuration using Suspense.
 * Suspends until server config is loaded - no loading checks needed.
 */
function useRouterConfig(props: {
	collections?: Record<string, CollectionRouterConfig>;
	globals?: Record<string, GlobalRouterConfig>;
	pages?: Record<string, PageDefinition<string>>;
	dashboardConfig?: DashboardConfig;
	DashboardComponent?: React.ComponentType;
}): RouterConfig {
	// Subscribe to admin from store reactively
	const admin = useAdminStore((s) => s.admin);

	// Fetch server-side admin config (suspends until ready)
	const { data: serverConfig } = useSuspenseAdminConfig();

	const storePages = admin.getPages();
	const storeViews = admin.getViews() as Record<string, any>;

	// Build collection/global configs from server config keys
	// Hidden collections are included - they can be accessed via ResourceSheet
	// but won't appear in navigation (handled by sidebar)
	let serverCollections: Record<string, any>;
	if (props.collections) {
		serverCollections = props.collections;
	} else {
		serverCollections = {};
		if (serverConfig?.collections) {
			for (const [name, meta] of Object.entries(serverConfig.collections)) {
				serverCollections[name] = meta ?? {};
			}
		}
	}

	let serverGlobals: Record<string, any>;
	if (props.globals) {
		serverGlobals = props.globals;
	} else {
		serverGlobals = {};
		if (serverConfig?.globals) {
			for (const [name, meta] of Object.entries(serverConfig.globals)) {
				serverGlobals[name] = meta ?? {};
			}
		}
	}

	// Server dashboard takes priority
	const mergedDashboard = React.useMemo<DashboardConfig | undefined>(() => {
		const serverDashboard = serverConfig?.dashboard;
		if (serverDashboard?.items?.length) {
			return serverDashboard as DashboardConfig;
		}
		return props.dashboardConfig;
	}, [props.dashboardConfig, serverConfig?.dashboard]);

	return {
		collections: serverCollections,
		globals: serverGlobals,
		pages: props.pages ?? storePages,
		views: storeViews,
		dashboardConfig: mergedDashboard,
		DashboardComponent: props.DashboardComponent,
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

/**
 * Find the first registered view of a given kind from the views registry.
 * Used as a fallback when no explicit view is configured on a collection/global.
 */
function findDefaultView(
	views: Record<string, any>,
	kind: "list" | "form",
): string | undefined {
	for (const [name, def] of Object.entries(views)) {
		if (def && typeof def === "object" && def.kind === kind) {
			return name;
		}
	}
	return undefined;
}

function getConfiguredViewName(config: unknown): string | undefined {
	if (!config || typeof config !== "object") return undefined;
	const maybeConfig = config as Record<string, any>;
	if (typeof maybeConfig.view === "string") return maybeConfig.view;
	if (typeof maybeConfig.name === "string") return maybeConfig.name;
	return undefined;
}

function getViewLoader(definition: unknown): MaybeLazyComponent | undefined {
	if (!definition || typeof definition !== "object") return undefined;
	const maybeDefinition = definition as Record<string, any>;
	return maybeDefinition.component as MaybeLazyComponent | undefined;
}

function getViewBaseConfig(
	definition: unknown,
): Record<string, unknown> | undefined {
	if (!definition || typeof definition !== "object") return undefined;
	const maybeDefinition = definition as Record<string, any>;
	const config = maybeDefinition.config as Record<string, unknown> | undefined;

	if (!config || typeof config !== "object") return undefined;
	return config;
}

function mergeViewConfig(
	base: unknown,
	override: unknown,
): Record<string, unknown> | undefined {
	const baseConfig =
		base && typeof base === "object"
			? (base as Record<string, unknown>)
			: undefined;
	const overrideConfig =
		override && typeof override === "object"
			? (override as Record<string, unknown>)
			: undefined;

	if (!baseConfig && !overrideConfig) return undefined;

	return {
		...(baseConfig ?? {}),
		...(overrideConfig ?? {}),
	};
}

function isDynamicImportLoader(
	loader: MaybeLazyComponent | undefined,
): loader is () => Promise<{ default: React.ComponentType<any> }> {
	if (typeof loader !== "function") return false;

	const candidate = loader as any;
	if (candidate.prototype?.isReactComponent || candidate.prototype?.render) {
		return false;
	}

	if (candidate.$$typeof) {
		return false;
	}

	return loader.length === 0;
}

function ViewLoadingState() {
	return (
		<div className="text-muted-foreground flex h-64 items-center justify-center">
			<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
		</div>
	);
}

function UnknownViewState({
	viewKind,
	viewId,
}: {
	viewKind: "list" | "form";
	viewId: string;
}) {
	return (
		<div className="container">
			<Card className="border-warning/30 bg-warning/5 p-6">
				<h1 className="text-lg font-semibold">Unknown {viewKind} view</h1>
				<p className="text-muted-foreground mt-2 text-sm">
					View "{viewId}" is not registered in the admin view registry.
				</p>
			</Card>
		</div>
	);
}

/**
 * Skeleton shown while router config is loading (Suspense fallback)
 */
function RouterSkeleton() {
	return (
		<div className="qa-router-skeleton container space-y-4 py-6">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-10 w-full" />
			<div className="space-y-2">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		</div>
	);
}

function shallowEqualComponentProps(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	if (a === b) {
		return true;
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);

	if (aKeys.length !== bKeys.length) {
		return false;
	}

	for (const key of aKeys) {
		if (a[key] !== b[key]) {
			return false;
		}
	}

	return true;
}

function areRegistryViewRendererPropsEqual(
	prev: {
		loader?: MaybeLazyComponent;
		componentProps: Record<string, unknown>;
		viewKind: "list" | "form";
		viewId: string;
	},
	next: {
		loader?: MaybeLazyComponent;
		componentProps: Record<string, unknown>;
		viewKind: "list" | "form";
		viewId: string;
	},
): boolean {
	if (prev.loader !== next.loader) return false;
	if (prev.viewKind !== next.viewKind) return false;
	if (prev.viewId !== next.viewId) return false;

	return shallowEqualComponentProps(prev.componentProps, next.componentProps);
}

const RegistryViewRenderer = React.memo(function RegistryViewRenderer({
	loader,
	componentProps,
	viewKind,
	viewId,
}: {
	loader?: MaybeLazyComponent;
	componentProps: Record<string, unknown>;
	viewKind: "list" | "form";
	viewId: string;
}) {
	const [state, setState] = React.useState<{
		Component: React.ComponentType<any> | React.LazyExoticComponent<any> | null;
		loading: boolean;
		error: Error | null;
	}>({
		Component: null,
		loading: true,
		error: null,
	});

	React.useEffect(() => {
		if (!loader) {
			setState({ Component: null, loading: false, error: null });
			return;
		}

		if (!isDynamicImportLoader(loader)) {
			setState({
				Component: loader as React.ComponentType<any>,
				loading: false,
				error: null,
			});
			return;
		}

		let mounted = true;
		setState((prev) => ({ ...prev, loading: true, error: null }));

		(async () => {
			try {
				const result = await loader();
				if (!mounted) return;

				let Component: React.ComponentType<any>;
				if (result.default) {
					Component = result.default;
				} else {
					Component = result as unknown as React.ComponentType<any>;
				}
				setState({ Component, loading: false, error: null });
			} catch (error) {
				if (!mounted) return;
				let resolvedError: Error;
				if (error instanceof Error) {
					resolvedError = error;
				} else {
					resolvedError = new Error("Failed to load view component");
				}
				setState({
					Component: null,
					loading: false,
					error: resolvedError,
				});
			}
		})();

		return () => {
			mounted = false;
		};
	}, [loader]);

	if (state.loading) {
		return <ViewLoadingState />;
	}

	if (state.error || !state.Component) {
		return <UnknownViewState viewKind={viewKind} viewId={viewId} />;
	}

	const Component = state.Component;

	return (
		<React.Suspense fallback={<ViewLoadingState />}>
			<Component {...componentProps} />
		</React.Suspense>
	);
}, areRegistryViewRendererPropsEqual);

// ============================================================================
// Sub-components
// ============================================================================

function DefaultDashboard() {
	const date = new Date().toLocaleDateString("en-US", {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<div className="qa-default-dashboard container">
			<div className="mb-8 flex items-end justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
					<p className="text-muted-foreground mt-1 font-mono text-xs tracking-widest uppercase">
						{date}
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<Card className="relative overflow-hidden p-6">
					<div className="bg-primary/10 absolute -top-12 -right-12 h-32 w-32 rounded-full blur-3xl" />
					<div className="relative">
						<div className="mb-4 flex items-center gap-3">
							<div className="bg-primary h-2 w-2 rounded-full" />
							<h3 className="text-primary font-mono text-xs font-bold tracking-widest uppercase">
								System Status
							</h3>
						</div>
						<h2 className="mb-2 text-xl font-bold">Welcome back</h2>
						<p className="text-muted-foreground text-sm leading-relaxed">
							Select a collection from the sidebar to manage your content.
						</p>
					</div>
				</Card>
			</div>
		</div>
	);
}

function DefaultNotFound() {
	return (
		<div className="qa-not-found container">
			<h1 className="mb-4 text-2xl font-bold">Page Not Found</h1>
			<p className="text-muted-foreground">
				The page you're looking for doesn't exist.
			</p>
		</div>
	);
}

function RestrictedAccess({
	type,
	name,
	navigate,
	basePath,
}: {
	type: "collection" | "global";
	name: string;
	navigate: (path: string) => void;
	basePath: string;
}) {
	return (
		<div className="qa-restricted-access container py-12">
			<Card className="relative mx-auto max-w-lg overflow-hidden p-8 text-center">
				<div className="bg-muted absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl" />
				<div className="bg-muted absolute -bottom-16 -left-16 h-40 w-40 rounded-full blur-3xl" />
				<div className="relative">
					<div className="bg-muted mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full">
						<Icon
							icon="ph:lock-simple"
							className="text-muted-foreground h-8 w-8"
						/>
					</div>
					<h1 className="mb-2 text-xl font-semibold">Access Restricted</h1>
					<p className="text-muted-foreground mb-6 text-sm">
						The {type}{" "}
						<span className="text-foreground font-mono">"{name}"</span> is not
						available in the admin panel. It may be hidden or you don't have
						permission to access it.
					</p>
					<button
						type="button"
						onClick={() => navigate(basePath)}
						className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors"
					>
						<Icon icon="ph:arrow-left" className="h-4 w-4" />
						Back to Dashboard
					</button>
				</div>
			</Card>
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
					let isThenable = false;
					if (result != null) {
						if (typeof result.then === "function") {
							isThenable = true;
						}
					}
					if (isThenable) {
						const mod = await result;
						if (mounted) {
							let resolved: React.ComponentType;
							if (mod.default) {
								resolved = mod.default;
							} else {
								resolved = mod;
							}
							setComponent(() => resolved);
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
				if (mounted) {
					setLoading(false);
				}
			} catch (err) {
				if (mounted) {
					let resolvedError: Error;
					if (err instanceof Error) {
						resolvedError = err;
					} else {
						resolvedError = new Error("Failed to load");
					}
					setError(resolvedError);
				}
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
			<div className="text-muted-foreground flex h-64 items-center justify-center">
				<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
			</div>
		);
	}

	if (error) {
		return (
			<div className="container">
				<h1 className="text-destructive mb-4 text-2xl font-bold">Error</h1>
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
 * Uses Suspense internally - shows skeleton while config loads.
 */
export function AdminRouter(props: AdminRouterProps): React.ReactElement {
	return (
		<React.Suspense fallback={<RouterSkeleton />}>
			<AdminRouterInner {...props} />
		</React.Suspense>
	);
}

/**
 * Inner router component that uses Suspense for data loading.
 * Guaranteed to have config loaded when rendering.
 */
function AdminRouterInner({
	segments,
	navigate,
	basePath = "/admin",
	searchParams: searchParamsProp,
	collections: collectionsProp,
	globals: globalsProp,
	pages: pagesProp,
	DashboardComponent: DashboardComponentProp,
	dashboardConfig: dashboardConfigProp,
	collectionComponents,
	globalComponents,
	renderFormFields: _renderFormFields,
	registry,
	NotFoundComponent,
}: AdminRouterProps) {
	const resolvedCollectionComponents =
		collectionComponents ?? EMPTY_COLLECTION_COMPONENTS;
	const resolvedGlobalComponents = globalComponents ?? EMPTY_GLOBAL_COMPONENTS;
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

	// Resolve config using suspense - guaranteed to have data
	const {
		collections,
		globals,
		pages,
		views,
		dashboardConfig,
		DashboardComponent,
	} = useRouterConfig({
		collections: collectionsProp,
		globals: globalsProp,
		pages: pagesProp,
		dashboardConfig: dashboardConfigProp,
		DashboardComponent: DashboardComponentProp,
	});

	const route = React.useMemo(
		() => matchRoute(segments, collections, globals, pages),
		[segments, collections, globals, pages],
	);

	const activeCollectionName =
		route.type === "collection-list" ||
		route.type === "collection-create" ||
		route.type === "collection-edit"
			? route.name
			: "";

	const activeGlobalName = route.type === "global-edit" ? route.name : "";

	// Prefetch collection/global metadata before the view's Suspense boundary.
	// When TableView/FormView call useSuspenseCollectionMeta, data is already cached.
	const queryClient = useQueryClient();
	const client = useAdminStore(selectClient);
	if (activeCollectionName && client) {
		queryClient.prefetchQuery(
			getCollectionMetaQueryOptions(activeCollectionName, client),
		);
	}
	if (activeGlobalName && client) {
		queryClient.prefetchQuery(
			getGlobalMetaQueryOptions(activeGlobalName, client),
		);
	}

	const { data: activeCollectionSchema } = useCollectionSchema(
		activeCollectionName as any,
		{
			enabled: !!activeCollectionName,
		},
	);

	const { data: activeGlobalSchema } = useGlobalSchema(
		activeGlobalName as any,
		{
			enabled: !!activeGlobalName,
		},
	);

	// Focus management + document.title on route change
	const routeKey = segments.join("/");
	React.useEffect(() => {
		// Build document title from route
		let pageTitle = "Admin";
		switch (route.type) {
			case "dashboard":
				pageTitle = "Dashboard";
				break;
			case "collection-list":
				pageTitle = `${route.name} — List`;
				break;
			case "collection-create":
				pageTitle = `${route.name} — Create`;
				break;
			case "collection-edit":
				pageTitle = `${route.name} — Edit`;
				break;
			case "global-edit":
				pageTitle = `${route.name} — Settings`;
				break;
			case "page":
				pageTitle = route.name;
				break;
		}
		document.title = pageTitle;

		// Move focus to main content area on route change for screen readers
		const main = document.getElementById("main-content");
		if (main) {
			// Use requestAnimationFrame to ensure DOM has updated
			requestAnimationFrame(() => {
				main.focus({ preventScroll: true });
			});
		}
	}, [routeKey, route]);

	// Dashboard
	if (route.type === "dashboard") {
		// Priority 1: Legacy DashboardComponent prop
		if (DashboardComponent) {
			return <DashboardComponent />;
		}

		// Priority 2: DashboardGrid (if items or widgets exist)
		if (dashboardConfig?.items?.length || dashboardConfig?.widgets?.length) {
			return (
				<DashboardGrid
					config={dashboardConfig}
					basePath={basePath}
					navigate={navigate}
				/>
			);
		}

		// Priority 3: Default Dashboard
		return <DefaultDashboard />;
	}

	// Collection List
	if (route.type === "collection-list") {
		const { name } = route;
		const config = collections[name];

		// Collection not found - show restricted access
		if (!config) {
			return (
				<RestrictedAccess
					type="collection"
					name={name}
					navigate={navigate}
					basePath={basePath}
				/>
			);
		}

		const custom = resolvedCollectionComponents[name];
		const viewNameFromSchema = (activeCollectionSchema as any)?.admin?.list
			?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.list);
		const selectedListView =
			viewNameFromSchema ??
			viewNameFromConfig ??
			findDefaultView(views, "list");
		const selectedListViewDefinition = views[selectedListView];
		const selectedListViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedListViewDefinition),
			(config as any)?.list?.config ??
				(config as any)?.list ??
				(activeCollectionSchema as any)?.admin?.list,
		);

		const listViewLoader = getViewLoader(selectedListViewDefinition);

		// Kind validation
		if (
			selectedListViewDefinition &&
			(selectedListViewDefinition as any).kind !== "list" &&
			process.env.NODE_ENV !== "production"
		) {
			console.warn(
				`View "${selectedListView}" kind "${(selectedListViewDefinition as any).kind}" != expected "list"`,
			);
		}

		// Priority 1: Custom component override
		if (custom?.List) {
			return <custom.List />;
		}

		// Priority 2: Registry-resolved list view
		const listComponentProps = {
			collection: name,
			config,
			viewConfig: selectedListViewConfig,
			navigate,
			basePath,
		};
		return (
			<RegistryViewRenderer
				key={name}
				loader={listViewLoader}
				viewKind="list"
				viewId={selectedListView}
				componentProps={listComponentProps}
			/>
		);
	}

	// Collection Create/Edit
	if (route.type === "collection-create" || route.type === "collection-edit") {
		const { name } = route;
		const id = route.type === "collection-edit" ? route.id : undefined;
		const config = collections[name];

		// Collection not found - show restricted access
		if (!config) {
			return (
				<RestrictedAccess
					type="collection"
					name={name}
					navigate={navigate}
					basePath={basePath}
				/>
			);
		}

		const custom = resolvedCollectionComponents[name];
		const viewNameFromSchema = (activeCollectionSchema as any)?.admin?.form
			?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.form);
		const selectedFormView =
			viewNameFromSchema ??
			viewNameFromConfig ??
			findDefaultView(views, "form");
		const selectedFormViewDefinition = views[selectedFormView];
		const selectedFormViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedFormViewDefinition),
			(config as any)?.form?.config ??
				(config as any)?.form ??
				(activeCollectionSchema as any)?.admin?.form,
		);

		const formViewLoader = getViewLoader(selectedFormViewDefinition);

		// Kind validation
		if (
			selectedFormViewDefinition &&
			(selectedFormViewDefinition as any).kind !== "form" &&
			process.env.NODE_ENV !== "production"
		) {
			console.warn(
				`View "${selectedFormView}" kind "${(selectedFormViewDefinition as any).kind}" != expected "form"`,
			);
		}

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

		// Priority 2: Registry-resolved form view
		const editComponentProps = {
			collection: name,
			id,
			config,
			viewConfig: selectedFormViewConfig,
			navigate,
			basePath,
			defaultValues,
			registry,
			allCollectionsConfig: collections,
		};
		return (
			<RegistryViewRenderer
				key={`${name}-${id ?? "create"}`}
				loader={formViewLoader}
				viewKind="form"
				viewId={selectedFormView}
				componentProps={editComponentProps}
			/>
		);
	}

	// Global Edit
	if (route.type === "global-edit") {
		const { name } = route;
		const config = globals[name];

		// Global not found (may be hidden or inaccessible)
		if (!config) {
			return (
				<RestrictedAccess
					type="global"
					name={name}
					navigate={navigate}
					basePath={basePath}
				/>
			);
		}

		const custom = resolvedGlobalComponents[name];
		const viewNameFromSchema = (activeGlobalSchema as any)?.admin?.form?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.form);
		const selectedFormView =
			viewNameFromSchema ??
			viewNameFromConfig ??
			findDefaultView(views, "form");
		const selectedFormViewDefinition = views[selectedFormView];
		const selectedFormViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedFormViewDefinition),
			(config as any)?.form?.config ??
				(config as any)?.form ??
				(activeGlobalSchema as any)?.admin?.form,
		);

		const globalViewLoader = getViewLoader(selectedFormViewDefinition);

		// Kind validation
		if (
			selectedFormViewDefinition &&
			(selectedFormViewDefinition as any).kind !== "form" &&
			process.env.NODE_ENV !== "production"
		) {
			console.warn(
				`View "${selectedFormView}" kind "${(selectedFormViewDefinition as any).kind}" != expected "form"`,
			);
		}

		if (custom?.Form) {
			return <custom.Form />;
		}

		const globalComponentProps = {
			global: name,
			config,
			viewConfig: selectedFormViewConfig,
			navigate,
			basePath,
			registry,
			allGlobalsConfig: globals,
		};
		return (
			<RegistryViewRenderer
				key={name}
				loader={globalViewLoader}
				viewKind="form"
				viewId={selectedFormView}
				componentProps={globalComponentProps}
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
