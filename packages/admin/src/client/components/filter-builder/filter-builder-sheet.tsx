import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";

import { useTranslation } from "../../i18n/hooks.js";
import {
	cloneFilters,
	filtersEqual,
	sortConfigEqual,
} from "../../lib/view-filter-utils.js";
import { SelectSingle } from "../primitives/select-single.js";
import { Button } from "../ui/button.js";
import {
	Sheet,
	SheetContent,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet.js";
import { Switch } from "../ui/switch.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs.js";
import { ColumnsTab } from "./columns-tab.js";
import { FiltersTab } from "./filters-tab.js";
import { SavedViewsTab } from "./saved-views-tab.js";
import type {
	AvailableField,
	FilterBuilderProps,
	FilterRule,
	SavedView,
	ViewConfiguration,
	FilterBuilderPanels,
} from "./types.js";

const NO_GROUPING_VALUE = "__none";
const NO_SORT_VALUE = "__none";

function arraysEqual<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): boolean {
	return a.length === b.length && a.every((v, i) => eq(v, b[i]));
}

function viewConfigEqual(a: ViewConfiguration, b: ViewConfiguration): boolean {
	return (
		filtersEqual(a.filters, b.filters) &&
		sortConfigEqual(a.sortConfig, b.sortConfig) &&
		arraysEqual(a.visibleColumns, b.visibleColumns, (x, y) => x === y) &&
		a.groupBy === b.groupBy &&
		arraysEqual(
			a.collapsedGroups ?? [],
			b.collapsedGroups ?? [],
			(x, y) => x === y,
		) &&
		a.realtime === b.realtime &&
		a.includeDeleted === b.includeDeleted
	);
}

// Module-level constant for empty array to avoid recreating on each render
const EMPTY_SAVED_VIEWS: SavedView[] = [];
const EMPTY_GROUPABLE_FIELDS: AvailableField[] = [];

function normalizeSavedViewConfig(
	config: ViewConfiguration,
): ViewConfiguration {
	return {
		filters: config.filters ?? [],
		sortConfig: config.sortConfig ?? null,
		visibleColumns: config.visibleColumns ?? [],
		groupBy: config.groupBy ?? null,
		collapsedGroups: [],
		realtime: config.realtime,
		includeDeleted: config.includeDeleted ?? false,
		pagination: {
			page: 1,
			pageSize: config.pagination?.pageSize ?? 25,
		},
	};
}

function ViewOptionRow({
	title,
	description,
	control,
}: {
	title: string;
	description: string;
	control: ReactNode;
}) {
	return (
		<div className="border-border-subtle flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
			<div className="min-w-0">
				<p className="text-sm font-medium">{title}</p>
				<p className="text-muted-foreground mt-0.5 text-xs text-pretty">
					{description}
				</p>
			</div>
			<div className="shrink-0">{control}</div>
		</div>
	);
}

interface FilterBuilderSheetProps extends FilterBuilderProps {
	/** Default columns from .list() config or auto-detection, used for reset */
	defaultColumns?: string[];

	/** Saved views for this collection */
	savedViews?: SavedView[];

	/** Whether saved views are loading */
	savedViewsLoading?: boolean;

	/** Callback when saving a new view */
	onSaveView?: (name: string, config: ViewConfiguration) => void;

	/** Callback when deleting a view */
	onDeleteView?: (viewId: string) => void;

	/** Whether collection supports soft delete */
	supportsSoftDelete?: boolean;

	/** Fields available for page-local grouping */
	groupableFields?: AvailableField[];

	/** Default grouping field from list config */
	defaultGroupBy?: string | null;

	/** Default filters from list config */
	defaultFilters?: FilterRule[];

	/** Which panels to show. Defaults: all true. */
	panels?: FilterBuilderPanels;
}

export function FilterBuilderSheet({
	collection,
	availableFields,
	currentConfig,
	onConfigChange,
	isOpen,
	onOpenChange,
	defaultColumns,
	savedViews,
	savedViewsLoading = false,
	onSaveView,
	onDeleteView,
	supportsSoftDelete = false,
	groupableFields = EMPTY_GROUPABLE_FIELDS,
	defaultGroupBy = null,
	defaultFilters = [],
	panels,
}: FilterBuilderSheetProps) {
	const resolvedSavedViews = savedViews ?? EMPTY_SAVED_VIEWS;
	const { t } = useTranslation();
	const {
		columns: showColumns = true,
		filters: showFilters = true,
		savedViews: showSavedViews = true,
	} = panels ?? {};

	// Local state for pending changes - reset when sheet opens or config changes
	const [localConfig, setLocalConfig] =
		useState<ViewConfiguration>(currentConfig);
	const [prev, setPrev] = useState({ isOpen, currentConfig });
	if (prev.isOpen !== isOpen || prev.currentConfig !== currentConfig) {
		setPrev({ isOpen, currentConfig });
		if (isOpen) {
			setLocalConfig(currentConfig);
		}
	}

	const handleLoadView = (view: SavedView) => {
		setLocalConfig(normalizeSavedViewConfig(view.configuration));
	};

	const handleSaveView = (name: string) => {
		onSaveView?.(name, normalizeSavedViewConfig(localConfig));
	};

	const handleApply = () => {
		onConfigChange(localConfig);
		onOpenChange(false);
	};

	const handleReset = () => {
		const resetConfig: ViewConfiguration = {
			filters: cloneFilters(defaultFilters),
			sortConfig: null,
			visibleColumns: defaultColumns ?? availableFields.map((f) => f.name),
			groupBy: defaultGroupBy,
			collapsedGroups: [],
			realtime: undefined,
			includeDeleted: false,
		};
		setLocalConfig(resetConfig);
	};

	const hasChanges = !viewConfigEqual(localConfig, currentConfig);
	const groupByOptions = useMemo(
		() => [
			{
				value: NO_GROUPING_VALUE,
				label: t("viewOptions.noGrouping"),
				icon: <Icon icon="ph:stack-simple" className="size-4 opacity-60" />,
			},
			...groupableFields.map((field) => ({
				value: field.name,
				label: field.label,
				icon: <Icon icon="ph:rows" className="size-4 opacity-60" />,
			})),
		],
		[groupableFields, t],
	);
	const sortOptions = useMemo(
		() => [
			{
				value: NO_SORT_VALUE,
				label: t("viewOptions.noSort"),
				icon: <Icon icon="ph:sort-ascending" className="size-4 opacity-60" />,
			},
			...availableFields.map((field) => ({
				value: field.name,
				label: field.label,
				icon: <Icon icon="ph:text-aa" className="size-4 opacity-60" />,
			})),
		],
		[availableFields, t],
	);

	return (
		<Sheet open={isOpen} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="qa-filter-builder flex flex-col p-0 sm:max-w-md"
			>
				<SheetHeader className="px-6 pt-6">
					<SheetTitle>{t("viewOptions.title")}</SheetTitle>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-6">
					<div className="mt-4">
						<ViewOptionRow
							title={t("viewOptions.realtime")}
							description={t("viewOptions.realtimeDescription")}
							control={
								<Switch
									checked={localConfig.realtime ?? true}
									onCheckedChange={(checked) =>
										setLocalConfig((prevConfig) => ({
											...prevConfig,
											realtime: checked,
										}))
									}
								/>
							}
						/>

						{supportsSoftDelete && (
							<ViewOptionRow
								title={t("viewOptions.showDeleted")}
								description={t("viewOptions.showDeletedDescription")}
								control={
									<Switch
										checked={localConfig.includeDeleted ?? false}
										onCheckedChange={(checked) =>
											setLocalConfig((prevConfig) => ({
												...prevConfig,
												includeDeleted: checked,
											}))
										}
									/>
								}
							/>
						)}

						{groupableFields.length > 0 && (
							<ViewOptionRow
								title={t("viewOptions.groupBy")}
								description={t("viewOptions.groupByDescription")}
								control={
									<SelectSingle
										id="view-options-group-by"
										value={localConfig.groupBy ?? NO_GROUPING_VALUE}
										onChange={(value) => {
											const nextGroupBy =
												!value || value === NO_GROUPING_VALUE ? null : value;
											setLocalConfig((prevConfig) => ({
												...prevConfig,
												groupBy: nextGroupBy,
												collapsedGroups: [],
												pagination: {
													...(prevConfig.pagination ?? { pageSize: 25 }),
													page: 1,
												},
											}));
										}}
										options={groupByOptions}
										clearable={false}
										emptyMessage={t("viewOptions.noFieldsAvailable")}
										placeholder={t("viewOptions.noGrouping")}
										drawerTitle={t("viewOptions.groupBy")}
										className="h-9 w-48"
									/>
								}
							/>
						)}

						<ViewOptionRow
							title={t("viewOptions.sort")}
							description={t("viewOptions.sortDescription")}
							control={
								<div className="flex items-center gap-2">
									<SelectSingle
										id="view-options-sort"
										value={localConfig.sortConfig?.field ?? NO_SORT_VALUE}
										onChange={(value) => {
											const nextSortField =
												!value || value === NO_SORT_VALUE ? null : value;
											setLocalConfig((prevConfig) => ({
												...prevConfig,
												sortConfig: nextSortField
													? {
															field: nextSortField,
															direction:
																prevConfig.sortConfig?.direction ?? "asc",
														}
													: null,
												pagination: {
													...(prevConfig.pagination ?? { pageSize: 25 }),
													page: 1,
												},
											}));
										}}
										options={sortOptions}
										clearable={false}
										emptyMessage={t("viewOptions.noFieldsAvailable")}
										placeholder={t("viewOptions.noSort")}
										drawerTitle={t("viewOptions.sort")}
										className="h-9 w-48"
									/>
									<Button
										variant="outline"
										size="icon-sm"
										disabled={!localConfig.sortConfig?.field}
										aria-label={
											localConfig.sortConfig?.direction === "asc"
												? t("table.sortDesc")
												: t("table.sortAsc")
										}
										onClick={() =>
											setLocalConfig((prevConfig) => ({
												...prevConfig,
												sortConfig: prevConfig.sortConfig
													? {
															...prevConfig.sortConfig,
															direction:
																prevConfig.sortConfig.direction === "asc"
																	? "desc"
																	: "asc",
														}
													: null,
												pagination: {
													...(prevConfig.pagination ?? { pageSize: 25 }),
													page: 1,
												},
											}))
										}
									>
										<Icon
											icon={
												localConfig.sortConfig?.direction === "asc"
													? "ph:sort-ascending"
													: "ph:sort-descending"
											}
										/>
									</Button>
								</div>
							}
						/>
					</div>

					<Tabs
						defaultValue={showColumns ? "columns" : "filters"}
						className="mt-4"
					>
						<TabsList className="w-full">
							{showColumns && (
								<TabsTrigger value="columns" className="flex-1">
									{t("viewOptions.columns")}
								</TabsTrigger>
							)}
							{showFilters && (
								<TabsTrigger value="filters" className="flex-1">
									{t("viewOptions.filters")}
									{localConfig.filters.length > 0 && (
										<span className="bg-foreground text-background ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums">
											{localConfig.filters.length}
										</span>
									)}
								</TabsTrigger>
							)}
							{showSavedViews && (
								<TabsTrigger value="views" className="flex-1">
									{t("viewOptions.savedViews")}
								</TabsTrigger>
							)}
						</TabsList>

						{showColumns && (
							<TabsContent value="columns">
								<ColumnsTab
									fields={availableFields}
									visibleColumns={localConfig.visibleColumns}
									onVisibleColumnsChange={(columns) =>
										setLocalConfig((prevConfig) => ({
											...prevConfig,
											visibleColumns: columns,
										}))
									}
								/>
							</TabsContent>
						)}

						{showFilters && (
							<TabsContent value="filters">
								<FiltersTab
									fields={availableFields}
									filters={localConfig.filters}
									onFiltersChange={(filters) =>
										setLocalConfig((prevConfig) => ({
											...prevConfig,
											filters,
										}))
									}
								/>
							</TabsContent>
						)}

						{showSavedViews && (
							<TabsContent value="views">
								<SavedViewsTab
									collection={collection}
									currentConfig={localConfig}
									savedViews={resolvedSavedViews}
									isLoading={savedViewsLoading}
									onLoadView={handleLoadView}
									onSaveView={handleSaveView}
									onDeleteView={onDeleteView || (() => {})}
								/>
							</TabsContent>
						)}
					</Tabs>
				</div>

				<SheetFooter className="mt-4 border-t px-6 py-4">
					<div className="flex w-full gap-2">
						<Button variant="outline" onClick={handleReset} className="flex-1">
							{t("viewOptions.reset")}
						</Button>
						<Button onClick={handleApply} className="flex-1">
							{t("viewOptions.apply")}
							{hasChanges && " *"}
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
