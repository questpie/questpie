import { useState } from "react";
import { useTranslation } from "../../i18n/hooks.js";
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
	FilterBuilderProps,
	SavedView,
	ViewConfiguration,
} from "./types.js";

// Module-level constant for empty array to avoid recreating on each render
const EMPTY_SAVED_VIEWS: SavedView[] = [];

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
}: FilterBuilderSheetProps) {
	const resolvedSavedViews = savedViews ?? EMPTY_SAVED_VIEWS;
	const { t } = useTranslation();

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
		setLocalConfig(view.configuration);
	};

	const handleSaveView = (name: string) => {
		onSaveView?.(name, localConfig);
	};

	const handleApply = () => {
		onConfigChange(localConfig);
		onOpenChange(false);
	};

	const handleReset = () => {
		const resetConfig: ViewConfiguration = {
			filters: [],
			sortConfig: null,
			visibleColumns: defaultColumns ?? availableFields.map((f) => f.name),
			realtime: undefined,
			includeDeleted: false,
		};
		setLocalConfig(resetConfig);
	};

	const hasChanges =
		JSON.stringify(localConfig) !== JSON.stringify(currentConfig);

	return (
		<Sheet open={isOpen} onOpenChange={onOpenChange}>
			<SheetContent
				side="right"
				className="qa-filter-builder sm:max-w-md flex flex-col p-0"
			>
				<SheetHeader className="px-6 pt-6">
					<SheetTitle>{t("viewOptions.title")}</SheetTitle>
				</SheetHeader>

				<div className="flex-1 overflow-y-auto px-6">
					<div className="mt-4 rounded-md border border-border bg-muted px-3 py-2">
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-sm font-medium">Realtime Updates</p>
								<p className="text-xs text-muted-foreground">
									Auto-refresh this table when data changes.
								</p>
							</div>
							<Switch
								checked={localConfig.realtime ?? true}
								onCheckedChange={(checked) =>
									setLocalConfig({ ...localConfig, realtime: checked })
								}
							/>
						</div>
					</div>

					{supportsSoftDelete && (
						<div className="mt-3 rounded-md border border-border bg-muted px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="text-sm font-medium">
										{t("viewOptions.showDeleted")}
									</p>
									<p className="text-xs text-muted-foreground">
										{t("viewOptions.showDeletedDescription")}
									</p>
								</div>
								<Switch
									checked={localConfig.includeDeleted ?? false}
									onCheckedChange={(checked) =>
										setLocalConfig({ ...localConfig, includeDeleted: checked })
									}
								/>
							</div>
						</div>
					)}

					<Tabs defaultValue="columns" className="mt-4">
						<TabsList variant="line" className="w-full">
							<TabsTrigger value="columns" className="flex-1">
								{t("viewOptions.columns")}
							</TabsTrigger>
							<TabsTrigger value="filters" className="flex-1">
								{t("viewOptions.filters")}
								{localConfig.filters.length > 0 && (
									<span className="ml-1.5 bg-primary text-primary-foreground text-xs px-1.5 py-0.5 rounded-full">
										{localConfig.filters.length}
									</span>
								)}
							</TabsTrigger>
							<TabsTrigger value="views" className="flex-1">
								{t("viewOptions.savedViews")}
							</TabsTrigger>
						</TabsList>

						<TabsContent value="columns">
							<ColumnsTab
								fields={availableFields}
								visibleColumns={localConfig.visibleColumns}
								onVisibleColumnsChange={(columns) =>
									setLocalConfig({ ...localConfig, visibleColumns: columns })
								}
							/>
						</TabsContent>

						<TabsContent value="filters">
							<FiltersTab
								fields={availableFields}
								filters={localConfig.filters}
								onFiltersChange={(filters) =>
									setLocalConfig({ ...localConfig, filters })
								}
							/>
						</TabsContent>

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
					</Tabs>
				</div>

				<SheetFooter className="border-t px-6 py-4 mt-4">
					<div className="flex w-full gap-2">
						<Button
							variant="outline"
							onClick={handleReset}
							className="flex-1 rounded-md"
						>
							{t("viewOptions.reset")}
						</Button>
						<Button onClick={handleApply} className="flex-1 rounded-md">
							{t("viewOptions.apply")}
							{hasChanges && " *"}
						</Button>
					</div>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}
