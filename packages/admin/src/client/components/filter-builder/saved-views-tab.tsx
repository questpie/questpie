import { Icon } from "@iconify/react";
import { useState } from "react";

import { useTranslation } from "../../i18n/hooks.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { Skeleton } from "../ui/skeleton.js";
import type { FilterBuilderProps, SavedView } from "./types.js";

interface SavedViewsTabProps {
	collection: string;
	currentConfig: FilterBuilderProps["currentConfig"];
	savedViews: SavedView[];
	isLoading: boolean;
	onLoadView: (view: SavedView) => void;
	onSaveView: (
		name: string,
		config: FilterBuilderProps["currentConfig"],
	) => void;
	onDeleteView: (viewId: string) => void;
}

export function SavedViewsTab({
	currentConfig,
	savedViews,
	isLoading,
	onLoadView,
	onSaveView,
	onDeleteView,
}: SavedViewsTabProps) {
	const { t } = useTranslation();
	const [viewName, setViewName] = useState("");
	const activeFilters = currentConfig.filters.length;
	const visibleColumns = currentConfig.visibleColumns.length;
	const hasSort = !!currentConfig.sortConfig;
	const hasGrouping = !!currentConfig.groupBy;
	const saveSummary = [
		t("viewOptions.columnsCount", { count: visibleColumns }),
		t("viewOptions.filtersCount", { count: activeFilters }),
		hasGrouping ? t("viewOptions.groupBy") : null,
		hasSort ? t("viewOptions.sort") : null,
	]
		.filter(Boolean)
		.join(" · ");

	const handleSave = () => {
		if (!viewName.trim()) return;
		onSaveView(viewName.trim(), currentConfig);
		setViewName("");
	};

	const hasActiveConfig =
		activeFilters > 0 || hasSort || hasGrouping || visibleColumns > 0;

	return (
		<div className="space-y-4 py-4">
			<div className="space-y-2">
				<div>
					<p className="text-sm font-medium">
						{t("viewOptions.saveCurrentConfig")}
					</p>
					<p className="text-muted-foreground mt-0.5 text-xs text-pretty">
						{saveSummary || t("viewOptions.saveDescription")}
					</p>
				</div>

				<div className="flex gap-2">
					<Input
						className="h-9 flex-1"
						placeholder={t("viewOptions.viewNamePlaceholder")}
						value={viewName}
						onChange={(e) => setViewName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSave()}
					/>
					<Button
						onClick={handleSave}
						disabled={!viewName.trim()}
						size="sm"
						className="h-9 gap-2 px-3"
					>
						<Icon icon="ph:floppy-disk" width={16} height={16} />
						{t("common.save")}
					</Button>
				</div>
				{!hasActiveConfig && (
					<p className="text-warning text-xs">
						{t("viewOptions.noChangesToSave")}
					</p>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<p className="text-muted-foreground font-chrome chrome-meta text-xs font-medium">
						{t("viewOptions.savedViews")}
					</p>
					{savedViews.length > 0 && (
						<span className="text-muted-foreground text-xs tabular-nums">
							{savedViews.length}
						</span>
					)}
				</div>

				{isLoading && (
					<div className="space-y-2 py-2" aria-busy="true">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				)}

				{!isLoading && savedViews.length === 0 && (
					<p className="text-muted-foreground py-2 text-xs">
						{t("viewOptions.noSavedViews")}
					</p>
				)}

				{!isLoading &&
					savedViews.map((view) => (
						<div
							role="button"
							tabIndex={0}
							key={view.id}
							className="border-border-subtle bg-surface-low hover:border-border-strong hover:bg-surface-high group flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-left transition-[background-color,border-color]"
							onClick={() => onLoadView(view)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onLoadView(view);
								}
							}}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<Icon
										icon="ph:bookmark-simple"
										className="text-muted-foreground size-4 shrink-0"
									/>
									<p className="truncate text-sm font-medium transition-colors">
										{view.name}
									</p>
								</div>
								<p className="text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-1 pl-6 text-xs">
									<span className="tabular-nums">
										{t("viewOptions.filtersCount", {
											count: view.configuration.filters.length,
										})}
									</span>
									<span className="tabular-nums">
										{t("viewOptions.columnsCount", {
											count: view.configuration.visibleColumns.length,
										})}
									</span>
									{view.configuration.groupBy && (
										<span>{t("viewOptions.groupBy")}</span>
									)}
									{view.configuration.sortConfig && (
										<span>{t("viewOptions.sort")}</span>
									)}
									{view.isDefault && (
										<span className="text-foreground">
											{t("viewOptions.defaultView")}
										</span>
									)}
								</p>
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="icon-sm"
									onClick={(e) => {
										e.stopPropagation();
										onDeleteView(view.id);
									}}
									className="text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
								>
									<Icon icon="ph:trash" width={14} height={14} />
								</Button>
								<Icon
									icon="ph:arrow-right"
									width={14}
									height={14}
									className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
								/>
							</div>
						</div>
					))}
			</div>
		</div>
	);
}
