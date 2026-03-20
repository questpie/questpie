/**
 * AdminLayoutProvider Component
 *
 * Universal layout wrapper that works with any router.
 * Provides AdminProvider + AdminLayout and renders children.
 *
 * @example Next.js (App Router)
 * ```tsx
 * // app/admin/layout.tsx
 * export default function AdminLayout({ children }) {
 *   return (
 *     <AdminLayoutProvider
 *       admin={myAdmin}
 *       client={cmsClient}
 *       authClient={authClient}
 *       LinkComponent={Link}
 *     >
 *       {children}
 *     </AdminLayoutProvider>
 *   );
 * }
 * ```
 *
 * @example TanStack Router
 * ```tsx
 * // routes/admin.tsx
 * function AdminLayout() {
 *   return (
 *     <AdminLayoutProvider
 *       admin={myAdmin}
 *       client={cmsClient}
 *       authClient={authClient}
 *       LinkComponent={Link}
 *     >
 *       <Outlet />
 *     </AdminLayoutProvider>
 *   );
 * }
 * ```
 *
 * @example With Auth Protection
 * ```tsx
 * <AdminLayoutProvider
 *   admin={myAdmin}
 *   client={cmsClient}
 *   authClient={authClient}
 *   enableAuthGuard={true}
 *   publicPaths={["/admin/login", "/admin/forgot-password"]}
 *   requiredRole="admin"
 * >
 *   {children}
 * </AdminLayoutProvider>
 * ```
 */

import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QuestpieClient } from "questpie/client";
import type * as React from "react";

import { Admin, type AdminInput } from "../../builder/admin";
import { AuthGuard } from "../../components/auth";
import { getAdminConfigQueryOptions } from "../../hooks/use-admin-config";
import { AdminProvider } from "../../runtime/provider";
import {
	getAdminLocalesQueryOptions,
	getAdminTranslationsQueryOptions,
	getUiLocaleFromCookie,
} from "../../runtime/translations-provider";
import { AdminLayout, type AdminLayoutSharedProps } from "./admin-layout";

// ============================================================================
// Types
// ============================================================================

interface AdminLayoutProviderProps extends AdminLayoutSharedProps {
	/**
	 * Admin configuration - pass plain AdminState or Admin instance.
	 *
	 * @example
	 * ```tsx
	 * // Recommended: pass builder directly
	 * <AdminLayoutProvider admin={admin} ... />
	 *
	 * // Also works (backward compatible)
	 * <AdminLayoutProvider admin={Admin.from(admin)} ... />
	 * ```
	 */
	admin: AdminInput<any>;

	/**
	 * API client for data fetching
	 */
	client: QuestpieClient<any>;

	/**
	 * Auth client for authentication (created via createAdminAuthClient)
	 */
	authClient?: any;

	/**
	 * Optional QueryClient instance (will create one if not provided)
	 */
	queryClient?: QueryClient;

	// =========================================================================
	// Auth Guard Options
	// =========================================================================

	/**
	 * Enable authentication guard for protected routes.
	 * When true, checks if user is authenticated before rendering content.
	 * @default true if authClient is provided
	 */
	enableAuthGuard?: boolean;

	/**
	 * Paths that don't require authentication.
	 * Use relative paths from basePath (e.g., "/login" for "/admin/login").
	 * @default ["/login", "/forgot-password", "/reset-password", "/accept-invite"]
	 */
	publicPaths?: string[];

	/**
	 * Required role for accessing protected routes.
	 * @default "admin"
	 */
	requiredRole?: string;

	/**
	 * Custom loading component while checking authentication.
	 */
	authLoadingFallback?: React.ReactNode;

	/**
	 * Custom unauthorized component (instead of redirecting to login).
	 */
	authUnauthorizedFallback?: React.ReactNode;

	// =========================================================================
	// i18n Options
	// =========================================================================

	/**
	 * Use server-side translations (fetched via getAdminTranslations RPC).
	 * When true, translations are fetched from the server configured via
	 * .adminLocale() and config translations.
	 *
	 * @default false (for backwards compatibility)
	 *
	 * @example
	 * ```tsx
	 * // Server configures locales and messages
	 * const app = runtimeConfig({
	 *   modules: [adminModule],
	 *   adminLocale: { locales: ["en", "sk"], defaultLocale: "en" },
	 *   messages: { sk: { "common.save": "Ulozit" } },
	 * });
	 *
	 * // Client fetches from server
	 * <AdminLayoutProvider
	 *   admin={admin}
	 *   client={client}
	 *   useServerTranslations
	 * >
	 *   {children}
	 * </AdminLayoutProvider>
	 * ```
	 */
	useServerTranslations?: boolean;

	/**
	 * Fallback element to show while loading server translations.
	 * Only used when useServerTranslations is true.
	 */
	translationsFallback?: React.ReactNode;

	/**
	 * Initial UI locale (admin interface language)
	 * If not provided, reads from cookie or uses default from admin config
	 */
	initialUiLocale?: string;

	/**
	 * Children to render inside the layout
	 * - Next.js: {children} from layout props
	 * - TanStack Router: <Outlet />
	 */
	children: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

import { QueryClient as QueryClientClass } from "@tanstack/react-query";

/** Debounced 401 redirect - prevents multiple redirects from concurrent failures */
let sessionExpiredRedirectPending = false;

function handleSessionExpiredError(error: unknown) {
	if (sessionExpiredRedirectPending) return;

	const status =
		error != null && typeof error === "object" && "status" in error
			? (error as { status: number }).status
			: undefined;

	if (status !== 401) return;

	// Don't redirect if already on a public/login page
	if (typeof window !== "undefined") {
		const path = window.location.pathname;
		if (DEFAULT_PUBLIC_PATHS.some((p) => path.endsWith(p))) return;

		sessionExpiredRedirectPending = true;
		const returnUrl = encodeURIComponent(
			window.location.pathname + window.location.search,
		);
		window.location.href = `${path.replace(/\/[^/]*$/, "")}/login?returnUrl=${returnUrl}`;
	}
}

let cachedQueryClient: QueryClient | undefined;

function getDefaultQueryClient(): QueryClient {
	if (!cachedQueryClient) {
		cachedQueryClient = new QueryClientClass({
			defaultOptions: {
				queries: {
					staleTime: 60 * 1000, // 1 minute
					refetchOnWindowFocus: false, // Admin panel — no silent refetch on tab switch
					retry: (failureCount, error) => {
						// Don't retry on 401 (session expired)
						const status =
							error != null && typeof error === "object" && "status" in error
								? (error as { status: number }).status
								: undefined;
						if (status === 401) return false;
						return failureCount < 3;
					},
				},
				mutations: {
					onError: handleSessionExpiredError,
				},
			},
		});

		// Use global query cache error handler for queries
		cachedQueryClient.getQueryCache().config.onError =
			handleSessionExpiredError;
	}
	return cachedQueryClient;
}

/**
 * Default public paths that don't require authentication
 * These paths also render WITHOUT the admin layout (no sidebar/header)
 */
const DEFAULT_PUBLIC_PATHS = [
	"/login",
	"/forgot-password",
	"/reset-password",
	"/accept-invite",
	"/setup",
];

/**
 * Check if current path matches any public path
 */
function isPublicPath(
	currentPath: string | undefined,
	basePath: string,
	publicPaths: string[],
): boolean {
	if (!currentPath) return false;

	// Normalize paths
	const normalizedCurrent = currentPath.replace(/\/+$/, "");
	const normalizedBase = basePath.replace(/\/+$/, "");

	for (const publicPath of publicPaths) {
		// Build full public path
		const fullPublicPath = `${normalizedBase}${publicPath}`.replace(/\/+$/, "");

		// Check exact match or starts with (for nested routes)
		if (
			normalizedCurrent === fullPublicPath ||
			normalizedCurrent.startsWith(`${fullPublicPath}/`)
		) {
			return true;
		}
	}

	return false;
}

/**
 * AdminLayoutProvider Component
 *
 * Universal wrapper for admin layout that works with any router.
 * Handles all the provider setup and renders children inside the layout.
 */
export function AdminLayoutProvider({
	admin: adminInput,
	client,
	authClient,
	queryClient,
	// Shared layout props
	LinkComponent,
	activeRoute,
	basePath = "/admin",
	header,
	footer,
	sidebarProps,
	theme,
	setTheme,
	showThemeToggle,
	toasterProps,
	className,
	// Auth guard props
	enableAuthGuard,
	publicPaths = DEFAULT_PUBLIC_PATHS,
	requiredRole = "admin",
	authLoadingFallback,
	authUnauthorizedFallback,
	// i18n props
	useServerTranslations,
	translationsFallback,
	initialUiLocale,
	// Children
	children,
}: AdminLayoutProviderProps): React.ReactElement {
	const qc = queryClient ?? getDefaultQueryClient();

	// Prefetch critical data BEFORE any Suspense boundary in the tree.
	// This eliminates the sequential waterfall:
	//   TranslationsProvider suspends → AdminRouter suspends → View suspends
	// By starting all fetches in parallel here, each boundary resolves from
	// cache instead of triggering a new network request.
	// prefetchQuery is idempotent — skips if data is already cached or fetching.
	if ((client as any)?.routes) {
		qc.prefetchQuery(getAdminConfigQueryOptions(client));
		if (useServerTranslations) {
			const locale = initialUiLocale ?? getUiLocaleFromCookie() ?? "en";
			qc.prefetchQuery(getAdminLocalesQueryOptions(client));
			qc.prefetchQuery(getAdminTranslationsQueryOptions(client, locale));
		}
	}

	// Normalize admin input - accepts plain state or Admin instance
	const admin = Admin.normalize(adminInput);

	// Determine if auth guard should be enabled
	// Default: enabled if authClient is provided
	const shouldUseAuthGuard = enableAuthGuard ?? authClient != null;

	// Check if current route is public
	const currentPath =
		activeRoute ??
		(typeof window !== "undefined" ? window.location.pathname : undefined);
	const isCurrentPathPublic = isPublicPath(currentPath, basePath, publicPaths);

	// Determine content based on path type:
	// - Public paths (login, setup, etc.): render children directly (no AdminLayout)
	// - Protected paths: render with AdminLayout + optional AuthGuard
	let innerContent: React.ReactNode;

	if (isCurrentPathPublic) {
		// Public paths render children directly without admin layout (sidebar/header)
		// Auth pages (login, setup) use their own AuthLayout component
		innerContent = children;
	} else {
		// Protected paths get the full admin layout
		const layoutContent = (
			<AdminLayout
				LinkComponent={LinkComponent}
				activeRoute={activeRoute}
				basePath={basePath}
				header={header}
				footer={footer}
				sidebarProps={sidebarProps}
				theme={theme}
				setTheme={setTheme}
				showThemeToggle={showThemeToggle}
				toasterProps={toasterProps}
				className={className}
			>
				{children}
			</AdminLayout>
		);

		// Optionally wrap with auth guard
		innerContent = shouldUseAuthGuard ? (
			<AuthGuard
				loginPath={`${basePath}/login`}
				requiredRole={requiredRole}
				loadingFallback={authLoadingFallback}
				unauthorizedFallback={authUnauthorizedFallback}
			>
				{layoutContent}
			</AuthGuard>
		) : (
			layoutContent
		);
	}

	const content = (
		<AdminProvider
			admin={admin}
			client={client}
			authClient={authClient}
			useServerTranslations={useServerTranslations}
			translationsFallback={translationsFallback}
			initialUiLocale={initialUiLocale}
		>
			{innerContent}
		</AdminProvider>
	);

	// Always wrap with QueryClientProvider
	return <QueryClientProvider client={qc}>{content}</QueryClientProvider>;
}
