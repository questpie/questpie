/**
 * ObjectArrayField Component
 *
 * Manages arrays of objects with inline, modal, or drawer editing.
 * Similar to EmbeddedCollectionField but with inline field definitions.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { FieldDefinition } from "../../builder/field/field";
import { createFieldRegistryProxy } from "../../builder/proxies";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectAdmin, useAdminStore } from "../../runtime";
import { FormField } from "../../views/collection/form-field";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import type { ArrayFieldConfig, BaseFieldProps } from "./field-types";
import { gridColumnClasses } from "./field-utils";
import { LocaleBadge } from "./locale-badge";

// ============================================================================
// Types
// ============================================================================

export interface ObjectArrayFieldProps
  extends
    BaseFieldProps,
    Pick<
      ArrayFieldConfig,
      | "item"
      | "mode"
      | "layout"
      | "columns"
      | "itemLabel"
      | "orderable"
      | "minItems"
      | "maxItems"
    > {}

// ============================================================================
// Nested Field Renderer (for object items)
// ============================================================================

interface ItemFieldRendererProps {
  fieldName: string;
  fieldDef: FieldDefinition;
  parentName: string;
  disabled?: boolean;
}

function ItemFieldRenderer({
  fieldName,
  fieldDef,
  parentName,
  disabled,
}: ItemFieldRendererProps) {
  const resolveText = useResolveText();
  const fullName = `${parentName}.${fieldName}`;
  const fieldType = fieldDef.name;
  const options = fieldDef["~options"] || {};

  return (
    <FormField
      name={fullName}
      label={resolveText(options.label)}
      description={resolveText(options.description)}
      placeholder={resolveText(options.placeholder)}
      required={options.required}
      disabled={disabled || options.disabled}
      type={fieldType as any}
      options={options.options}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ObjectArrayField({
  name,
  label,
  description,
  placeholder,
  required,
  disabled,
  localized,
  locale,
  item: itemProp,
  mode = "inline",
  layout = "stack",
  columns = 2,
  itemLabel: itemLabelProp,
  orderable = false,
  minItems,
  maxItems,
}: ObjectArrayFieldProps) {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const resolvedPlaceholder = placeholder
    ? resolveText(placeholder)
    : undefined;
  const resolvedLabel = label ? resolveText(label) : undefined;
  const form = useFormContext();
  const { control } = form;
  const { fields, append, remove, move } = useFieldArray({ control, name });
  const values = useWatch({ control, name }) as any[] | undefined;

  const admin = useAdminStore(selectAdmin);
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  // Resolve item field definitions
  const itemFields = React.useMemo(() => {
    if (!itemProp) return {};

    if (typeof itemProp === "function") {
      const registeredFields = admin.getFields();
      const r = createFieldRegistryProxy(registeredFields as any);
      return itemProp({ r });
    }

    return itemProp;
  }, [itemProp, admin]);

  const fieldEntries = Object.entries(itemFields);
  const canAddMore = !maxItems || fields.length < maxItems;
  const canRemove = !minItems || fields.length > minItems;
  const fallbackLabel = resolvedLabel || "Item";
  const emptyLabel = t("array.empty", { name: fallbackLabel });
  const addLabel = t("array.addItem", { name: fallbackLabel });

  // Resolve item label
  const resolveItemLabel = React.useCallback(
    (item: any, index: number) => {
      if (typeof itemLabelProp === "function") {
        const labelValue = itemLabelProp(item, index);
        if (labelValue) return labelValue;
      }
      if (typeof itemLabelProp === "string") {
        return resolveText(itemLabelProp);
      }
      // Try common label fields
      if (item?.name) return String(item.name);
      if (item?.title) return String(item.title);
      if (item?.label) return String(item.label);
      return `${fallbackLabel} ${index + 1}`;
    },
    [fallbackLabel, itemLabelProp, resolveText],
  );

  const handleAdd = () => {
    if (disabled || !canAddMore) return;
    // Create empty object with keys from field definitions (immutable pattern)
    const emptyItem = Object.fromEntries(
      fieldEntries.map(([key]) => [key, undefined]),
    );
    append(emptyItem);
    if (mode !== "inline") {
      setActiveIndex(fields.length);
      setIsOpen(true);
    }
  };

  const handleRemove = (index: number) => {
    if (!canRemove) return;
    remove(index);
    if (activeIndex === null) return;
    if (index === activeIndex) {
      setIsOpen(false);
      setActiveIndex(null);
    } else if (index < activeIndex) {
      setActiveIndex(activeIndex - 1);
    }
  };

  const handleMove = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    move(from, to);
    if (activeIndex === null) return;
    if (activeIndex === from) {
      setActiveIndex(to);
    } else if (activeIndex === to) {
      setActiveIndex(from);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      setActiveIndex(null);
    }
  };

  // Render fields for an item at given index
  const renderItemFields = (index: number) => {
    if (fieldEntries.length === 0) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No fields configured for items.
          </p>
        </div>
      );
    }

    const fieldElements = fieldEntries.map(([fieldName, fieldDef]) => (
      <ItemFieldRenderer
        key={fieldName}
        fieldName={fieldName}
        fieldDef={fieldDef as FieldDefinition}
        parentName={`${name}.${index}`}
        disabled={disabled}
      />
    ));

    if (layout === "inline") {
      return (
        <div className="flex flex-wrap items-end gap-2">{fieldElements}</div>
      );
    }

    if (layout === "grid") {
      return (
        <div
          className={cn(
            "grid gap-4",
            gridColumnClasses[columns] || "grid-cols-2",
          )}
        >
          {fieldElements}
        </div>
      );
    }

    // Default: stack
    return <div className="space-y-4">{fieldElements}</div>;
  };

  const emptyState = (
    <div className="rounded-lg border border-dashed p-4 text-center">
      <p className="text-sm text-muted-foreground">
        {resolvedPlaceholder || emptyLabel}
      </p>
    </div>
  );

  const editorContent =
    activeIndex !== null ? renderItemFields(activeIndex) : null;
  const editorTitle =
    activeIndex !== null
      ? resolveItemLabel(values?.[activeIndex], activeIndex)
      : fallbackLabel;

  const showEditor = mode === "modal" || mode === "drawer";

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center gap-2">
          <label htmlFor={name} className="text-sm font-medium">
            {resolvedLabel}
            {required && <span className="text-destructive">*</span>}
            {maxItems && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({fields.length}/{maxItems})
              </span>
            )}
          </label>
          {localized && <LocaleBadge locale={locale || "i18n"} />}
        </div>
      )}
      {description && (
        <p className="text-sm text-muted-foreground">
          {resolveText(description)}
        </p>
      )}

      <div className="space-y-3">
        {fields.length === 0
          ? emptyState
          : fields.map((field, index) => {
              const itemValue = values?.[index];
              const itemLabel = resolveItemLabel(itemValue, index);
              const canMoveUp = orderable && index > 0;
              const canMoveDown = orderable && index < fields.length - 1;

              return (
                <div
                  key={field.id}
                  className="rounded-lg border border-border/60 bg-card/30 backdrop-blur-sm"
                >
                  <div className="flex items-center justify-between border-b px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        #{index + 1}
                      </span>
                      <span className="text-sm font-medium">{itemLabel}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {orderable && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleMove(index, index - 1)}
                            disabled={!canMoveUp || disabled}
                            title="Move up"
                            aria-label="Move item up"
                          >
                            <Icon icon="ph:caret-up" className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() => handleMove(index, index + 1)}
                            disabled={!canMoveDown || disabled}
                            title="Move down"
                            aria-label="Move item down"
                          >
                            <Icon icon="ph:caret-down" className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      {mode !== "inline" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            setActiveIndex(index);
                            setIsOpen(true);
                          }}
                          disabled={disabled}
                          title={t("common.edit")}
                          aria-label={t("common.edit")}
                        >
                          <Icon icon="ph:pencil" className="h-3 w-3" />
                        </Button>
                      )}
                      {canRemove && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemove(index)}
                          disabled={disabled}
                          title={t("common.remove")}
                          aria-label={t("common.remove")}
                        >
                          <Icon icon="ph:trash" className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {mode === "inline" && (
                    <div className="p-3">{renderItemFields(index)}</div>
                  )}
                </div>
              );
            })}
      </div>

      {canAddMore && (
        <Button
          type="button"
          variant="outline"
          onClick={handleAdd}
          disabled={disabled}
        >
          <Icon icon="ph:plus" className="h-4 w-4" />
          {addLabel}
        </Button>
      )}

      {showEditor && mode === "modal" && (
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editorTitle}</DialogTitle>
              {description && (
                <DialogDescription>
                  {resolveText(description)}
                </DialogDescription>
              )}
            </DialogHeader>
            <div className="space-y-4">{editorContent}</div>
          </DialogContent>
        </Dialog>
      )}

      {showEditor && mode === "drawer" && (
        <Sheet open={isOpen} onOpenChange={handleOpenChange}>
          <SheetContent side="right" className="sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>{editorTitle}</SheetTitle>
              {description && (
                <SheetDescription>{resolveText(description)}</SheetDescription>
              )}
            </SheetHeader>
            <div className="space-y-4 p-4">{editorContent}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
