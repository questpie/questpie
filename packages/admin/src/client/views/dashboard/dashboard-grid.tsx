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
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { AdminViewHeader } from "../layout/admin-view-layout";
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
 * Grid column classes for different column counts.
 * Uses fixed auto rows so cards align like tile-based mobile widgets.
 */
const gridClasses: Record<number, string> = {
	1: "grid-cols-1",
	2: "grid-cols-2",
	3: "grid-cols-2 @md:grid-cols-3",
	4: "grid-cols-2 @md:grid-cols-4",
	5: "grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-5",
	6: "grid-cols-2 @sm:grid-cols-3 @md:grid-cols-4 @lg:grid-cols-6",
	7: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-7",
	8: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-8",
	9: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-9",
	10: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-10",
	11: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-11",
	12: "grid-cols-2 @xs:grid-cols-4 @md:grid-cols-6 @lg:grid-cols-12",
};

/**
 * Span classes for widget column spanning.
 */
const spanClasses: Record<number, string> = {
	1: "col-span-1",
	2: "col-span-2",
	3: "col-span-2 @md:col-span-3",
	4: "col-span-2 @md:col-span-4",
	5: "col-span-2 @md:col-span-4 @lg:col-span-5",
	6: "col-span-2 @md:col-span-4 @lg:col-span-6",
	7: "col-span-2 @xs:col-span-4 @md:col-span-6 @lg:col-span-7",
	8: "col-span-2 @xs:col-span-4 @md:col-span-6 @lg:col-span-8",
	9: "col-span-2 @xs:col-span-4 @md:col-span-6 @lg:col-span-9",
	10: "col-span-2 @xs:col-span-4 @md:col-span-6 @lg:col-span-10",
	11: "col-span-2 @xs:col-span-4 @md:col-span-6 @lg:col-span-11",
	12: "col-span-full",
};

const DEFAULT_ROW_HEIGHT = "8.5rem";

const sizeLayoutDefaults: Record<
	NonNullable<WidgetConfig["size"]>,
	{ span: number; rowSpan: number }
> = {
	small: { span: 1, rowSpan: 1 },
	medium: { span: 2, rowSpan: 1 },
	large: { span: 2, rowSpan: 2 },
	full: { span: 12, rowSpan: 2 },
};

const widgetTypeRowDefaults: Record<string, number> = {
	stats: 1,
	value: 1,
	progress: 1,
	chart: 2,
	quickActions: 2,
	recentItems: 2,
	table: 2,
	timeline: 2,
	custom: 2,
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get grid columns class based on column count
 */
function getGridClass(columns: number): string {
	return gridClasses[Math.min(Math.max(columns, 1), 12)] || gridClasses[4];
}

/**
 * Get column span class for a widget.
 * Returns responsive span classes that gracefully collapse on smaller screens.
 * For custom responsive behavior, use className prop directly.
 */
function getSpanClass(span: number | undefined): string {
	if (!span || span <= 1) return "col-span-1";
	if (spanClasses[span]) return spanClasses[span];
	return spanClasses[Math.min(Math.max(span, 1), 12)] ?? "col-span-full";
}

function normalizeRowHeight(rowHeight: number | string | undefined): string {
	if (typeof rowHeight === "number") return `${rowHeight}px`;
	if (rowHeight) return rowHeight;
	return DEFAULT_ROW_HEIGHT;
}

function getGridStyle(
	rowHeight: number | string | undefined,
	gap: number | undefined,
): React.CSSProperties {
	return {
		gridAutoRows: normalizeRowHeight(rowHeight),
		...(gap ? { gap: `${gap * 0.25}rem` } : {}),
	};
}

function getStackStyle(
	gap: number | undefined,
): React.CSSProperties | undefined {
	return gap ? { gap: `${gap * 0.25}rem` } : undefined;
}

function getWidgetSpan(item: WidgetConfig): number {
	const position = item.position;
	const sizeDefault = item.size ? sizeLayoutDefaults[item.size] : undefined;
	return Math.min(
		Math.max(position?.w ?? item.span ?? sizeDefault?.span ?? 1, 1),
		12,
	);
}

function getWidgetRowSpan(item: WidgetConfig): number {
	const position = item.position;
	const sizeDefault = item.size ? sizeLayoutDefaults[item.size] : undefined;
	const rowSpan =
		position?.h ??
		item.rowSpan ??
		sizeDefault?.rowSpan ??
		widgetTypeRowDefaults[item.type] ??
		2;

	return Math.min(Math.max(rowSpan, 1), 8);
}

function getWidgetStyle(rowSpan: number): React.CSSProperties {
	return { gridRowEnd: `span ${rowSpan}` };
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
		return `section-${item.id || index}`;
	}
	if (isTabsConfig(item)) {
		const tabIds = item.tabs.map((t) => t.id).join("-");
		return `tabs-${item.id || tabIds || index}`;
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
		<AdminViewHeader
			className="qa-dashboard__header mb-4"
			title={title}
			description={description}
			actions={
				actions && actions.length > 0 ? (
					<>
						{/* Primary action always visible */}
						{primaryAction && (
							<Button
								key={primaryAction.id}
								variant={
									primaryAction.variant === "primary"
										? "default"
										: primaryAction.variant || "default"
								}
								size="sm"
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
									size="sm"
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
										<Button
											variant="outline"
											size="icon-sm"
											className="md:hidden"
										>
											<Icon
												icon="ph:dots-three-vertical"
												className="size-3.5"
											/>
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
					</>
				) : undefined
			}
		/>
	);
}

// ============================================================================
// Layout Item Renderer
// ============================================================================

interface LayoutItemRendererProps {
	item: DashboardLayoutItem;
	index: number;
	columns: number;
	rowHeight?: number | string;
	gap?: number;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function LayoutItemRenderer({
	item,
	columns,
	rowHeight,
	gap,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: LayoutItemRendererProps) {
	// Widget
	if (isWidgetConfig(item)) {
		const spanClass = getSpanClass(getWidgetSpan(item));
		const rowSpan = getWidgetRowSpan(item);
		const widgetConfig =
			dashboardRealtime !== undefined && item.realtime === undefined
				? ({ ...item, realtime: dashboardRealtime } as AnyWidgetConfig)
				: item;
		return (
			<div
				className={cn(
					"qa-dashboard__tile h-full min-h-0 min-w-0",
					spanClass,
					item.className,
				)}
				style={getWidgetStyle(rowSpan)}
			>
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
				rowHeight={rowHeight}
				gap={gap}
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
				rowHeight={rowHeight}
				gap={gap}
			/>
		);
	}

	return null;
}

interface LayoutItemsRendererProps {
	items: DashboardLayoutItem[];
	columns: number;
	rowHeight?: number | string;
	gap?: number;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
}

function WidgetGridGroup({
	items,
	columns,
	rowHeight,
	gap,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: LayoutItemsRendererProps) {
	return (
		<div
			className={cn(
				"@container grid items-stretch gap-4",
				getGridClass(columns),
			)}
			style={getGridStyle(rowHeight, gap)}
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
					rowHeight={rowHeight}
					gap={gap}
				/>
			))}
		</div>
	);
}

function LayoutItemsRenderer({
	items,
	columns,
	rowHeight,
	gap,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
}: LayoutItemsRendererProps) {
	const blocks: React.ReactNode[] = [];
	let widgetGroup: DashboardLayoutItem[] = [];
	let widgetGroupStart = 0;

	const flushWidgetGroup = () => {
		if (widgetGroup.length === 0) return;

		blocks.push(
			<WidgetGridGroup
				key={`widgets-${widgetGroupStart}`}
				items={widgetGroup}
				columns={columns}
				rowHeight={rowHeight}
				gap={gap}
				basePath={basePath}
				navigate={navigate}
				widgetRegistry={widgetRegistry}
				resolveText={resolveText}
				dashboardRealtime={dashboardRealtime}
			/>,
		);
		widgetGroup = [];
	};

	items.forEach((item, index) => {
		if (isWidgetConfig(item)) {
			if (widgetGroup.length === 0) widgetGroupStart = index;
			widgetGroup.push(item);
			return;
		}

		flushWidgetGroup();
		blocks.push(
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
				rowHeight={rowHeight}
				gap={gap}
			/>,
		);
	});

	flushWidgetGroup();

	return (
		<div className="qa-dashboard__stack flex flex-col gap-7">{blocks}</div>
	);
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
	rowHeight?: number | string;
	gap?: number;
}

function SectionRenderer({
	section,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
	rowHeight: inheritedRowHeight,
	gap: inheritedGap,
}: SectionRendererProps) {
	const {
		label,
		description,
		wrapper = "flat",
		defaultCollapsed = false,
		layout = "grid",
		columns = 4,
		gap: sectionGap,
		rowHeight: sectionRowHeight,
		items,
		className,
	} = section;
	const rowHeight = sectionRowHeight ?? inheritedRowHeight;
	const gap = sectionGap ?? inheritedGap;

	const sectionLabel = label ? resolveText(label) : undefined;
	const sectionDescription = description ? resolveText(description) : undefined;

	const itemsContent =
		layout === "grid" ? (
			<LayoutItemsRenderer
				items={items}
				columns={columns}
				basePath={basePath}
				navigate={navigate}
				widgetRegistry={widgetRegistry}
				resolveText={resolveText}
				dashboardRealtime={dashboardRealtime}
				rowHeight={rowHeight}
				gap={gap}
			/>
		) : (
			<div
				className="@container flex flex-col gap-4"
				style={getStackStyle(gap)}
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
						rowHeight={rowHeight}
						gap={gap}
					/>
				))}
			</div>
		);

	// Flat wrapper (just label + content)
	if (wrapper === "flat") {
		return (
			<section className={cn("min-w-0", className)}>
				{(sectionLabel || sectionDescription) && (
					<div className="mb-4">
						{sectionLabel && (
							<h2 className="text-base font-semibold text-balance">
								{sectionLabel}
							</h2>
						)}
						{sectionDescription && (
							<p className="text-muted-foreground mt-1 text-sm text-pretty">
								{sectionDescription}
							</p>
						)}
					</div>
				)}
				{itemsContent}
			</section>
		);
	}

	// Card wrapper
	if (wrapper === "card") {
		return (
			<Card className={cn("min-w-0", className)}>
				{(sectionLabel || sectionDescription) && (
					<CardHeader>
						{sectionLabel && <CardTitle>{sectionLabel}</CardTitle>}
						{sectionDescription && (
							<p className="text-muted-foreground text-sm">
								{sectionDescription}
							</p>
						)}
					</CardHeader>
				)}
				<CardContent className="min-w-0">{itemsContent}</CardContent>
			</Card>
		);
	}

	// Collapsible wrapper
	if (wrapper === "collapsible") {
		return (
			<Accordion
				defaultValue={defaultCollapsed ? [] : [0]}
				className={cn("min-w-0", className)}
			>
				<AccordionItem className="border-none">
					<AccordionTrigger className="py-2 hover:no-underline">
						<div className="text-left">
							{sectionLabel && (
								<span className="text-lg font-semibold">{sectionLabel}</span>
							)}
							{sectionDescription && (
								<p className="text-muted-foreground text-sm font-normal">
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
	columns?: number;
	rowHeight?: number | string;
	gap?: number;
}

function TabsRenderer({
	tabs,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
	columns = 4,
	rowHeight,
	gap,
}: TabsRendererProps) {
	const { tabs: tabConfigs, defaultTab } = tabs;
	const visibleTabs = tabConfigs.filter((tab) => tab.items.length > 0);

	if (visibleTabs.length === 0) return null;

	const defaultValue = visibleTabs.some((tab) => tab.id === defaultTab)
		? defaultTab
		: visibleTabs[0]?.id;

	return (
		<Tabs defaultValue={defaultValue} className={cn("min-w-0", tabs.className)}>
			<div className="mb-4 max-w-full overflow-x-auto">
				<TabsList className="w-full min-w-max">
					{visibleTabs.map((tab) => (
						<TabsTrigger key={tab.id} value={tab.id} className="flex-1">
							{resolveIconElement(tab.icon, {
								className: "size-3.5",
							})}
							{resolveText(tab.label)}
							{tab.badge !== undefined && (
								<span className="bg-foreground text-background ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums">
									{tab.badge}
								</span>
							)}
						</TabsTrigger>
					))}
				</TabsList>
			</div>

			{visibleTabs.map((tab) => (
				<TabsContent key={tab.id} value={tab.id} className="min-w-0">
					<TabContentRenderer
						tab={tab}
						columns={columns}
						basePath={basePath}
						navigate={navigate}
						widgetRegistry={widgetRegistry}
						resolveText={resolveText}
						dashboardRealtime={dashboardRealtime}
						rowHeight={rowHeight}
						gap={gap}
					/>
				</TabsContent>
			))}
		</Tabs>
	);
}

interface TabContentRendererProps {
	tab: DashboardTabConfig;
	columns?: number;
	basePath: string;
	navigate?: (path: string) => void;
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
	resolveText: (text: any) => string;
	dashboardRealtime?: boolean;
	rowHeight?: number | string;
	gap?: number;
}

function TabContentRenderer({
	tab,
	columns: inheritedColumns = 4,
	basePath,
	navigate,
	widgetRegistry,
	resolveText,
	dashboardRealtime,
	rowHeight: inheritedRowHeight,
	gap: inheritedGap,
}: TabContentRendererProps) {
	const columns = tab.columns ?? inheritedColumns;
	const rowHeight = tab.rowHeight ?? inheritedRowHeight;
	const gap = tab.gap ?? inheritedGap;

	return (
		<LayoutItemsRenderer
			items={tab.items}
			columns={columns}
			basePath={basePath}
			navigate={navigate}
			widgetRegistry={widgetRegistry}
			resolveText={resolveText}
			dashboardRealtime={dashboardRealtime}
			rowHeight={rowHeight}
			gap={gap}
		/>
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
	const { t } = useTranslation();
	const {
		title,
		description,
		columns = 4,
		rowHeight,
		gap,
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
			<div className={cn("qa-dashboard @container", className)}>
				<DashboardHeader
					title={resolvedTitle}
					description={resolvedDescription}
					actions={config.actions}
					navigate={navigate}
					resolveText={resolveText}
				/>
				<div className="flex h-48 items-center justify-center">
					<div className="text-center">
						<p className="text-muted-foreground font-medium">
							{t("dashboard.noWidgets")}
						</p>
						<p className="text-muted-foreground mt-1 text-sm">
							{t("dashboard.noWidgetsDescription")}
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("qa-dashboard @container", className)}>
			<DashboardHeader
				title={resolvedTitle}
				description={resolvedDescription}
				actions={config.actions}
				navigate={navigate}
				resolveText={resolveText}
			/>

			<LayoutItemsRenderer
				items={layoutItems}
				columns={columns}
				rowHeight={rowHeight}
				gap={gap}
				basePath={basePath}
				navigate={navigate}
				widgetRegistry={widgetRegistry}
				resolveText={resolveText}
				dashboardRealtime={dashboardRealtime}
			/>
		</div>
	);
}
