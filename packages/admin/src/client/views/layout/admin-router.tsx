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
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import type { PageDefinition } from "../../builder/page/page.js";
import type { MaybeLazyComponent } from "../../builder/types/common.js";
import type { ComponentRegistry } from "../../builder/types/field-types.js";
import type { DashboardConfig } from "../../builder/types/ui-config.js";
import { Button } from "../../components/ui/button.js";
import { Card } from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { useSuspenseAdminConfig } from "../../hooks/use-admin-config";
import { getCollectionMetaQueryOptions } from "../../hooks/use-collection-meta";
import { useCollectionSchema } from "../../hooks/use-collection-schema";
import { getGlobalMetaQueryOptions } from "../../hooks/use-global-meta";
import { useGlobalSchema } from "../../hooks/use-global-schema";
import { parsePrefillParams } from "../../hooks/use-prefill-params";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import { formatLabel } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime/provider";
import {
	FormViewSkeleton,
	TableViewSkeleton,
} from "../collection/view-skeletons";
import { DashboardGrid } from "../dashboard/dashboard-grid";
import { AdminViewHeader } from "./admin-view-layout";

// ============================================================================
// Constants
// ============================================================================

// Module-level constants for empty objects to avoid recreating on each render
const EMPTY_COLLECTION_COMPONENTS: Record<string, any> = {};
const EMPTY_GLOBAL_COMPONENTS: Record<string, any> = {};
const AUTH_ROUTE_SEGMENTS = new Set([
	"login",
	"forgot-password",
	"reset-password",
	"accept-invite",
	"setup",
]);
const componentLoaderCache = new WeakMap<
	() => Promise<any>,
	React.ComponentType<any>
>();

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
	brandingName?: I18nText;
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
		brandingName: serverConfig?.branding?.name,
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

function formatDocumentTitle(pageTitle: string, appTitle: string): string {
	const title = pageTitle.trim();
	const app = appTitle.trim() || "Admin";

	if (!title || title === app) return app;
	return `${title} | ${app}`;
}

function setDocumentMetaDescription(description: string): void {
	const content = description.trim();
	if (!content) return;

	let meta = document.querySelector<HTMLMetaElement>(
		'meta[name="description"]',
	);

	if (!meta) {
		meta = document.createElement("meta");
		meta.name = "description";
		meta.setAttribute("data-questpie-admin", "true");
		document.head.appendChild(meta);
	}

	meta.content = content;
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

function getCachedComponent(loader: MaybeLazyComponent | undefined) {
	if (!isDynamicImportLoader(loader)) return undefined;
	return componentLoaderCache.get(loader);
}

function cacheComponent(
	loader: MaybeLazyComponent | undefined,
	Component: React.ComponentType<any>,
) {
	if (!isDynamicImportLoader(loader)) return;
	componentLoaderCache.set(loader, Component);
}

function ViewLoadingState({ viewKind }: { viewKind: "list" | "form" }) {
	return viewKind === "list" ? <TableViewSkeleton /> : <FormViewSkeleton />;
}

function UnknownViewState({
	viewKind,
	viewId,
}: {
	viewKind: "list" | "form";
	viewId: string;
}) {
	const { t } = useTranslation();

	return (
		<div className="container">
			<Card className="border-warning/30 bg-warning/5 p-6">
				<h1 className="text-lg font-semibold">
					{t("error.failedToLoadView", { viewType: viewKind })}
				</h1>
				<p className="text-muted-foreground mt-2 text-sm">
					{t("error.unregisteredViewDescription", { viewId })}
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

function AuthPageSkeleton() {
	return (
		<div className="qa-auth-layout bg-background text-foreground relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-8 sm:px-8">
			<div className="qa-auth-layout__shell grid w-full max-w-4xl items-center gap-10 lg:grid-cols-[minmax(220px,280px)_minmax(360px,384px)] lg:gap-16">
				<aside className="qa-auth-layout__brand flex flex-col items-center justify-center gap-8">
					<div className="flex items-center gap-3">
						<Skeleton className="size-9" />
						<Skeleton variant="text" className="h-4 w-36" />
					</div>
					<Skeleton variant="text" className="hidden h-3 w-40 lg:block" />
				</aside>

				<main className="qa-auth-layout__form-panel flex items-center justify-center">
					<Card className="border-border-subtle w-full max-w-sm shadow-none">
						<div className="space-y-5 p-4">
							<div className="space-y-2">
								<Skeleton variant="text" className="h-4 w-20" />
								<Skeleton className="h-10 w-full" />
							</div>
							<div className="space-y-2">
								<Skeleton variant="text" className="h-4 w-24" />
								<Skeleton className="h-10 w-full" />
							</div>
							<Skeleton variant="text" className="h-4 w-28" />
							<Skeleton className="h-10 w-full" />
						</div>
					</Card>
				</main>
			</div>
		</div>
	);
}

function getFallbackForSegments(segments: string[]) {
	const [first, second, third] = segments;

	if (first && AUTH_ROUTE_SEGMENTS.has(first)) {
		return <AuthPageSkeleton />;
	}

	if (first === "collections" && second) {
		return third ? <FormViewSkeleton /> : <TableViewSkeleton />;
	}

	if (first === "globals" && second) {
		return <FormViewSkeleton />;
	}

	return <RouterSkeleton />;
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
	}>(() => {
		const cachedComponent = getCachedComponent(loader);
		return {
			Component: cachedComponent ?? null,
			loading: !cachedComponent,
			error: null,
		};
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

		const cachedComponent = getCachedComponent(loader);
		if (cachedComponent) {
			setState({
				Component: cachedComponent,
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
				cacheComponent(loader, Component);
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
		return <ViewLoadingState viewKind={viewKind} />;
	}

	if (state.error || !state.Component) {
		return <UnknownViewState viewKind={viewKind} viewId={viewId} />;
	}

	const Component = state.Component;

	return (
		<React.Suspense fallback={<ViewLoadingState viewKind={viewKind} />}>
			<Component {...componentProps} />
		</React.Suspense>
	);
}, areRegistryViewRendererPropsEqual);

// ============================================================================
// Sub-components
// ============================================================================

function DefaultDashboard() {
	const { t, formatDate } = useTranslation();
	const date = formatDate(new Date(), {
		weekday: "long",
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return (
		<div className="qa-default-dashboard container">
			<AdminViewHeader
				className="mb-4"
				title={t("dashboard.title")}
				meta={date}
			/>

			<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
				<Card className="p-6">
					<div>
						<div className="mb-4 flex items-center gap-3">
							<div className="bg-primary h-2 w-2 rounded-full" />
							<h3 className="text-muted-foreground font-chrome chrome-meta text-xs font-medium">
								{t("dashboard.systemStatus")}
							</h3>
						</div>
						<h2 className="mb-2 text-xl font-semibold">
							{t("dashboard.welcome")}
						</h2>
						<p className="text-muted-foreground text-sm leading-relaxed">
							{t("dashboard.welcomeDescription")}
						</p>
					</div>
				</Card>
			</div>
		</div>
	);
}

function DefaultNotFound() {
	const { t } = useTranslation();

	return (
		<div className="qa-not-found container">
			<h1 className="mb-4 text-2xl font-bold">{t("error.pageNotFound")}</h1>
			<p className="text-muted-foreground">
				{t("error.pageNotFoundDescription")}
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
	const { t } = useTranslation();

	return (
		<div className="qa-restricted-access container py-12">
			<Card className="mx-auto max-w-lg p-8 text-center">
				<div>
					<div className="bg-muted mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full">
						<Icon
							icon="ph:lock-simple"
							className="text-muted-foreground h-8 w-8"
						/>
					</div>
					<h1 className="mb-2 text-xl font-semibold">
						{t("error.accessRestricted")}
					</h1>
					<p className="text-muted-foreground mb-6 text-sm">
						{t("error.accessRestrictedResourceDescription", { type, name })}
					</p>
					<Button variant="outline" onClick={() => navigate(basePath)}>
						<Icon icon="ph:arrow-left" className="h-4 w-4" />
						{t("error.backToDashboard")}
					</Button>
				</div>
			</Card>
		</div>
	);
}

function LazyPageRenderer({ config }: { config: PageDefinition<string> }) {
	const { t } = useTranslation();
	const component = config.component;
	const [Component, setComponent] = React.useState<React.ComponentType | null>(
		() => getCachedComponent(component as MaybeLazyComponent) ?? null,
	);
	const [loading, setLoading] = React.useState(() => Component == null);
	const [error, setError] = React.useState<Error | null>(null);

	React.useEffect(() => {
		let mounted = true;

		async function load() {
			try {
				const cachedComponent = getCachedComponent(
					component as MaybeLazyComponent,
				);
				if (cachedComponent) {
					if (mounted) {
						setComponent(() => cachedComponent);
						setLoading(false);
						setError(null);
					}
					return;
				}

				if (mounted) {
					setLoading(true);
					setError(null);
				}

				if (typeof component === "function") {
					const result = (component as () => any)();
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
							cacheComponent(component as MaybeLazyComponent, resolved);
							setComponent(() => resolved);
						}
					} else {
						if (mounted) {
							setComponent(() => component as React.ComponentType);
						}
					}
				} else if (component) {
					if (mounted) {
						setComponent(() => component as React.ComponentType);
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
						resolvedError = new Error(t("error.failedToLoad"));
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
	}, [component, t]);

	if (loading) {
		const path = config.path?.replace(/^\//, "") ?? "";
		return AUTH_ROUTE_SEGMENTS.has(path) ? (
			<AuthPageSkeleton />
		) : (
			<RouterSkeleton />
		);
	}

	if (error) {
		return (
			<div className="container">
				<h1 className="text-destructive mb-4 text-2xl font-bold">
					{t("error.unexpectedError")}
				</h1>
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
		<React.Suspense fallback={getFallbackForSegments(props.segments)}>
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
		brandingName,
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

	const { t } = useTranslation();
	const resolveText = useResolveText();

	// Keep browser chrome readable for every admin route.
	React.useEffect(() => {
		const appTitle = resolveText(brandingName, "Admin");
		let pageTitle = t("dashboard.title");
		let metaDescription = pageTitle;

		const resolveResourceLabel = (
			config: Record<string, any> | undefined,
			schemaConfig: Record<string, any> | undefined,
			fallback: string,
		) =>
			resolveText(
				config?.label ?? config?.meta?.label ?? schemaConfig?.label,
				formatLabel(fallback),
			);

		const resolveResourceDescription = (
			config: Record<string, any> | undefined,
			schemaConfig: Record<string, any> | undefined,
		) =>
			resolveText(
				config?.description ??
					config?.meta?.description ??
					schemaConfig?.description,
			).trim();

		switch (route.type) {
			case "dashboard": {
				pageTitle = resolveText(dashboardConfig?.title, t("dashboard.title"));
				metaDescription =
					resolveText(dashboardConfig?.description).trim() || pageTitle;
				break;
			}
			case "collection-list": {
				const config = collections[route.name];
				const schemaConfig = (activeCollectionSchema as any)?.admin?.config;
				const label = resolveResourceLabel(config, schemaConfig, route.name);
				pageTitle = label;
				metaDescription =
					resolveResourceDescription(config, schemaConfig) ||
					t("collection.list", { name: label });
				break;
			}
			case "collection-create": {
				const config = collections[route.name];
				const schemaConfig = (activeCollectionSchema as any)?.admin?.config;
				const label = resolveResourceLabel(config, schemaConfig, route.name);
				pageTitle = `${label}: ${t("common.create")}`;
				metaDescription =
					resolveResourceDescription(config, schemaConfig) ||
					t("collection.create", { name: label });
				break;
			}
			case "collection-edit": {
				const config = collections[route.name];
				const schemaConfig = (activeCollectionSchema as any)?.admin?.config;
				const label = resolveResourceLabel(config, schemaConfig, route.name);
				pageTitle = `${label}: ${t("common.edit")}`;
				metaDescription =
					resolveResourceDescription(config, schemaConfig) ||
					t("collection.edit", { name: label });
				break;
			}
			case "global-edit": {
				const config = globals[route.name];
				const schemaConfig = (activeGlobalSchema as any)?.admin?.config;
				const label = resolveResourceLabel(config, schemaConfig, route.name);
				pageTitle = label;
				metaDescription =
					resolveResourceDescription(config, schemaConfig) || label;
				break;
			}
			case "page": {
				pageTitle = resolveText(route.config.label, formatLabel(route.name));
				metaDescription = pageTitle;
				break;
			}
			case "not-found": {
				pageTitle = t("error.notFound");
				metaDescription = pageTitle;
				break;
			}
		}

		document.title = formatDocumentTitle(pageTitle, appTitle);
		setDocumentMetaDescription(metaDescription || pageTitle);
	}, [
		activeCollectionSchema,
		activeGlobalSchema,
		brandingName,
		collections,
		dashboardConfig,
		globals,
		resolveText,
		route,
		t,
	]);

	// Focus management on route change
	const routeKey = segments.join("/");
	React.useEffect(() => {
		// Move focus to main content area on route change for screen readers
		const main = document.getElementById("main-content");
		if (main) {
			// Use requestAnimationFrame to ensure DOM has updated
			requestAnimationFrame(() => {
				main.focus({ preventScroll: true });
			});
		}
	}, [routeKey]);

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
