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
	MaybeLazyComponent,
	PageDefinition,
} from "../../builder";
import { Card, Skeleton } from "../../components/index.js";
import { useSuspenseAdminConfig } from "../../hooks/use-admin-config";
import { useCollectionSchema } from "../../hooks/use-collection-schema";
import { useGlobalSchema } from "../../hooks/use-global-schema";
import { parsePrefillParams } from "../../hooks/use-prefill-params";
import { useAdminStore } from "../../runtime/provider";
import { DashboardGrid } from "../dashboard/dashboard-grid";

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
// Internal Hook - Resolve config from store (Suspense-based)
// ============================================================================

interface RouterConfig {
	collections: Record<string, CollectionRouterConfig>;
	globals: Record<string, GlobalRouterConfig>;
	pages: Record<string, PageDefinition<string>>;
	listViews: Record<string, any>;
	editViews: Record<string, any>;
	dashboardConfig?: DashboardConfig;
	DashboardComponent?: React.ComponentType;
	defaultViews?: DefaultViewsConfig;
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
	defaultViews?: DefaultViewsConfig;
}): RouterConfig {
	// Subscribe to admin from store reactively
	const admin = useAdminStore((s) => s.admin);

	// Fetch server-side admin config (suspends until ready)
	const { data: serverConfig } = useSuspenseAdminConfig();

	const storePages = admin.getPages();
	const storeListViews = admin.getListViews() as Record<string, any>;
	const storeEditViews = admin.getEditViews() as Record<string, any>;
	const storeDefaultViews = admin.getDefaultViews();

	// Build collection/global configs from server config keys
	// Hidden collections are included - they can be accessed via ResourceSheet
	// but won't appear in navigation (handled by sidebar)
	const serverCollections = React.useMemo<Record<string, any>>(() => {
		if (props.collections) return props.collections;
		const result: Record<string, any> = {};
		if (serverConfig?.collections) {
			for (const [name, meta] of Object.entries(serverConfig.collections)) {
				result[name] = meta ?? {};
			}
		}
		return result;
	}, [props.collections, serverConfig?.collections]);

	const serverGlobals = React.useMemo<Record<string, any>>(() => {
		if (props.globals) return props.globals;
		const result: Record<string, any> = {};
		if (serverConfig?.globals) {
			for (const [name, meta] of Object.entries(serverConfig.globals)) {
				result[name] = meta ?? {};
			}
		}
		return result;
	}, [props.globals, serverConfig?.globals]);

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
		listViews: storeListViews,
		editViews: storeEditViews,
		dashboardConfig: mergedDashboard,
		DashboardComponent: props.DashboardComponent,
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

const DEFAULT_LIST_VIEW_ID = "table";
const DEFAULT_EDIT_VIEW_ID = "form";

function getConfiguredViewName(config: unknown): string | undefined {
	if (!config || typeof config !== "object") return undefined;
	const maybeConfig = config as Record<string, any>;
	if (typeof maybeConfig.view === "string") return maybeConfig.view;
	if (typeof maybeConfig.name === "string") return maybeConfig.name;
	if (typeof maybeConfig.state?.name === "string")
		return maybeConfig.state.name;
	return undefined;
}

function getViewLoader(definition: unknown): MaybeLazyComponent | undefined {
	if (!definition || typeof definition !== "object") return undefined;
	const maybeDefinition = definition as Record<string, any>;
	return (
		(maybeDefinition.component as MaybeLazyComponent | undefined) ??
		(maybeDefinition.state?.component as MaybeLazyComponent | undefined)
	);
}

function getViewBaseConfig(
	definition: unknown,
): Record<string, unknown> | undefined {
	if (!definition || typeof definition !== "object") return undefined;
	const maybeDefinition = definition as Record<string, any>;
	const config =
		(maybeDefinition["~config"] as Record<string, unknown> | undefined) ??
		(maybeDefinition.state?.["~config"] as Record<string, unknown> | undefined);

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
		<div className="flex h-64 items-center justify-center text-muted-foreground">
			<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
		</div>
	);
}

function UnknownViewState({
	viewKind,
	viewId,
}: {
	viewKind: "list" | "edit";
	viewId: string;
}) {
	return (
		<div className="container ">
			<Card className="border-warning/30 bg-warning/5 p-6">
				<h1 className="text-lg font-semibold">Unknown {viewKind} view</h1>
				<p className="mt-2 text-sm text-muted-foreground">
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
		<div className="container space-y-4 py-6">
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

function RegistryViewRenderer({
	loader,
	componentProps,
	viewKind,
	viewId,
}: {
	loader?: MaybeLazyComponent;
	componentProps: Record<string, unknown>;
	viewKind: "list" | "edit";
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

				const Component = (result.default ||
					result) as React.ComponentType<any>;
				setState({ Component, loading: false, error: null });
			} catch (error) {
				if (!mounted) return;
				setState({
					Component: null,
					loading: false,
					error:
						error instanceof Error
							? error
							: new Error("Failed to load view component"),
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
		<div className="container py-12">
			<Card className="relative mx-auto max-w-lg overflow-hidden p-8 text-center">
				<div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-muted/50 blur-3xl" />
				<div className="absolute -left-16 -bottom-16 h-40 w-40 rounded-full bg-muted/30 blur-3xl" />
				<div className="relative">
					<div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
						<Icon
							icon="ph:lock-simple"
							className="h-8 w-8 text-muted-foreground"
						/>
					</div>
					<h1 className="mb-2 text-xl font-semibold">Access Restricted</h1>
					<p className="mb-6 text-sm text-muted-foreground">
						The {type}{" "}
						<span className="font-mono text-foreground">"{name}"</span> is not
						available in the admin panel. It may be hidden or you don't have
						permission to access it.
					</p>
					<button
						type="button"
						onClick={() => navigate(basePath)}
						className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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

	// Resolve config using suspense - guaranteed to have data
	const {
		collections,
		globals,
		pages,
		listViews,
		editViews,
		dashboardConfig,
		DashboardComponent,
		defaultViews,
	} = useRouterConfig({
		collections: collectionsProp,
		globals: globalsProp,
		pages: pagesProp,
		dashboardConfig: dashboardConfigProp,
		DashboardComponent: DashboardComponentProp,
		defaultViews: defaultViewsProp,
	});

	const route = matchRoute(segments, collections, globals, pages);

	const activeCollectionName =
		route.type === "collection-list" ||
		route.type === "collection-create" ||
		route.type === "collection-edit"
			? route.name
			: "";

	const activeGlobalName = route.type === "global-edit" ? route.name : "";

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

		const custom = collectionComponents[name];
		const viewNameFromSchema = (activeCollectionSchema as any)?.admin?.list
			?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.list);
		const selectedListView =
			viewNameFromSchema ?? viewNameFromConfig ?? DEFAULT_LIST_VIEW_ID;
		const selectedListViewDefinition = listViews[selectedListView];
		const selectedListViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedListViewDefinition),
			(config as any)?.list?.["~config"] ??
				(config as any)?.list ??
				(activeCollectionSchema as any)?.admin?.list,
		);

		const listViewLoader =
			getViewLoader(selectedListViewDefinition) ??
			defaultViews?.collectionList?.component;

		// Priority 1: Custom component override
		if (custom?.List) {
			return <custom.List />;
		}

		// Priority 2: Registry-resolved list view
		return (
			<RegistryViewRenderer
				key={name}
				loader={listViewLoader}
				viewKind="list"
				viewId={selectedListView}
				componentProps={{
					collection: name,
					config,
					viewConfig: selectedListViewConfig,
					navigate,
					basePath,
					showSearch: defaultViews?.collectionList?.showSearch,
					showFilters: defaultViews?.collectionList?.showFilters,
					showToolbar: defaultViews?.collectionList?.showToolbar,
					realtime: defaultViews?.collectionList?.realtime,
				}}
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

		const custom = collectionComponents[name];
		const formDefaults = defaultViews?.collectionForm;
		const viewNameFromSchema = (activeCollectionSchema as any)?.admin?.form
			?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.form);
		const selectedEditView =
			viewNameFromSchema ?? viewNameFromConfig ?? DEFAULT_EDIT_VIEW_ID;
		const selectedEditViewDefinition = editViews[selectedEditView];
		const selectedEditViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedEditViewDefinition),
			(config as any)?.form?.["~config"] ??
				(config as any)?.form ??
				(activeCollectionSchema as any)?.admin?.form,
		);

		const editViewLoader =
			getViewLoader(selectedEditViewDefinition) ?? formDefaults?.component;

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

		// Priority 2: Registry-resolved edit view
		return (
			<RegistryViewRenderer
				key={`${name}-${id ?? "create"}`}
				loader={editViewLoader}
				viewKind="edit"
				viewId={selectedEditView}
				componentProps={{
					collection: name,
					id,
					config,
					viewConfig: selectedEditViewConfig,
					navigate,
					basePath,
					defaultValues,
					registry,
					allCollectionsConfig: collections,
					showMeta: formDefaults?.showMeta,
				}}
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

		const custom = globalComponents[name];
		const viewNameFromSchema = (activeGlobalSchema as any)?.admin?.form?.view;
		const viewNameFromConfig = getConfiguredViewName((config as any)?.form);
		// For globals, only use editViews registry if a custom view is explicitly specified
		// Otherwise, use the dedicated globalForm default view
		const hasCustomViewSpecified = !!(viewNameFromSchema ?? viewNameFromConfig);
		const selectedEditView =
			viewNameFromSchema ?? viewNameFromConfig ?? DEFAULT_EDIT_VIEW_ID;
		const selectedEditViewDefinition = hasCustomViewSpecified
			? editViews[selectedEditView]
			: undefined;
		const selectedEditViewConfig = mergeViewConfig(
			getViewBaseConfig(selectedEditViewDefinition),
			(config as any)?.form?.["~config"] ??
				(config as any)?.form ??
				(activeGlobalSchema as any)?.admin?.form,
		);

		// For globals: prefer defaultViews.globalForm.component (GlobalFormView)
		// Only use editViews registry if a custom view was explicitly specified
		const globalViewLoader =
			(hasCustomViewSpecified
				? getViewLoader(selectedEditViewDefinition)
				: undefined) ?? defaultViews?.globalForm?.component;

		if (custom?.Form) {
			return <custom.Form />;
		}

		return (
			<RegistryViewRenderer
				key={name}
				loader={globalViewLoader}
				viewKind="edit"
				viewId={selectedEditView}
				componentProps={{
					global: name,
					config,
					viewConfig: selectedEditViewConfig,
					navigate,
					basePath,
					registry,
					allGlobalsConfig: globals,
				}}
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
