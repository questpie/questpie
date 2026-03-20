import { Icon } from "@iconify/react";
import { useState } from "react";

import { useTranslation } from "../../i18n/hooks.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
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
	collection,
	currentConfig,
	savedViews,
	isLoading,
	onLoadView,
	onSaveView,
	onDeleteView,
}: SavedViewsTabProps) {
	const { t } = useTranslation();
	const [viewName, setViewName] = useState("");

	const handleSave = () => {
		if (!viewName.trim()) return;
		onSaveView(viewName.trim(), currentConfig);
		setViewName("");
	};

	const hasActiveConfig =
		currentConfig.filters.length > 0 ||
		currentConfig.sortConfig !== null ||
		currentConfig.visibleColumns.length > 0;

	return (
		<div className="space-y-6 py-4">
			{/* Save Current Configuration */}
			<div className="bg-primary/5 border-primary/20 rounded-lg border p-4">
				<p className="text-primary mb-2 block text-xs font-semibold uppercase">
					{t("viewOptions.saveCurrentConfig")}
				</p>
				<div className="flex gap-2">
					<Input
						className="h-9 flex-1 rounded-md"
						placeholder={t("viewOptions.viewNamePlaceholder")}
						value={viewName}
						onChange={(e) => setViewName(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && handleSave()}
					/>
					<Button
						onClick={handleSave}
						disabled={!viewName.trim()}
						size="sm"
						className="h-9 rounded-md px-3"
					>
						<Icon icon="ph:floppy-disk" width={16} height={16} />
					</Button>
				</div>
				<p className="text-muted-foreground mt-2 text-xs">
					{t("viewOptions.saveDescription")}
				</p>
				{!hasActiveConfig && (
					<p className="text-warning mt-1 text-xs">
						{t("viewOptions.noChangesToSave")}
					</p>
				)}
			</div>

			{/* Saved Views List */}
			<div className="space-y-2">
				<p className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
					{t("viewOptions.savedViews")}
				</p>

				{isLoading && (
					<div className="text-muted-foreground flex justify-center p-4">
						<Icon icon="ph:spinner-gap" className="size-5 animate-spin" />
					</div>
				)}

				{!isLoading && savedViews.length === 0 && (
					<div className="text-muted-foreground p-4 text-center text-xs italic">
						{t("viewOptions.noSavedViews")}
					</div>
				)}

				{!isLoading &&
					savedViews.map((view) => (
						<button
							type="button"
							key={view.id}
							className="border-border hover:border-primary/50 bg-background group flex w-full cursor-pointer items-center justify-between rounded-lg border p-3 text-left transition-all hover:shadow-sm"
							onClick={() => onLoadView(view)}
						>
							<div className="min-w-0 flex-1">
								<p className="group-hover:text-primary truncate text-sm font-medium transition-colors">
									{view.name}
								</p>
								<p className="text-muted-foreground flex gap-2 text-xs">
									<span>
										{t("viewOptions.filtersCount", {
											count: view.configuration.filters.length,
										})}
									</span>
									<span>•</span>
									<span>
										{t("viewOptions.columnsCount", {
											count: view.configuration.visibleColumns.length,
										})}
									</span>
									{view.isDefault && (
										<>
											<span>•</span>
											<span className="text-primary">
												{t("viewOptions.defaultView")}
											</span>
										</>
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
									className="text-primary opacity-0 transition-opacity group-hover:opacity-100"
								/>
							</div>
						</button>
					))}
			</div>
		</div>
	);
}
