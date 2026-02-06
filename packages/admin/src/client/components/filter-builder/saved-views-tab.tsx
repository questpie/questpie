import { Icon } from "@iconify/react";
import { useState } from "react";
import { useTranslation } from "../../i18n/index.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import type { FilterBuilderProps, SavedView } from "./types.js";

export interface SavedViewsTabProps {
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
      <div className="bg-primary/5 p-4 border border-primary/20 rounded-lg">
        <p className="block text-xs font-semibold uppercase text-primary mb-2">
          {t("viewOptions.saveCurrentConfig")}
        </p>
        <div className="flex gap-2">
          <Input
            className="flex-1 h-9 rounded-md"
            placeholder={t("viewOptions.viewNamePlaceholder")}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button
            onClick={handleSave}
            disabled={!viewName.trim()}
            size="sm"
            className="h-9 px-3 rounded-md"
          >
            <Icon icon="ph:floppy-disk" width={16} height={16} />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {t("viewOptions.saveDescription")}
        </p>
        {!hasActiveConfig && (
          <p className="text-xs text-amber-600 mt-1">
            {t("viewOptions.noChangesToSave")}
          </p>
        )}
      </div>

      {/* Saved Views List */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
          {t("viewOptions.savedViews")}
        </p>

        {isLoading && (
          <div className="flex justify-center p-4 text-muted-foreground">
            <Icon icon="ph:spinner-gap" className="size-5 animate-spin" />
          </div>
        )}

        {!isLoading && savedViews.length === 0 && (
          <div className="text-center p-4 text-muted-foreground text-xs italic">
            {t("viewOptions.noSavedViews")}
          </div>
        )}

        {!isLoading &&
          savedViews.map((view) => (
            <button
              type="button"
              key={view.id}
              className="flex w-full items-center justify-between p-3 border border-border hover:border-primary/50 hover:shadow-sm bg-background group cursor-pointer transition-all rounded-lg text-left"
              onClick={() => onLoadView(view)}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                  {view.name}
                </p>
                <p className="text-xs text-muted-foreground flex gap-2">
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
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                >
                  <Icon icon="ph:trash" width={14} height={14} />
                </Button>
                <Icon
                  icon="ph:arrow-right"
                  width={14}
                  height={14}
                  className="opacity-0 group-hover:opacity-100 text-primary transition-opacity"
                />
              </div>
            </button>
          ))}
      </div>
    </div>
  );
}
