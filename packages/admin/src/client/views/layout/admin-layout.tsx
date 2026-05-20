/**
 * AdminLayout Component
 *
 * Complete admin layout with:
 * - Sidebar navigation (using shadcn sidebar primitives)
 * - Main content area
 * - Optional header/footer
 *
 * Automatically reads from AdminProvider context when props are not provided.
 */

import * as React from "react";

import type { ServerAdminShellRailConfig } from "#questpie/admin/server/augmentation.js";

import { ComponentRenderer } from "../../components/component-renderer";
import { SidebarInset, SidebarProvider } from "../../components/ui/sidebar";
import { type AdminToasterProps, Toaster } from "../../components/ui/sonner";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useSafeI18n } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { useAdminStore } from "../../runtime/provider";
import { shouldHandleAdminShortcut } from "../../utils/keyboard-shortcuts";
import { GlobalSearch } from "../common";
import { AdminSidebar, type AdminSidebarProps } from "./admin-sidebar";
import {
	AdminThemeAppliedContext,
	type AdminTheme,
	useManagedAdminTheme,
} from "./admin-theme";

export type { AdminTheme } from "./admin-theme";

// ============================================================================
// Types
// ============================================================================

/**
 * Layout mode for content area width
 * - default: max-w-5xl centered (settings, narrow forms)
 * - wide: full width with padding (tables, forms, dashboards) — the default
 * - full: full width reduced padding (kanban, calendar)
 * - immersive: full width no padding (block editor, canvas)
 */
export type LayoutMode = "default" | "wide" | "full" | "immersive";

/**
 * Shared layout props that can be passed through AdminLayoutProvider
 * or directly to AdminLayout.
 */
export interface AdminLayoutSharedProps {
	/**
	 * Link component (router-specific)
	 */
	LinkComponent: AdminSidebarProps["LinkComponent"];

	/**
	 * Current active route
	 */
	activeRoute?: string;

	/**
	 * Base path for admin routes
	 * @default "/admin"
	 */
	basePath?: string;

	/**
	 * Header content
	 */
	header?: React.ReactNode;

	/**
	 * Footer content
	 */
	footer?: React.ReactNode;

	/**
	 * Additional sidebar props
	 */
	sidebarProps?: Partial<Omit<AdminSidebarProps, "LinkComponent">>;

	/**
	 * Current theme.
	 * Pass from your app's theme context.
	 * @default "system"
	 */
	theme?: AdminTheme;

	/**
	 * Callback to change theme.
	 * Connect to your app's theme context setTheme function.
	 */
	setTheme?: (theme: AdminTheme) => void;

	/**
	 * Show theme toggle button in the topbar
	 * @default true (when setTheme is provided)
	 */
	showThemeToggle?: boolean;

	/**
	 * Additional toaster props
	 */
	toasterProps?: Omit<AdminToasterProps, "theme">;

	/**
	 * Custom layout className
	 */
	className?: string;

	/**
	 * Layout mode for content area width
	 * @default "wide"
	 */
	layoutMode?: LayoutMode;
}

export interface AdminShellRailProps {
	/** Current route path, usually the browser pathname. */
	activeRoute?: string;
	/** Admin base path, usually "/admin". */
	basePath: string;
	/** Resolved rail placement. */
	placement: "left" | "right";
	/** Raw rail config from server admin config. */
	config: ServerAdminShellRailConfig;
	/** Navigate function from the admin runtime. */
	navigate: (path: string) => void;
}

interface AdminLayoutProps extends AdminLayoutSharedProps {
	/**
	 * Brand name for sidebar.
	 * If not provided, reads from AdminProvider context.
	 */
	brandName?: string;

	/**
	 * Whether sidebar is collapsed
	 */
	sidebarCollapsed?: boolean;

	/**
	 * Main content to render
	 */
	children: React.ReactNode;

	/**
	 * Navigation function (for search/quick actions)
	 */
	navigate?: (path: string) => void;
}

// ============================================================================
// Internal Hook - Resolve props from store
// ============================================================================

function useLayoutProps(props: {
	brandName?: string;
	navigate?: (path: string) => void;
}): {
	brandName: string;
	navigate: (path: string) => void;
} {
	const storeBrandName = useAdminStore((s) => s.brandName);
	const storeNavigate = useAdminStore((s) => s.navigate);

	return {
		brandName: props.brandName ?? storeBrandName,
		navigate: props.navigate ?? storeNavigate,
	};
}

// ============================================================================
// Shell Rail
// ============================================================================

function normalizeRoute(route: string): string {
	const normalized = route.replace(/\/+$/, "");
	return normalized || "/";
}

function resolveRouteRule(rule: string, basePath: string): string {
	if (rule.startsWith("/")) {
		return normalizeRoute(rule);
	}
	return normalizeRoute(`${basePath}/${rule.replace(/^\/+/, "")}`);
}

function routeMatchesRule(
	activeRoute: string | undefined,
	rule: string,
	basePath: string,
	match: "prefix" | "exact",
): boolean {
	if (!activeRoute) return false;
	const active = normalizeRoute(activeRoute);
	const target = resolveRouteRule(rule, basePath);

	if (match === "exact") {
		return active === target;
	}

	return active === target || active.startsWith(`${target}/`);
}

function shouldRenderShellRail(
	config: ServerAdminShellRailConfig,
	activeRoute: string | undefined,
	basePath: string,
): boolean {
	const routes = config.routes;
	if (!routes) return true;

	const match = routes.match ?? "prefix";
	const included =
		!routes.include?.length ||
		routes.include.some((rule) =>
			routeMatchesRule(activeRoute, rule, basePath, match),
		);
	if (!included) return false;

	return !routes.exclude?.some((rule) =>
		routeMatchesRule(activeRoute, rule, basePath, match),
	);
}

function toCssLength(value: number | string | undefined): string | undefined {
	if (value === undefined) return undefined;
	return typeof value === "number" ? `${value}px` : value;
}

function AdminShellRail({
	config,
	activeRoute,
	basePath,
	navigate,
}: {
	config: ServerAdminShellRailConfig;
	activeRoute?: string;
	basePath: string;
	navigate: (path: string) => void;
}) {
	const placement = config.placement ?? "left";
	const width = toCssLength(config.width ?? 320);
	const style = {
		width,
		minWidth: toCssLength(config.minWidth ?? config.width ?? 280),
		maxWidth: toCssLength(config.maxWidth),
	} as React.CSSProperties;

	return (
		<aside
			className={cn(
				"qa-admin-layout__secondary-rail bg-background h-svh min-h-0 shrink-0 flex-col overflow-hidden",
				config.hiddenOnMobile === false ? "flex" : "hidden md:flex",
				placement === "left"
					? "border-border-subtle border-r"
					: "border-border-subtle border-l",
				config.className,
			)}
			data-placement={placement}
			style={style}
		>
			<ComponentRenderer
				reference={config.component}
				additionalProps={
					{
						activeRoute,
						basePath,
						placement,
						config,
						navigate,
					} satisfies AdminShellRailProps
				}
			/>
		</aside>
	);
}

// ============================================================================
// Component
// ============================================================================

/**
 * AdminLayout Component
 *
 * When used inside AdminProvider, brandName is automatically
 * read from context if not provided as props.
 * Navigation is driven by server-side sidebar configuration.
 *
 * @example
 * ```tsx
 * <AdminProvider admin={admin} client={client}>
 *   <AdminLayout LinkComponent={Link} activeRoute="/admin/posts">
 *     <Outlet />
 *   </AdminLayout>
 * </AdminProvider>
 * ```
 */
export function AdminLayout({
	LinkComponent,
	activeRoute,
	basePath = "/admin",
	brandName: brandNameProp,
	sidebarCollapsed: sidebarCollapsedProp = false,
	children,
	className,
	sidebarProps,
	header,
	footer,
	navigate: navigateProp,
	theme: themeProp,
	setTheme: setThemeProp,
	showThemeToggle,
	toasterProps,
	layoutMode = "wide",
}: AdminLayoutProps): React.ReactElement {
	const { theme, setTheme } = useManagedAdminTheme(themeProp, setThemeProp);
	// Infer show flags from content
	const shouldShowHeader = !!header;
	const shouldShowFooter = !!footer;
	// Resolve brandName and navigate from props or store
	const { brandName, navigate } = useLayoutProps({
		brandName: brandNameProp,
		navigate: navigateProp,
	});
	const i18n = useSafeI18n();
	const t = (key: string, fallback: string) => {
		const message = i18n?.t(key);
		return message && message !== key ? message : fallback;
	};

	const [isSearchOpen, setIsSearchOpen] = React.useState(false);
	const openSearch = React.useCallback(() => setIsSearchOpen(true), []);
	const closeSearch = React.useCallback(() => setIsSearchOpen(false), []);
	const { data: serverConfig } = useAdminConfig();
	const currentActiveRoute =
		activeRoute ??
		(typeof window !== "undefined" ? window.location.pathname : undefined);
	const secondaryRailConfig = serverConfig?.shell?.secondaryRail;
	const shouldShowSecondaryRail =
		!!secondaryRailConfig &&
		shouldRenderShellRail(secondaryRailConfig, currentActiveRoute, basePath);
	const secondaryRail =
		shouldShowSecondaryRail && secondaryRailConfig ? (
			<AdminShellRail
				config={secondaryRailConfig}
				activeRoute={currentActiveRoute}
				basePath={basePath}
				navigate={navigate}
			/>
		) : null;

	// Keyboard shortcuts for search
	React.useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (shouldHandleAdminShortcut(e, { key: "k" })) {
				e.preventDefault();
				setIsSearchOpen(true);
			}
		};
		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	return (
		<AdminThemeAppliedContext.Provider value={true}>
			<div
				className={cn(
					"qa-admin-layout bg-sidebar text-foreground min-h-screen",
					className,
				)}
			>
				{/* Skip to main content link — visible on focus for keyboard users */}
				<a
					href="#main-content"
					className="qa-admin-layout__skip-link focus:bg-surface-high focus:text-foreground sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-sm focus:px-4 focus:py-2 focus:text-sm focus:font-medium"
				>
					{t("ui.skipToMainContent", "Skip to main content")}
				</a>

				{isSearchOpen && (
					<GlobalSearch
						isOpen={isSearchOpen}
						onClose={closeSearch}
						navigate={navigate}
						basePath={basePath}
					/>
				)}

				{/* Max-width container for ultrawide monitors - centered with subtle side borders */}
				<SidebarProvider
					defaultOpen={!sidebarCollapsedProp}
					className="qa-admin-layout__sidebar-wrapper bg-sidebar mx-auto h-svh max-w-[1920px] overflow-hidden"
				>
					{/* Sidebar */}
					<AdminSidebar
						LinkComponent={LinkComponent}
						activeRoute={currentActiveRoute}
						basePath={basePath}
						brandName={brandName}
						theme={theme}
						setTheme={setTheme}
						showThemeToggle={showThemeToggle}
						onSearchOpen={openSearch}
						{...sidebarProps}
					/>

					{secondaryRailConfig?.placement !== "right" && secondaryRail}

					{/* Content Area */}
					<SidebarInset className="qa-admin-layout__content bg-background flex h-svh scrollbar-none flex-col overflow-hidden md:rounded-t-2xl">
						{/* Header (optional) */}
						{shouldShowHeader && header && (
							<header className="qa-admin-layout__header border-border-subtle border-b">
								{header}
							</header>
						)}

						<main
							id="main-content"
							className="qa-admin-layout__main min-w-0 flex-1 overflow-y-auto"
							tabIndex={-1}
						>
							<div
								className={cn(
									"qa-admin-layout__main-content min-w-0",
									layoutMode === "default" &&
										"mx-auto max-w-5xl px-3 pt-1 pb-6 md:px-4 md:pt-2 md:pb-8",
									layoutMode === "wide" &&
										"px-3 pt-1 pb-6 md:px-4 md:pt-2 md:pb-8",
									layoutMode === "full" && "px-2 pt-1 pb-6 md:px-3 md:pb-8",
									layoutMode === "immersive" && "p-0",
								)}
							>
								{children}
							</div>
						</main>

						{/* Footer (optional) */}
						{shouldShowFooter && footer && (
							<footer className="qa-admin-layout__footer border-border-subtle border-t">
								{footer}
							</footer>
						)}
					</SidebarInset>

					{secondaryRailConfig?.placement === "right" && secondaryRail}
				</SidebarProvider>

				{/* Toast notifications */}
				<Toaster theme={theme} {...toasterProps} />
			</div>
		</AdminThemeAppliedContext.Provider>
	);
}
