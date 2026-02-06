/**
 * EmbeddedCollectionField Component
 *
 * Manages embedded collections with inline, modal, or drawer editing.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { EmbeddedCollectionProps } from "../../builder";
import { useResolveText, useTranslation } from "../../i18n/hooks";
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
import { LocaleBadge } from "./locale-badge";

type RowLabel = ((item: any) => string) | string;

export interface EmbeddedCollectionFieldProps extends Omit<
  EmbeddedCollectionProps,
  "rowLabel"
> {
  rowLabel?: RowLabel;
  renderFields?: (index: number) => React.ReactNode;
  minItems?: number;
  maxItems?: number;
}

export function EmbeddedCollectionField({
  name,
  value,
  collection,
  mode = "inline",
  orderable = false,
  rowLabel,
  label,
  description,
  required,
  disabled,
  readOnly,
  error,
  placeholder,
  localized,
  locale,
  renderFields,
  minItems,
  maxItems,
}: EmbeddedCollectionFieldProps) {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const form = useFormContext();
  const { control } = form;
  const { fields, append, remove, move } = useFieldArray({ control, name });
  const values = (useWatch({ control, name }) as any[] | undefined) ?? value;
  const resolvedLabel = label ? resolveText(label) : undefined;
  const resolvedPlaceholder = placeholder
    ? resolveText(placeholder)
    : undefined;

  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const canAddMore = !maxItems || fields.length < maxItems;
  const canRemove = !readOnly && (!minItems || fields.length > minItems);
  const fallbackLabel = resolvedLabel || collection || "Item";
  const emptyLabel = t("array.empty", { name: fallbackLabel });
  const addLabel = t("array.addItem", { name: fallbackLabel });

  const resolveRowLabel = React.useCallback(
    (item: any, index: number) => {
      if (typeof rowLabel === "function") {
        const labelValue = rowLabel(item);
        if (labelValue) return labelValue;
      }
      if (typeof rowLabel === "string") {
        const labelValue = item?.[rowLabel];
        if (labelValue) return String(labelValue);
      }
      // Prefer _title computed field from backend
      if (item?._title) return String(item._title);
      if (item?.title) return String(item.title);
      if (item?.name) return String(item.name);
      return `${fallbackLabel} ${index + 1}`;
    },
    [fallbackLabel, rowLabel],
  );

  const handleAdd = () => {
    if (disabled || readOnly || !canAddMore) return;
    append({});
    if (mode !== "inline") {
      const nextIndex = fields.length;
      setActiveIndex(nextIndex);
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

  const renderItemFields = (index: number) => {
    if (!renderFields) {
      return (
        <div className="rounded-lg border border-dashed p-4 text-center">
          <p className="text-sm text-muted-foreground">
            Form fields not configured.
          </p>
        </div>
      );
    }
    return renderFields(index);
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
      ? resolveRowLabel(values?.[activeIndex], activeIndex)
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
              const itemLabel = resolveRowLabel(itemValue, index);
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
                      {orderable && !readOnly && (
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
                          disabled={disabled || !renderFields}
                          title={readOnly ? "View" : "Edit"}
                          aria-label={readOnly ? "View item" : "Edit item"}
                        >
                          <Icon icon="ph:pencil" className="h-3 w-3" />
                        </Button>
                      )}
                      {!readOnly && canRemove && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => handleRemove(index)}
                          disabled={disabled}
                          title="Remove"
                          aria-label="Remove item"
                        >
                          <Icon icon="ph:trash" className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {mode === "inline" && (
                    <div className="space-y-3 p-3">
                      {renderItemFields(index)}
                    </div>
                  )}
                </div>
              );
            })}
      </div>

      {!readOnly && canAddMore && (
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

      {error && <p className="text-sm text-destructive">{error}</p>}

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
            <div className="px-4 pb-4">{editorContent}</div>
            <div className="px-4 pb-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
