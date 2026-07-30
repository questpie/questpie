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

import { Icon } from "@iconify/react";
import * as React from "react";

import type { ServerAdminShellRailConfig } from "../../../server/augmentation/index.js";
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
import { AdminTopbar } from "./admin-topbar";

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

const RAIL_WIDTH_KEY = "qa-admin-secondary-rail-width";
const RAIL_COLLAPSED_KEY = "qa-admin-secondary-rail-collapsed";

/**
 * Client-side width + collapsed state for the secondary rail, persisted to
 * localStorage. The server config provides the DEFAULT width and the min/max
 * bounds; the user can resize within those bounds and collapse the rail, and the
 * choice survives reloads.
 */
function useRailState(
	defaultWidth: number,
	minWidth: number,
	maxWidth: number,
) {
	const clamp = React.useCallback(
		(w: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(w))),
		[minWidth, maxWidth],
	);
	const [width, setWidthState] = React.useState<number>(() => {
		if (typeof window === "undefined") return defaultWidth;
		const saved = Number(window.localStorage.getItem(RAIL_WIDTH_KEY));
		return Number.isFinite(saved) && saved > 0 ? clamp(saved) : defaultWidth;
	});
	const [collapsed, setCollapsedState] = React.useState<boolean>(
		() =>
			typeof window !== "undefined" &&
			window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1",
	);
	const setWidth = React.useCallback(
		(w: number) => {
			const next = clamp(w);
			setWidthState(next);
			if (typeof window !== "undefined")
				window.localStorage.setItem(RAIL_WIDTH_KEY, String(next));
		},
		[clamp],
	);
	const setCollapsed = React.useCallback((c: boolean) => {
		setCollapsedState(c);
		if (typeof window !== "undefined")
			window.localStorage.setItem(RAIL_COLLAPSED_KEY, c ? "1" : "0");
	}, []);
	return { width, setWidth, collapsed, setCollapsed };
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
	const isRight = placement === "right";
	const defaultWidth = typeof config.width === "number" ? config.width : 320;
	const minWidth = typeof config.minWidth === "number" ? config.minWidth : 280;
	const maxWidth = typeof config.maxWidth === "number" ? config.maxWidth : 560;
	const { width, setWidth, collapsed, setCollapsed } = useRailState(
		defaultWidth,
		minWidth,
		maxWidth,
	);

	const onResizeStart = React.useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startWidth = width;
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			const onMove = (ev: PointerEvent) => {
				const dx = ev.clientX - startX;
				setWidth(isRight ? startWidth - dx : startWidth + dx);
			};
			const onUp = () => {
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
		},
		[width, isRight, setWidth],
	);

	const baseClass = cn(
		"qa-admin-layout__secondary-rail bg-background border-border-subtle h-dvh min-h-0 shrink-0 overflow-hidden",
		isRight ? "border-l" : "border-r",
		config.hiddenOnMobile === false ? "flex" : "hidden md:flex",
	);

	if (collapsed) {
		return (
			<aside
				className={cn(baseClass, "w-11 flex-col items-center")}
				data-placement={placement}
				data-collapsed="true"
			>
				<button
					type="button"
					onClick={() => setCollapsed(false)}
					className="text-muted-foreground hover:bg-surface-high hover:text-foreground focus-visible:ring-ring/40 mt-2.5 flex size-8 shrink-0 items-center justify-center rounded-[var(--control-radius-inner)] transition-[background-color,color,box-shadow] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none"
					title="Expand panel"
					aria-label="Expand panel"
				>
					<Icon
						icon={isRight ? "ph:caret-left" : "ph:caret-right"}
						width={16}
						height={16}
					/>
				</button>
			</aside>
		);
	}

	return (
		<aside
			className={cn(baseClass, "relative flex-col", config.className)}
			data-placement={placement}
			style={{ width: `${width}px` }}
		>
			{/* Drag-to-resize handle straddling the inner edge */}
			<div
				onPointerDown={onResizeStart}
				className={cn(
					"group/resize absolute inset-y-0 z-20 flex w-2 cursor-col-resize items-center justify-center",
					isRight ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
				)}
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize panel"
			>
				<div className="bg-border-subtle group-hover/resize:bg-border-strong h-full w-px transition-[background-color] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none" />
			</div>

			{/* Collapse toggle */}
			<button
				type="button"
				onClick={() => setCollapsed(true)}
				className={cn(
					"text-muted-foreground hover:bg-surface-high hover:text-foreground focus-visible:ring-ring/40 absolute top-2.5 z-20 flex size-7 shrink-0 items-center justify-center rounded-[var(--control-radius-inner)] transition-[background-color,color,box-shadow] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-standard)] focus-visible:ring-2 focus-visible:outline-none motion-reduce:transition-none",
					isRight ? "left-2.5" : "right-2.5",
				)}
				title="Collapse panel"
				aria-label="Collapse panel"
			>
				<Icon
					icon={isRight ? "ph:caret-right" : "ph:caret-left"}
					width={15}
					height={15}
				/>
			</button>

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

	// iOS scrolls the WINDOW to reveal a focused input even though the shell
	// owns scrolling (overflow-hidden + inner scroller). When the keyboard
	// closes it sometimes leaves that window offset behind — the app sits half
	// off-screen: blank strip at the bottom, action bars "floating" mid-air,
	// taps landing next to their targets. Snap the window back once nothing
	// editable holds focus. Touch devices only; desktop never window-scrolls.
	React.useEffect(() => {
		if (typeof window === "undefined") return;
		if (!window.matchMedia?.("(pointer: coarse)").matches) return;
		let raf = 0;
		const snapBack = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				const active = document.activeElement;
				const editing =
					active instanceof HTMLElement &&
					(active.isContentEditable ||
						active.matches("input, textarea, select"));
				if (!editing && (window.scrollY > 0 || window.scrollX > 0)) {
					window.scrollTo(0, 0);
				}
			});
		};
		document.addEventListener("focusout", snapBack);
		window.visualViewport?.addEventListener("resize", snapBack);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener("focusout", snapBack);
			window.visualViewport?.removeEventListener("resize", snapBack);
		};
	}, []);

	return (
		<AdminThemeAppliedContext.Provider value={true}>
			<div
				className={cn(
					"qa-admin-layout bg-sidebar text-foreground min-h-svh",
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
					className="qa-admin-layout__sidebar-wrapper bg-sidebar mx-auto h-dvh max-w-[1920px] overflow-hidden"
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
					{/* h-dvh (not svh): svh leaves a dead strip at the bottom when the
					    mobile browser chrome collapses — the shell must track the
					    dynamic viewport so bottom action bars sit on the real edge. */}
					<SidebarInset className="qa-admin-layout__content bg-background flex h-dvh scrollbar-none flex-col overflow-hidden md:rounded-t-2xl">
						{/* Persistent mobile header — reopens nav + global search (md:hidden) */}
						<AdminTopbar onSearchOpen={openSearch} />

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
