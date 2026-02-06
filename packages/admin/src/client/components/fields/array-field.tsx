/**
 * ArrayField Component
 *
 * Handles arrays of primitive values or objects with optional ordering.
 * When `item` prop is provided, delegates to ObjectArrayField for object items.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFieldArray, useFormContext, useWatch } from "react-hook-form";
import type { FieldComponentProps } from "../../builder";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import { Textarea } from "../ui/textarea";
import type { ArrayFieldConfig } from "./field-types";
import { LocaleBadge } from "./locale-badge";
import { ObjectArrayField } from "./object-array-field";

export type ArrayFieldItemType =
  | "text"
  | "number"
  | "email"
  | "textarea"
  | "select";

export interface ArrayFieldProps
  extends
    FieldComponentProps<any[]>,
    Pick<
      ArrayFieldConfig,
      "item" | "mode" | "layout" | "columns" | "itemLabel"
    > {
  itemType?: ArrayFieldItemType;
  options?: Array<{ label: string; value: any }>;
  orderable?: boolean;
  minItems?: number;
  maxItems?: number;
}

export function ArrayField({
  name,
  value,
  label,
  description,
  placeholder,
  required,
  disabled,
  readOnly,
  error,
  localized,
  locale,
  itemType = "text",
  options,
  orderable = false,
  minItems,
  maxItems,
  // Object array props
  item,
  mode,
  layout,
  columns,
  itemLabel,
}: ArrayFieldProps) {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const resolvedPlaceholder = placeholder
    ? resolveText(placeholder)
    : undefined;
  const resolvedDescription = description
    ? resolveText(description)
    : undefined;
  const resolvedLabel = label ? resolveText(label) : undefined;
  const fallbackLabel = resolvedLabel || "item";
  const emptyLabel = t("array.empty", { name: fallbackLabel });
  const addLabel = t("array.addItem", { name: fallbackLabel });
  const form = useFormContext();
  const { control } = form;
  const { fields, append, remove, move } = useFieldArray({ control, name });
  const values = (useWatch({ control, name }) as any[] | undefined) ?? value;

  const canAddMore = !maxItems || fields.length < maxItems;
  const canRemove = !readOnly && (!minItems || fields.length > minItems);

  const createEmptyItem = React.useCallback(() => {
    if (itemType === "number") return undefined;
    if (itemType === "select") {
      return options?.[0]?.value ?? "";
    }
    return "";
  }, [itemType, options]);

  // Delegate to ObjectArrayField if item prop is provided (object array)
  if (item) {
    return (
      <ObjectArrayField
        name={name}
        label={label}
        description={description}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        localized={localized}
        locale={locale}
        item={item}
        mode={mode}
        layout={layout}
        columns={columns}
        itemLabel={itemLabel}
        orderable={orderable}
        minItems={minItems}
        maxItems={maxItems}
      />
    );
  }

  // Primitive array handling below

  const handleAdd = () => {
    if (disabled || readOnly || !canAddMore) return;
    append(createEmptyItem());
  };

  const handleRemove = (index: number) => {
    if (!canRemove) return;
    remove(index);
  };

  const handleMove = (from: number, to: number) => {
    if (to < 0 || to >= fields.length) return;
    move(from, to);
  };

  const renderItemInput = (index: number) => {
    const itemName = `${name}.${index}`;
    const itemValue = values?.[index];
    const itemPlaceholder = resolvedPlaceholder || `Item ${index + 1}`;

    if (itemType === "textarea") {
      return (
        <Textarea
          id={itemName}
          placeholder={itemPlaceholder}
          disabled={disabled || readOnly}
          defaultValue={itemValue ?? ""}
          {...form.register(itemName)}
        />
      );
    }

    if (itemType === "select") {
      return (
        <Select
          value={itemValue ?? ""}
          onValueChange={(value) =>
            form.setValue(itemName, value, {
              shouldDirty: true,
              shouldTouch: true,
            })
          }
          disabled={disabled || readOnly}
        >
          <SelectTrigger id={itemName}>
            <span className="truncate">
              {options?.find((o) => o.value === itemValue)?.label
                ? resolveText(options.find((o) => o.value === itemValue)?.label)
                : itemPlaceholder}
            </span>
          </SelectTrigger>
          <SelectContent>
            {options?.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {resolveText(option.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <Input
        id={itemName}
        type={itemType === "email" ? "email" : itemType}
        placeholder={itemPlaceholder}
        disabled={disabled || readOnly}
        defaultValue={itemValue ?? ""}
        {...form.register(
          itemName,
          itemType === "number" ? { valueAsNumber: true } : undefined,
        )}
      />
    );
  };

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
      {resolvedDescription && (
        <p className="text-sm text-muted-foreground">{resolvedDescription}</p>
      )}

      <div className="space-y-2">
        {fields.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">
              {resolvedPlaceholder || emptyLabel}
            </p>
          </div>
        ) : (
          fields.map((field, index) => {
            const canMoveUp = orderable && index > 0;
            const canMoveDown = orderable && index < fields.length - 1;

            return (
              <div key={field.id} className="flex items-start gap-2">
                <div className="flex-1">{renderItemInput(index)}</div>
                {orderable && !readOnly && (
                  <div className="flex flex-col gap-1">
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
                  </div>
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
            );
          })
        )}
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
    </div>
  );
}
