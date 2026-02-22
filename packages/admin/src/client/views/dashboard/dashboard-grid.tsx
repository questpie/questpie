/**
 * DashboardGrid Component
 *
 * Renders a grid of dashboard widgets based on configuration.
 * Supports:
 * - Responsive layouts with container queries
 * - Widget spanning
 * - Dashboard sections (grouped widgets)
 * - Dashboard tabs (tabbed widget groups)
 * - Recursive nesting of sections/tabs
 */

import { Icon } from "@iconify/react";
import type * as React from "react";
import type {
	AnyWidgetConfig,
	DashboardAction,
	DashboardConfig,
	DashboardLayoutItem,
	DashboardSection,
	DashboardTabConfig,
	DashboardTabs,
	WidgetComponentProps,
	WidgetConfig,
} from "../../builder";
import { resolveIconElement } from "../../components/component-renderer";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../../components/ui/accordion";
import { Button } from "../../components/ui/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../../components/ui/tabs";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { DashboardWidget } from "./dashboard-widget";

// ============================================================================
// Types
// ============================================================================

interface DashboardGridProps {
	/**
	 * Dashboard configuration
	 */
	config: DashboardConfig;

	/**
	 * Base path for navigation links (default: "/admin")
	 */
	basePath?: string;

	/**
	 * Navigate function for item clicks
	 */
	navigate?: (path: string) => void;

	/**
	 * Custom widget registry for overrides
	 */
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;

	/**
	 * Additional CSS class
	 */
	className?: string;
}

// ============================================================================
// Grid Classes - Using Container Queries
// ============================================================================

/**
 * Grid column classes for different column counts
 * Uses container queries (@container) for responsive behavior
 */
const gridClasses: Record<number, string> = {
	1: "grid-cols-1",
	2: "grid-cols-1 @xs:grid-cols-2",
	3: "grid-cols-1 @xs:grid-cols-2 @md:grid-cols-3",
	4: "grid-cols-1 @xs:grid-cols-2 @md:grid-cols-3 @lg:grid-cols-4",
	5: "grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-5",
	6: "grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-5 @xl:grid-cols-6",
	12: "grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-12",
};

/**
 * Span classes for widget column spanning
 * - span:1 widgets can be 2x2 on @xs (half width each)
 * - span:2+ widgets are full width on mobile/tablet, then expand at larger breakpoints
 */
const spanClasses: Record<number, string> = {
	1: "col-span-1",
	2: "col-span-full @sm:col-span-2",
	3: "col-span-full @sm:col-span-2 @md:col-span-3",
	4: "col-span-full @sm:col-span-2 @md:col-span-3 @lg:col-span-4",
	5: "col-span-full @sm:col-span-2 @md:col-span-3 @lg:col-span-5",
	6: "col-span-full @sm:col-span-2 @md:col-span-3 @lg:col-span-6",
	12: "col-span-full",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get grid columns class based on column count
 */
function getGridClass(columns: number): string {
	return gridClasses[columns] || gridClasses[4];
}

/**
 * Get column span class for a widget.
 * Returns responsive span classes that gracefully collapse on smaller screens.
 * For custom responsive behavior, use className prop directly.
 */
function getSpanClass(span: number | undefined): string {
	if (!span || span <= 1) return "col-span-1";
	if (spanClasses[span]) return spanClasses[span];

	// Generate responsive classes for spans not in the map (7-11)
	// Progressive collapse: full span at lg+, 3 at md, 2 at xs, 1 on mobile
	if (span >= 7 && span <= 11) {
		return `col-span-1 @xs:col-span-2 @md:col-span-3 @lg:col-span-${span}`;
	}

	// Fallback for any other value
	return `col-span-${Math.min(span, 12)}`;
}

/**
 * Check if item is a widget config
 */
function isWidgetConfig(item: DashboardLayoutItem): item is WidgetConfig {
	return (
		typeof item === "object" &&
		"type" in item &&
		item.type !== "section" &&
		item.type !== "tabs"
	);
}

/**
 * Check if item is a section config
 */
function isSectionConfig(item: DashboardLayoutItem): item is DashboardSection {
	return typeof item === "object" && "type" in item && item.type === "section";
}

/**
 * Check if item is a tabs config
 */
function isTabsConfig(item: DashboardLayoutItem): item is DashboardTabs {
	return typeof item === "object" && "type" in item && item.type === "tabs";
}

/**
 * Generate a unique key for a layout item
 */
function getLayoutItemKey(item: DashboardLayoutItem, index: number): string {
	if (isWidgetConfig(item)) {
		return `widget-${item.id || item.type}-${index}`;
	}
	if (isSectionConfig(item)) {
		return `section-${index}`;
	}
	if (isTabsConfig(item)) {
		const tabIds = item.tabs.map((t) => t.id).join("-");
		return `tabs-${tabIds || index}`;
	}
	return `item-${index}`;
}

// ============================================================================
// Sub-components
// ============================================================================

interface DashboardHeaderProps {
	title?: string;
	description?: string;
	actions?: DashboardAction[];
	navigate?: (path: string) => void;
	resolveText: (text: any) => string;
}

function DashboardHeader({
	title,
	description,
	actions,
	navigate,
	resolveText,
}: DashboardHeaderProps) {
	if (!title && !description && !actions?.length) return null;

	const handleActionClick = (action: DashboardAction) => {
		if (action.onClick) {
			action.onClick();
		} else if (action.href && navigate) {
			navigate(action.href);
		}
	};

	// Split actions: primary (first with variant=primary or first action) shown as button
	// Rest go into dropdown on mobile, all visible on desktop
	const primaryAction =
		actions?.find((a) => a.variant === "primary") || actions?.[0];
	const secondaryActions = actions?.filter((a) => a !== primaryAction) || [];

	return (
		<div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 flex-1">
				{title && (
					<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
						{title}
					</h1>
				)}
				{description && (
					<p className="mt-1 text-muted-foreground">{description}</p>
				)}
			</div>
			{actions && actions.length > 0 && (
				<div className="flex items-center gap-2 shrink-0">
					{/* Primary action always visible */}
					{primaryAction && (
						<Button
							key={primaryAction.id}
							variant={
								primaryAction.variant === "primary"
									? "default"
									: primaryAction.variant || "default"
							}
							onClick={() => handleActionClick(primaryAction)}
						>
							{resolveIconElement(primaryAction.icon, {
								"data-icon": "inline-start",
							})}
							{resolveText(primaryAction.label)}
						</Button>
					)}

					{/* Secondary actions: visible on md+, hidden on mobile */}
					{secondaryActions.map((action) => {
						const iconElement = resolveIconElement(action.icon, {
							"data-icon": "inline-start",
						});
						const variant = action.variant || "default";

						return (
							<Button
								key={action.id}
								variant={variant === "primary" ? "default" : variant}
								onClick={() => handleActionClick(action)}
								className="hidden md:inline-flex"
							>
								{iconElement}
								{resolveText(action.label)}
							</Button>
						);
					})}

					{/* Dropdown for secondary actions on mobile */}
					{secondaryActions.length > 0 && (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button variant="outline" size="icon" className="md:hidden">
										<Icon icon="ph:dots-three-vertical" className="size-4" />
									</Button>
								}
							/>
							<DropdownMenuContent align="end">
								{secondaryActions.map((action) => (
									<DropdownMenuItem
										key={action.id}
										onClick={() => handleActionClick(action)}
									>
										{resolveIconElement(action.icon, {
											className: "size-4 mr-2",
										})}
										{resolveText(action.label)}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
			)}
		</div>
	);
}

// ============================================================================
// Layout Item Renderer
// ============================================================================

interface LayoutItemRendererProps {
	item: DashboardLayoutItem;
	index: number;
	columns: number;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function LayoutItemRenderer({
	item,
	index,
	columns,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: LayoutItemRendererProps) {
	// Widget
	if (isWidgetConfig(item)) {
		const spanClass = getSpanClass(item.span);
		const widgetConfig =
			dashboardRealtime !== undefined && item.realtime === undefined
				? ({ ...item, realtime: dashboardRealtime } as AnyWidgetConfig)
				: item;
		return (
			<div className={cn("min-h-0 h-full", spanClass, item.className)}>
				<DashboardWidget
					config={widgetConfig}
					basePath={basePath}
					navigate={navigate}
					widgetRegistry={widgetRegistry}
				/>
			</div>
		);
	}

	// Section
	if (isSectionConfig(item)) {
		return (
			<SectionRenderer
				section={item}
				basePath={basePath}
				navigate={navigate}
				widgetRegistry={widgetRegistry}
				resolveText={resolveText}
				dashboardRealtime={dashboardRealtime}
			/>
		);
	}

	// Tabs
	if (isTabsConfig(item)) {
		return (
			<TabsRenderer
				tabs={item}
				basePath={basePath}
				navigate={navigate}
				widgetRegistry={widgetRegistry}
				resolveText={resolveText}
				dashboardRealtime={dashboardRealtime}
			/>
		);
	}

	return null;
}

// ============================================================================
// Section Renderer
// ============================================================================

interface SectionRendererProps {
	section: DashboardSection;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function SectionRenderer({
	section,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: SectionRendererProps) {
	const {
		label,
		description,
		wrapper = "flat",
		defaultCollapsed = false,
		layout = "grid",
		columns = 4,
		gap,
		items,
		className,
	} = section;

	const sectionLabel = label ? resolveText(label) : undefined;
	const sectionDescription = description ? resolveText(description) : undefined;

	// Render items grid with container queries
	const itemsContent = (
		<div
			className={cn(
				"@container",
				layout === "grid" && "grid gap-4 items-stretch",
				layout === "grid" && getGridClass(columns),
				layout === "stack" && "flex flex-col gap-4",
			)}
			style={gap ? { gap: `${gap * 0.25}rem` } : undefined}
		>
			{items.map((item, index) => (
				<LayoutItemRenderer
					key={getLayoutItemKey(item, index)}
					item={item}
					index={index}
					columns={columns}
					basePath={basePath}
					navigate={navigate}
					widgetRegistry={widgetRegistry}
					resolveText={resolveText}
					dashboardRealtime={dashboardRealtime}
				/>
			))}
		</div>
	);

	// Flat wrapper (just label + content)
	if (wrapper === "flat") {
		return (
			<div className={cn("col-span-full", className)}>
				{(sectionLabel || sectionDescription) && (
					<div className="mb-4">
						{sectionLabel && (
							<h2 className="text-lg font-semibold">{sectionLabel}</h2>
						)}
						{sectionDescription && (
							<p className="text-sm text-muted-foreground mt-1">
								{sectionDescription}
							</p>
						)}
					</div>
				)}
				{itemsContent}
			</div>
		);
	}

	// Card wrapper
	if (wrapper === "card") {
		return (
			<Card className={cn("col-span-full", className)}>
				{(sectionLabel || sectionDescription) && (
					<CardHeader>
						{sectionLabel && <CardTitle>{sectionLabel}</CardTitle>}
						{sectionDescription && (
							<p className="text-sm text-muted-foreground">
								{sectionDescription}
							</p>
						)}
					</CardHeader>
				)}
				<CardContent>{itemsContent}</CardContent>
			</Card>
		);
	}

	// Collapsible wrapper
	if (wrapper === "collapsible") {
		return (
			<Accordion
				defaultValue={defaultCollapsed ? [] : [0]}
				className={cn("col-span-full", className)}
			>
				<AccordionItem className="border-none">
					<AccordionTrigger className="hover:no-underline py-2">
						<div className="text-left">
							{sectionLabel && (
								<span className="text-lg font-semibold">{sectionLabel}</span>
							)}
							{sectionDescription && (
								<p className="text-sm text-muted-foreground font-normal">
									{sectionDescription}
								</p>
							)}
						</div>
					</AccordionTrigger>
					<AccordionContent className="pt-4">{itemsContent}</AccordionContent>
				</AccordionItem>
			</Accordion>
		);
	}

	return itemsContent;
}

// ============================================================================
// Tabs Renderer
// ============================================================================

interface TabsRendererProps {
	tabs: DashboardTabs;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function TabsRenderer({
	tabs,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: TabsRendererProps) {
	const { tabs: tabConfigs, defaultTab, variant = "default" } = tabs;

	const defaultValue = defaultTab || tabConfigs[0]?.id;

	return (
		<Tabs defaultValue={defaultValue} className="col-span-full">
			<TabsList
				variant={variant === "line" ? "line" : "default"}
				className="mb-4"
			>
				{tabConfigs.map((tab) => (
					<TabsTrigger key={tab.id} value={tab.id}>
						{resolveIconElement(tab.icon, {
							className: "h-4 w-4 mr-2",
						})}
						{resolveText(tab.label)}
						{tab.badge !== undefined && (
							<span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
								{tab.badge}
							</span>
						)}
					</TabsTrigger>
				))}
			</TabsList>

			{tabConfigs.map((tab) => (
				<TabsContent key={tab.id} value={tab.id}>
					<TabContentRenderer
						tab={tab}
						basePath={basePath}
						navigate={navigate}
						widgetRegistry={widgetRegistry}
						resolveText={resolveText}
						dashboardRealtime={dashboardRealtime}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

interface TabContentRendererProps {
	tab: DashboardTabConfig;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function TabContentRenderer({
	tab,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: TabContentRendererProps) {
	// Default to 4 columns for tab content
	const columns = 4;

	return (
		<div
			className={cn(
				"@container grid gap-4 items-stretch",
				getGridClass(columns),
			)}
		>
			{tab.items.map((item, index) => (
				<LayoutItemRenderer
					key={getLayoutItemKey(item, index)}
					item={item}
					index={index}
					columns={columns}
					basePath={basePath}
					navigate={navigate}
					widgetRegistry={widgetRegistry}
					resolveText={resolveText}
					dashboardRealtime={dashboardRealtime}
				/>
			))}
		</div>
	);
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * DashboardGrid - Renders a configurable grid of dashboard widgets
 *
 * @example
 * ```tsx
 * const dashboardConfig: DashboardConfig = {
 *   title: "Dashboard",
 *   description: "Welcome to your admin dashboard",
 *   columns: 4,
 *   items: [
 *     { type: "stats", collection: "posts", label: "Total Posts", span: 1 },
 *     { type: "stats", collection: "users", label: "Total Users", span: 1 },
 *     {
 *       type: "section",
 *       label: "Analytics",
 *       wrapper: "card",
 *       items: [
 *         { type: "chart", collection: "posts", field: "createdAt", span: 2 },
 *       ]
 *     },
 *     {
 *       type: "tabs",
 *       tabs: [
 *         { id: "recent", label: "Recent", items: [...] },
 *         { id: "popular", label: "Popular", items: [...] },
 *       ]
 *     }
 *   ],
 * };
 *
 * <DashboardGrid config={dashboardConfig} basePath="/admin" navigate={navigate} />
 * ```
 */
export function DashboardGrid({
	config,
	basePath = "/admin",
	navigate,
	widgetRegistry,
	className,
}: DashboardGridProps): React.ReactElement {
	const resolveText = useResolveText();
	const {
		title,
		description,
		columns = 4,
		realtime: dashboardRealtime,
	} = config;

	// Support both new `items` and legacy `widgets` array
	const layoutItems = config.items || config.widgets || [];

	const resolvedTitle = title ? resolveText(title) : undefined;
	const resolvedDescription = description
		? resolveText(description)
		: undefined;

	// If no items, show empty state
	if (layoutItems.length === 0) {
		return (
			<div className={cn("@container", className)}>
				<DashboardHeader
					title={resolvedTitle}
					description={resolvedDescription}
					actions={config.actions}
					navigate={navigate}
					resolveText={resolveText}
				/>
				<div className="flex h-64 items-center justify-center border border-dashed border-border bg-card/50 rounded-lg">
					<div className="text-center">
						<p className="text-muted-foreground font-medium">
							No widgets configured
						</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Add widgets to your dashboard configuration to display data here.
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("@container", className)}>
			<DashboardHeader
				title={resolvedTitle}
				description={resolvedDescription}
				actions={config.actions}
				navigate={navigate}
				resolveText={resolveText}
			/>

			<div className={cn("grid gap-4 items-stretch", getGridClass(columns))}>
				{layoutItems.map((item, index) => (
					<LayoutItemRenderer
						key={getLayoutItemKey(item, index)}
						item={item}
						index={index}
						columns={columns}
						basePath={basePath}
						navigate={navigate}
						widgetRegistry={widgetRegistry}
						resolveText={resolveText}
						dashboardRealtime={dashboardRealtime}
					/>
				))}
			</div>
		</div>
	);
}
