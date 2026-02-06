/**
 * RelationSelect Component
 *
 * Single relation field (one-to-one) with:
 * - Searchable select dropdown to choose existing item
 * - Plus button to create new related item (opens side sheet)
 * - Edit button to modify selected item (opens side sheet)
 * - Responsive: Popover on desktop, Drawer on mobile
 */

import { Icon } from "@iconify/react";
import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import * as React from "react";
import { toast } from "sonner";
import { useCollectionItem } from "../../hooks/use-collection";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectClient, useAdminStore } from "../../runtime";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { SelectSingle } from "../primitives/select-single";
import type { SelectOption } from "../primitives/types";
import { ResourceSheet } from "../sheets/resource-sheet";
import { Button } from "../ui/button";
import { LocaleBadge } from "./locale-badge";

export interface RelationSelectProps<_T extends Questpie<any>> {
  /**
   * Field name
   */
  name: string;

  /**
   * Current value (ID of related item)
   */
  value?: string | null;

  /**
   * Change handler
   */
  onChange: (value: string | null) => void;

  /**
   * Target collection name
   */
  targetCollection: string;

  /**
   * Label for the field
   */
  label?: string;

  /**
   * Localized field
   */
  localized?: boolean;

  /**
   * Active locale
   */
  locale?: string;

  /**
   * Filter options based on form values
   */
  filter?: (formValues: any) => any;

  /**
   * Is the field required
   */
  required?: boolean;

  /**
   * Is the field disabled
   */
  disabled?: boolean;

  /**
   * Is the field readonly
   */
  readOnly?: boolean;

  /**
   * Placeholder text
   */
  placeholder?: string;

  /**
   * Error message
   */
  error?: string;

  /**
   * Custom render function for dropdown options
   */
  renderOption?: (item: any) => React.ReactNode;

  /**
   * Custom render function for selected value
   */
  renderValue?: (item: any) => React.ReactNode;
}

export function RelationSelect<T extends Questpie<any>>({
  name,
  value,
  onChange,
  targetCollection,
  label,
  filter,
  required,
  disabled,
  readOnly,
  placeholder,
  error,
  localized,
  locale,
  renderOption,
  renderValue,
}: RelationSelectProps<T>) {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const resolvedLabel = label ? resolveText(label) : undefined;
  const resolvedPlaceholder = placeholder
    ? resolveText(placeholder)
    : undefined;
  const labelText = resolvedLabel || targetCollection;
  const selectLabel = t("relation.select", { name: labelText });
  const noResultsLabel = t("relation.noResults", { name: labelText });
  const createLabel = t("relation.createNew", { name: labelText });
  const [isSheetOpen, setIsSheetOpen] = React.useState(false);
  const [editingItemId, setEditingItemId] = React.useState<
    string | undefined
  >();

  // Get admin config for target collection from server
  const { data: serverConfig } = useAdminConfig();
  const client = useAdminStore(selectClient);
  const targetConfig = serverConfig?.collections?.[targetCollection];
  const CollectionIcon = (targetConfig as any)?.icon as
    | React.ComponentType<{ className?: string }>
    | undefined;

  // Load options from server with search
  const loadOptions = React.useCallback(
    async (search: string): Promise<SelectOption<string>[]> => {
      if (!client) return [];

      try {
        const options: any = {
          limit: 50,
          locale,
        };

        // Add search filter for _title
        if (search) {
          options.search = search;
        }

        // Add custom filter if provided
        if (filter) {
          options.where = filter({});
        }

        const response = await (client as any).collections[
          targetCollection
        ].find(options);
        const docs = response?.docs || [];

        return docs.map((item: any) => ({
          value: item.id,
          label: renderOption
            ? String(renderOption(item))
            : item._title || item.id || "",
          icon: CollectionIcon ? (
            <CollectionIcon className="size-3.5 text-muted-foreground" />
          ) : undefined,
        }));
      } catch (error) {
        console.error("Failed to load relation options:", error);
        toast.error("Failed to load options");
        return [];
      }
    },
    [client, targetCollection, filter, renderOption, CollectionIcon, locale],
  );

  const queryClient = useQueryClient();
  const queryOpts = React.useMemo(
    () =>
      createQuestpieQueryOptions(
        (client ?? {}) as any,
        {
          keyPrefix: ["questpie", "collections"],
        } as any,
      ),
    [client],
  );

  // Refetch for mutations (after create/update)
  const refetch = React.useCallback(async () => {
    queryClient.invalidateQueries({
      queryKey: queryOpts.key(["collections", targetCollection, "find"]),
    });
    queryClient.invalidateQueries({
      queryKey: queryOpts.key([
        "collections",
        targetCollection,
        "findOne",
        { where: { id: value || "" } },
      ]),
    });
  }, [queryClient, queryOpts, targetCollection, value]);

  // Fetch selected item details using the hook
  const { data: selectedItem } = useCollectionItem(
    targetCollection,
    value || "",
    undefined,
    { enabled: !!value },
  );

  const selectedOptions = React.useMemo(() => {
    if (!selectedItem) return [];
    return [
      {
        value: selectedItem.id,
        label: renderValue
          ? String(renderValue(selectedItem))
          : selectedItem._title || selectedItem.id || "",
        icon: CollectionIcon ? (
          <CollectionIcon className="size-3.5 text-muted-foreground" />
        ) : undefined,
      },
    ];
  }, [selectedItem, renderValue, CollectionIcon]);

  const handleOpenCreate = () => {
    setEditingItemId(undefined);
    setIsSheetOpen(true);
  };

  const handleOpenEdit = () => {
    if (!value) return;
    setEditingItemId(value);
    setIsSheetOpen(true);
  };

  const handleValueChange = (newValue: string | null) => {
    onChange(newValue);
  };

  // Handle save from ResourceSheet
  const handleSheetSave = React.useCallback(
    async (result: any) => {
      // Select newly created item (create mode = no editingItemId)
      if (!editingItemId && result?.id) {
        onChange(result.id);
      }
      await refetch();
    },
    [editingItemId, onChange, refetch],
  );

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-2">
          <label
            htmlFor={name}
            className="text-sm font-medium flex items-center gap-1.5"
          >
            {CollectionIcon && (
              <CollectionIcon className="size-3.5 text-muted-foreground" />
            )}
            {resolvedLabel}
            {required && <span className="text-destructive">*</span>}
          </label>
          {localized && <LocaleBadge locale={locale || "i18n"} />}
        </div>
      )}

      <div className="flex items-stretch gap-0">
        {/* Searchable Select Dropdown - uses server-side search */}
        <div className="min-w-0 flex-1">
          <SelectSingle
            id={name}
            value={value || null}
            onChange={handleValueChange}
            options={selectedOptions}
            loadOptions={loadOptions}
            queryKey={(search) =>
              queryOpts.key([
                "collections",
                targetCollection,
                "find",
                {
                  limit: 50,
                  locale,
                  search,
                  where: filter ? filter({}) : undefined,
                },
              ])
            }
            prefetchOnMount
            placeholder={resolvedPlaceholder || `${selectLabel}...`}
            disabled={disabled || readOnly}
            clearable={!required}
            emptyMessage={noResultsLabel}
            drawerTitle={selectLabel}
            className={cn(
              !readOnly && "rounded-r-none",
              error && "border-destructive",
            )}
            aria-invalid={!!error}
          />
        </div>

        {/* Action Buttons */}
        {!readOnly && (
          <div className="flex">
            {/* Edit button (only if value is set) */}
            {value && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleOpenEdit}
                disabled={disabled}
                title={t("collection.edit", { name: labelText })}
                aria-label={t("collection.edit", { name: labelText })}
                className="rounded-none border-l-0"
              >
                <Icon icon="ph:pencil" className="h-4 w-4" />
              </Button>
            )}

            {/* Create button */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={handleOpenCreate}
              disabled={disabled}
              title={createLabel}
              aria-label={createLabel}
              className="border-l-0 rounded-l-none"
            >
              <Icon icon="ph:plus" className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Error message */}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Side Sheet for Create/Edit */}
      <ResourceSheet
        type="collection"
        collection={targetCollection}
        itemId={editingItemId}
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        onSave={handleSheetSave}
      />
    </div>
  );
}
