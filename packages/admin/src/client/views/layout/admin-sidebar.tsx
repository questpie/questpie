/**
 * AdminSidebar Component
 *
 * Navigation sidebar for the admin UI using shadcn sidebar primitives.
 * Automatically reads from AdminProvider context when props are not provided.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { toast } from "sonner";
import { ComponentRenderer } from "../../components/component-renderer";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuPortal,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuItem,
	SidebarSeparator,
	useSidebar,
} from "../../components/ui/sidebar";
import { Skeleton } from "../../components/ui/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "../../components/ui/tooltip";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useAuthClientSafe } from "../../hooks/use-auth";
import { useSessionState } from "../../hooks/use-current-user";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn, formatLabel } from "../../lib/utils";
import {
	selectAdmin,
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime/provider";
import type {
	NavigationElement,
	NavigationGroup,
	NavigationItem,
} from "../../runtime/routes";
import { getFlagUrl } from "../../utils/locale-to-flag";

// ============================================================================
// Types
// ============================================================================

/**
 * Link component props (router-agnostic)
 */
export interface LinkComponentProps {
	to: string;
	className?: string;
	children: React.ReactNode;
	activeProps?: { className?: string };
	activeOptions?: { exact?: boolean };
}

/**
 * AdminSidebar props
 */
export interface AdminSidebarProps {
	/**
	 * Navigation groups to render.
	 * If not provided, reads from AdminProvider context.
	 */
	navigation?: NavigationGroup[];

	/**
	 * Link component (router-specific)
	 */
	LinkComponent: React.ComponentType<LinkComponentProps>;

	/**
	 * Current active route
	 */
	activeRoute?: string;

	/**
	 * Base path for admin routes
	 */
	basePath?: string;

	/**
	 * Brand name.
	 * If not provided, reads from AdminProvider context.
	 */
	brandName?: string;

	/**
	 * Custom class for sidebar container
	 */
	className?: string;

	/**
	 * Render custom brand content
	 */
	renderBrand?: (props: {
		name: string;
		collapsed: boolean;
	}) => React.ReactNode;

	/**
	 * Render custom nav item
	 */
	renderNavItem?: (params: {
		item: NavigationItem;
		isActive: boolean;
		collapsed: boolean;
	}) => React.ReactNode;

	/**
	 * Custom footer content (replaces entire footer including UserFooter)
	 */
	footer?: React.ReactNode;

	/**
	 * Content to render after the brand header.
	 * Perfect for scope/tenant pickers in multi-tenant apps.
	 *
	 * @example
	 * ```tsx
	 * <AdminSidebar
	 *   afterBrand={<ScopePicker collection="properties" />}
	 * />
	 * ```
	 */
	afterBrand?: React.ReactNode;

	/**
	 * Content to render before the user footer.
	 * Useful for additional actions or quick links.
	 *
	 * @example
	 * ```tsx
	 * <AdminSidebar
	 *   beforeFooter={
	 *     <Button variant="outline" className="w-full">
	 *       Need Help?
	 *     </Button>
	 *   }
	 * />
	 * ```
	 */
	beforeFooter?: React.ReactNode;

	/**
	 * Use framework-specific active link props (e.g., TanStack Router's activeProps)
	 * @default true
	 */
	useActiveProps?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract typed props from untyped sidebar config items.
 * Server sidebar items come as plain objects without strict typing.
 */
function getSidebarItemProps(item: unknown) {
	const i = item as Record<string, any>;
	return {
		collection: i.collection as string | undefined,
		global: i.global as string | undefined,
		pageId: i.pageId as string | undefined,
		label: i.label as string | undefined,
		icon: i.icon as NavigationItem["icon"] | undefined,
		href: i.href as string | undefined,
	};
}

// ============================================================================
// Internal Hook - Build navigation from server config
// ============================================================================

/**
 * Build NavigationGroup[] from server sidebar config, using server
 * collection/global metadata for labels/icons and local navigation
 * only for page items (which are client-only).
 */
function useServerNavigation(): NavigationGroup[] | undefined {
	const { data: serverConfig } = useAdminConfig();
	const storeNavigation = useAdminStore((s) => s.navigation);
	const basePath = useAdminStore(selectBasePath);

	return React.useMemo(() => {
		const sections = serverConfig?.sidebar?.sections;
		if (!sections?.length) return undefined;

		// Build a lookup map from local navigation for page items only
		const pageMap = new Map<string, NavigationItem>();
		for (const group of storeNavigation ?? []) {
			for (const element of group.items ?? []) {
				if (element.type !== "divider" && "id" in element) {
					const navItem = element as NavigationItem;
					if (navItem.type === "page") {
						pageMap.set(navItem.id, navItem);
					}
				}
			}
		}

		// Convert a sidebar item to a navigation element
		function convertItem(item: any): NavigationElement | undefined {
			const props = getSidebarItemProps(item);
			switch (item.type) {
				case "collection": {
					const collectionName = props.collection!;
					const meta = serverConfig?.collections?.[collectionName];
					return {
						id: `collection:${collectionName}`,
						label: props.label ?? meta?.label ?? formatLabel(collectionName),
						href: `${basePath}/collections/${collectionName}`,
						icon: props.icon ?? meta?.icon,
						type: "collection" as const,
						order: 0,
					};
				}

				case "global": {
					const globalName = props.global!;
					const meta = serverConfig?.globals?.[globalName];
					return {
						id: `global:${globalName}`,
						label: props.label ?? meta?.label ?? formatLabel(globalName),
						href: `${basePath}/globals/${globalName}`,
						icon: props.icon ?? meta?.icon,
						type: "global" as const,
						order: 0,
					};
				}

				case "page": {
					const found = pageMap.get(`page:${props.pageId}`);
					if (!found) return undefined;
					return {
						...found,
						label: props.label ?? found.label,
						icon: props.icon ?? found.icon,
					};
				}

				case "link":
					return {
						id: `link:${props.href}`,
						label: props.label ?? "",
						href: props.href!,
						icon: props.icon,
						type: "link" as const,
						order: 0,
					};

				case "divider":
					return { type: "divider" as const };

				default:
					return undefined;
			}
		}

		// Convert a section to a navigation group (recursive for nested sections)
		function convertSection(section: any): NavigationGroup {
			return {
				id: section.id,
				label: section.title,
				icon: section.icon,
				collapsed: section.collapsed,
				items: (section.items ?? [])
					.map(convertItem)
					.filter((i: any): i is NavigationElement => i !== undefined),
				sections: section.sections?.map(convertSection),
			};
		}

		return sections.map(convertSection);
	}, [serverConfig, storeNavigation, basePath]);
}

// ============================================================================
// Internal Hook - Resolve props from store
// ============================================================================

function useSidebarProps(props: {
	navigation?: NavigationGroup[];
	brandName?: string;
}): { navigation: NavigationGroup[]; brandName: string } {
	// Select individual values to avoid object identity issues
	const storeNavigation = useAdminStore((s) => s.navigation);
	const storeBrandName = useAdminStore((s) => s.brandName);

	// Try server-driven navigation
	const serverNavigation = useServerNavigation();

	// If props provided, use them (props take priority)
	if (props.navigation !== undefined && props.brandName !== undefined) {
		return {
			navigation: props.navigation,
			brandName: props.brandName,
		};
	}

	return {
		navigation: props.navigation ?? serverNavigation ?? storeNavigation ?? [],
		brandName: props.brandName ?? storeBrandName ?? "Admin",
	};
}

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Render an icon - handles ComponentReference and React components.
 *
 * @example
 * ```tsx
 * // React component
 * <RenderIcon icon={UsersIcon} />
 *
 * // Server-defined reference
 * <RenderIcon icon={{ type: "icon", props: { name: "ph:users" } }} />
 * ```
 */
function RenderIcon(props: {
	icon: NavigationItem["icon"];
	className?: string;
}) {
	const { icon, className } = props;

	if (!icon) {
		return null;
	}

	if (typeof icon === "object" && icon !== null && "type" in icon) {
		return (
			<ComponentRenderer
				reference={icon as any}
				additionalProps={{ className: cn("size-4 shrink-0", className) }}
			/>
		);
	}

	const IconComp = icon as React.ComponentType<{ className?: string }>;
	return <IconComp className={cn("size-4 shrink-0", className)} />;
}

function QuestpieSymbol({ className }: { className?: string }) {
	return (
		<svg
			width="640"
			height="640"
			viewBox="0 0 640 640"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			className={cn(
				"size-8 shrink-0 text-[#02012B] dark:text-white",
				className,
			)}
		>
			<title>QUESTPIE</title>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M466.377 350.987C468.486 340.983 469.595 330.611 469.595 319.98C469.595 237.377 402.624 170.406 320.001 170.406C237.378 170.406 170.406 237.377 170.406 319.98C170.406 393.857 223.976 455.23 294.402 467.372V510.268C200.465 497.754 128 417.329 128 319.98C128 213.952 213.962 128 320.001 128C426.04 128 512.002 213.952 512.002 319.98C512.002 344.198 507.517 367.37 499.332 388.708C489.817 374.897 478.748 362.239 466.377 350.987ZM320.002 469.553C381.932 469.553 435.067 431.927 457.799 378.296C468.772 389.602 478.366 402.254 486.309 415.98C453.11 473.357 391.065 511.959 320.002 511.959L320.002 469.553Z"
				fill="currentColor"
			/>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M320.002 512H512.004V511.985C512.004 405.958 426.042 320.005 320.003 320.005C320.003 320.005 320.002 320.005 320.002 320.005V512Z"
				fill="#B700FF"
			/>
		</svg>
	);
}

/**
 * Check if element is a navigation item (not divider)
 */
function isNavigationItem(
	element: NavigationElement,
): element is NavigationItem {
	return element.type !== "divider";
}

function normalizeRoute(route?: string) {
	return route?.replace(/\/+$/, "");
}

function isRouteActive(
	activeRoute: string | undefined,
	itemHref: string,
	basePath: string,
	exact = false,
) {
	if (!activeRoute) {
		return false;
	}

	const normalizedActive = normalizeRoute(activeRoute);
	const normalizedItem = normalizeRoute(itemHref);
	const normalizedBase = normalizeRoute(basePath);

	if (!normalizedActive || !normalizedItem) {
		return false;
	}

	// Exact match
	if (normalizedActive === normalizedItem) {
		return true;
	}

	// For exact mode or base path (dashboard), don't match prefixes
	if (exact || normalizedItem === normalizedBase) {
		return false;
	}

	// Prefix match for non-exact items
	return normalizedActive.startsWith(`${normalizedItem}/`);
}

/**
 * Menu button styles - QUESTPIE design: clean, technical look
 */
const menuButtonStyles = cn(
	"flex w-full items-center gap-2.5 px-3 py-2 text-sm font-medium transition-colors duration-150",
	"text-sidebar-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent",
	"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
	"group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-2 group-data-[collapsible=icon]:size-8",
);

const menuButtonActiveStyles = cn(
	"bg-sidebar-primary/10 text-sidebar-primary border-l-2 border-sidebar-primary",
);

function NavItem({
	item,
	isActive,
	LinkComponent,
	renderNavItem,
	useActiveProps,
	className,
}: {
	item: NavigationItem;
	isActive: boolean;
	LinkComponent: React.ComponentType<LinkComponentProps>;
	renderNavItem?: AdminSidebarProps["renderNavItem"];
	useActiveProps: boolean;
	className?: string;
}) {
	const { state, isMobile, setOpenMobile } = useSidebar();
	const collapsed = state === "collapsed";
	const resolveText = useResolveText();

	// Close sidebar on mobile when navigating
	const handleClick = React.useCallback(() => {
		if (isMobile) {
			setOpenMobile(false);
		}
	}, [isMobile, setOpenMobile]);

	if (renderNavItem) {
		return <>{renderNavItem({ item, isActive, collapsed })}</>;
	}

	const label = resolveText(item.label);

	// Dashboard and external links should use exact matching
	// Collections and globals should use prefix matching
	const shouldUseExact =
		item.type === "dashboard" || item.type === "link" || item.type === "page";

	const linkActiveProps = useActiveProps
		? {
				activeProps: { className: menuButtonActiveStyles },
				activeOptions: { exact: shouldUseExact },
			}
		: {};

	const linkContent = (
		<LinkComponent
			to={item.href}
			className={cn(menuButtonStyles, isActive && menuButtonActiveStyles)}
			{...linkActiveProps}
		>
			{item.icon && <RenderIcon icon={item.icon} />}
			<span className="truncate group-data-[collapsible=icon]:hidden">
				{label}
			</span>
		</LinkComponent>
	);

	// Show tooltip when collapsed (desktop only)
	if (collapsed && !isMobile) {
		return (
			<SidebarMenuItem onClickCapture={handleClick}>
				<Tooltip>
					<TooltipTrigger
						render={
							<LinkComponent
								to={item.href}
								className={cn(
									menuButtonStyles,
									isActive && menuButtonActiveStyles,
								)}
								{...linkActiveProps}
							>
								{item.icon && <RenderIcon icon={item.icon} />}
								<span className="truncate group-data-[collapsible=icon]:hidden">
									{label}
								</span>
							</LinkComponent>
						}
					/>
					<TooltipContent side="right" align="center">
						{label}
					</TooltipContent>
				</Tooltip>
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem className={className} onClickCapture={handleClick}>
			{linkContent}
		</SidebarMenuItem>
	);
}

function NavGroup({
	group,
	activeRoute,
	LinkComponent,
	renderNavItem,
	basePath,
	useActiveProps,
	depth = 0,
}: {
	group: NavigationGroup;
	activeRoute?: string;
	LinkComponent: React.ComponentType<LinkComponentProps>;
	renderNavItem?: AdminSidebarProps["renderNavItem"];
	basePath: string;
	useActiveProps: boolean;
	depth?: number;
}) {
	// Track collapsed state for sections that support it
	const [isCollapsed, setIsCollapsed] = React.useState(
		group.collapsed ?? false,
	);
	const resolveText = useResolveText();
	const groupLabel = resolveText(group.label);

	const items = group.items ?? [];
	const sections = group.sections ?? [];
	const hasContent = items.length > 0 || sections.length > 0;

	return (
		<SidebarGroup>
			{/* Section header with optional icon and collapse toggle */}
			{groupLabel && (
				<SidebarGroupLabel
					className={cn(
						"gap-2 px-3 mt-2",
						group.collapsed !== undefined &&
							"cursor-pointer hover:text-sidebar-foreground",
						depth > 0 && "pl-6",
					)}
					onClick={
						group.collapsed !== undefined
							? () => setIsCollapsed(!isCollapsed)
							: undefined
					}
				>
					{group.icon && <RenderIcon icon={group.icon} className="size-3.5" />}
					<span className="flex-1 font-mono  text-left">{groupLabel}</span>
					{group.collapsed !== undefined && (
						<Icon
							icon="ph:caret-down"
							className={cn(
								"size-3.5 transition-transform",
								isCollapsed && "-rotate-90",
							)}
						/>
					)}
				</SidebarGroupLabel>
			)}

			{/* Section content (hidden when collapsed) */}
			{!isCollapsed && hasContent && (
				<SidebarGroupContent className={cn(depth > 0 && "pl-3")}>
					{/* Items */}
					{items.length > 0 && (
						<SidebarMenu>
							{items.map((element, elementIndex) => {
								// Handle dividers
								if (!isNavigationItem(element)) {
									return (
										<SidebarSeparator
											key={`${group.id ?? groupLabel ?? "group"}-divider-${elementIndex}`}
											className="my-2"
										/>
									);
								}

								// Handle navigation items
								// Dashboard and links use exact matching, collections/globals use prefix
								const shouldUseExact =
									element.type === "dashboard" ||
									element.type === "link" ||
									element.type === "page";

								return (
									<NavItem
										key={element.id}
										item={element}
										isActive={isRouteActive(
											activeRoute,
											element.href,
											basePath,
											shouldUseExact,
										)}
										LinkComponent={LinkComponent}
										renderNavItem={renderNavItem}
										useActiveProps={useActiveProps}
									/>
								);
							})}
						</SidebarMenu>
					)}

					{/* Nested sections */}
					{sections.map((subSection) => (
						<NavGroup
							key={subSection.id}
							group={subSection}
							activeRoute={activeRoute}
							LinkComponent={LinkComponent}
							renderNavItem={renderNavItem}
							basePath={basePath}
							useActiveProps={useActiveProps}
							depth={depth + 1}
						/>
					))}
				</SidebarGroupContent>
			)}
		</SidebarGroup>
	);
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Loading skeleton for UserFooter
 */
function UserFooterSkeleton({ collapsed }: { collapsed: boolean }) {
	return (
		<SidebarFooter className="border-t border-sidebar-border/50 p-2">
			<div
				className={cn(
					"flex items-center gap-2.5 p-2",
					collapsed && "justify-center",
				)}
			>
				<Skeleton className="size-8 shrink-0" />
				{!collapsed && (
					<div className="grid flex-1 gap-1">
						<Skeleton className="h-3 w-24" />
						<Skeleton className="h-2 w-32" />
					</div>
				)}
			</div>
		</SidebarFooter>
	);
}

function UserFooter() {
	const { state, isMobile, setOpenMobile } = useSidebar();
	const collapsed = state === "collapsed";

	// Get auth client and session state
	const authClient = useAuthClientSafe();
	const { user, isPending } = useSessionState();
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);
	const admin = useAdminStore(selectAdmin);
	const {
		t,
		locale: uiLocale,
		setLocale: setUiLocale,
		getLocaleName,
	} = useTranslation();

	// Get available locales from admin config
	const localeConfig = admin.getLocale();
	const uiLocales = localeConfig.supported ?? ["en"];
	const hasMultipleUiLocales = uiLocales.length > 1;
	const uiLocaleOptions = uiLocales.map((code) => ({
		code,
		label: getLocaleName(code),
	}));

	// Close sidebar on mobile when navigating
	const closeSidebarOnMobile = React.useCallback(() => {
		if (isMobile) {
			setOpenMobile(false);
		}
	}, [isMobile, setOpenMobile]);

	// Handle logout
	const handleLogout = React.useCallback(async () => {
		if (!authClient) return;
		try {
			await authClient.signOut();
			closeSidebarOnMobile();
			navigate(`${basePath}/login`);
		} catch (error) {
			toast.error(t("auth.logoutFailed"));
		}
	}, [authClient, navigate, basePath, closeSidebarOnMobile, t]);

	// Handle navigate to user profile
	const handleMyAccount = React.useCallback(() => {
		if (user?.id) {
			closeSidebarOnMobile();
			navigate(`${basePath}/collections/user/${user.id}`);
		}
	}, [navigate, basePath, user?.id, closeSidebarOnMobile]);

	// Show skeleton while loading
	if (isPending) {
		return <UserFooterSkeleton collapsed={collapsed} />;
	}

	// If no auth client or no user, don't show footer
	if (!authClient || !user) {
		return null;
	}

	// Get display values
	const displayName = user.name || user.email?.split("@")[0] || "User";
	const displayEmail = user.email || "";

	return (
		<SidebarFooter className="border-t border-sidebar-border/50 p-2">
			<SidebarMenu>
				{/* User Menu */}
				<SidebarMenuItem>
					<DropdownMenu>
						<DropdownMenuTrigger
							className={cn(
								"flex w-full items-center gap-2.5 p-2 text-left transition-colors duration-150",
								"hover:bg-sidebar-accent text-sidebar-foreground",
								"focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring",
								collapsed && "justify-center",
							)}
						>
							<div className="flex size-8 shrink-0 items-center justify-center bg-sidebar-primary/10 text-sidebar-primary border border-sidebar-primary/20">
								<Icon icon="ph:user-bold" className="size-4" />
							</div>
							{!collapsed && (
								<>
									<div className="grid flex-1 text-left leading-tight">
										<span className="truncate text-xs font-medium">
											{displayName}
										</span>
										<span className="truncate text-[10px] text-sidebar-foreground/50">
											{displayEmail}
										</span>
									</div>
									<Icon
										icon="ph:caret-up-down"
										className="ml-auto size-3.5 text-sidebar-foreground/40"
									/>
								</>
							)}
						</DropdownMenuTrigger>
						<DropdownMenuContent
							side={collapsed ? "right" : "top"}
							align={collapsed ? "start" : "start"}
							className="w-56"
						>
							<div className="px-2 py-1.5">
								<p className="text-xs font-medium">{displayName}</p>
								<p className="text-[10px] text-muted-foreground">
									{displayEmail}
								</p>
								{user.role && (
									<p className="text-[10px] text-muted-foreground capitalize mt-0.5">
										{user.role}
									</p>
								)}
							</div>
							<DropdownMenuSeparator />
							{/* My Account - link to user detail */}
							<DropdownMenuItem onClick={handleMyAccount}>
								<Icon icon="ph:user-circle" className="size-4" />
								{t("auth.myAccount")}
							</DropdownMenuItem>
							{/* UI Language Switcher */}
							{hasMultipleUiLocales && (
								<DropdownMenuSub>
									<DropdownMenuSubTrigger>
										<Icon icon="ph:globe" />
										{t("locale.uiLanguage")}
									</DropdownMenuSubTrigger>
									<DropdownMenuPortal>
										<DropdownMenuSubContent>
											{uiLocaleOptions.map((locale) => (
												<DropdownMenuItem
													key={locale.code}
													onClick={() => setUiLocale(locale.code)}
												>
													<img
														src={getFlagUrl(locale.code)}
														alt={locale.code}
														className="h-3 w-4 rounded-[2px] object-cover"
														onError={(e) => {
															e.currentTarget.style.display = "none";
														}}
													/>
													<span className="uppercase text-xs font-medium w-6">
														{locale.code}
													</span>
													<span className="flex-1">{locale.label}</span>
													{locale.code === uiLocale && (
														<Icon
															icon="ph:check"
															className="size-4 text-primary"
														/>
													)}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuPortal>
								</DropdownMenuSub>
							)}
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={handleLogout}>
								<Icon icon="ph:sign-out" className="size-4" />
								{t("auth.logout")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</SidebarMenuItem>
			</SidebarMenu>
		</SidebarFooter>
	);
}

/**
 * AdminSidebar Component
 *
 * When used inside AdminProvider, navigation and brandName are automatically
 * read from context if not provided as props.
 *
 * @example
 * ```tsx
 * // With AdminProvider (automatic)
 * <AdminProvider admin={admin} client={client}>
 *   <SidebarProvider>
 *     <AdminSidebar LinkComponent={Link} activeRoute="/admin/posts" />
 *   </SidebarProvider>
 * </AdminProvider>
 *
 * // Without AdminProvider (manual)
 * <SidebarProvider>
 *   <AdminSidebar
 *     navigation={buildNavigation(admin)}
 *     LinkComponent={Link}
 *     activeRoute="/admin/posts"
 *     brandName="My CMS"
 *   />
 * </SidebarProvider>
 * ```
 */
export function AdminSidebar({
	navigation: navigationProp,
	LinkComponent,
	activeRoute,
	basePath = "/admin",
	brandName: brandNameProp,
	className,
	renderBrand,
	renderNavItem,
	footer,
	afterBrand,
	beforeFooter,
	useActiveProps = true,
}: AdminSidebarProps): React.ReactElement {
	// Resolve navigation and brandName from props or store
	const { navigation, brandName } = useSidebarProps({
		navigation: navigationProp,
		brandName: brandNameProp,
	});

	const { state, isMobile, setOpenMobile } = useSidebar();
	const collapsed = state === "collapsed";

	// Close sidebar on mobile when navigating
	const handleBrandClick = React.useCallback(() => {
		if (isMobile) {
			setOpenMobile(false);
		}
	}, [isMobile, setOpenMobile]);

	const brandContent = renderBrand ? (
		renderBrand({ name: brandName, collapsed })
	) : (
		<>
			<QuestpieSymbol />
			{!collapsed && (
				<div className="grid flex-1 text-left leading-tight">
					<span className="truncate  font-bold tracking-tight">
						{brandName}
					</span>
				</div>
			)}
		</>
	);

	const brandLink = (
		<LinkComponent
			to={basePath}
			className={cn(
				"flex items-center gap-2.5 p-2 transition-colors duration-150",
				"hover:bg-sidebar-accent",
				collapsed && "justify-center",
			)}
		>
			{brandContent}
		</LinkComponent>
	);

	return (
		<Sidebar collapsible="icon" className={className}>
			{/* Brand Header */}
			<SidebarHeader className="p-2 border-b border-sidebar-border/50">
				<SidebarMenu>
					<SidebarMenuItem onClickCapture={handleBrandClick}>
						{collapsed && !isMobile ? (
							<Tooltip>
								<TooltipTrigger
									render={
										<LinkComponent
											to={basePath}
											className={cn(
												"flex items-center gap-2.5 p-2 transition-colors duration-150",
												"hover:bg-sidebar-accent",
												"justify-center",
											)}
										>
											{renderBrand ? (
												renderBrand({ name: brandName, collapsed: true })
											) : (
												<QuestpieSymbol />
											)}
										</LinkComponent>
									}
								/>
								<TooltipContent side="right">{brandName}</TooltipContent>
							</Tooltip>
						) : (
							brandLink
						)}
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>

			{/* After Brand Slot - for scope pickers, etc */}
			{afterBrand && !collapsed && (
				<div className="px-3 py-2 border-b border-sidebar-border/50">
					{afterBrand}
				</div>
			)}

			{/* Navigation */}
			<SidebarContent>
				{navigation.map((group, index) => (
					<NavGroup
						key={group.id ?? `group-${index}`}
						group={group}
						activeRoute={activeRoute}
						LinkComponent={LinkComponent}
						renderNavItem={renderNavItem}
						basePath={basePath}
						useActiveProps={useActiveProps}
					/>
				))}
			</SidebarContent>

			{/* Before Footer Slot - for additional actions */}
			{beforeFooter && !collapsed && (
				<div className="px-3 py-2 border-t border-sidebar-border/50">
					{beforeFooter}
				</div>
			)}

			{/* Footer */}
			{footer ?? <UserFooter />}
		</Sidebar>
	);
}
