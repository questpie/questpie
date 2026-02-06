/**
 * RelationField Component
 *
 * Unified relation field that automatically chooses between:
 * - RelationSelect (single relation / one-to-one)
 * - RelationPicker (multiple relations / one-to-many, many-to-many)
 *
 * Integrates with react-hook-form via Controller.
 */

import type { Questpie } from "questpie";
import type * as React from "react";
import { type Control, Controller, useFormContext } from "react-hook-form";
import { useResolveText } from "../../i18n/hooks";
import { RelationPicker, type RelationPickerProps } from "./relation-picker";
import { RelationSelect, type RelationSelectProps } from "./relation-select";

export type RelationFieldProps<T extends Questpie<any>> = {
  /**
   * Field name (for react-hook-form)
   */
  name: string;

  /**
   * Target collection name
   */
  targetCollection: string;

  /**
   * Relation type:
   * - "single" (one-to-one) - uses RelationSelect
   * - "multiple" (one-to-many, many-to-many) - uses RelationPicker
   */
  type: "single" | "multiple";

  /**
   * Label for the field
   */
  label?: string;

  /**
   * Description/help text
   */
  description?: string;

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
   * Enable drag-and-drop reordering (only for multiple type)
   */
  orderable?: boolean;

  /**
   * Maximum number of items (only for multiple type)
   */
  maxItems?: number;

  /**
   * Custom render function for dropdown options
   */
  renderOption?: (item: any) => React.ReactNode;

  /**
   * Custom render function for selected value (single) or items (multiple)
   */
  renderValue?: (item: any) => React.ReactNode;

  /**
   * Custom render function for selected items (only for multiple type)
   */
  renderItem?: (item: any, index: number) => React.ReactNode;

  /**
   * Form control (optional, will use useFormContext if not provided)
   */
  control?: Control<any>;
};

/**
 * Unified relation field component that integrates with react-hook-form.
 *
 * Automatically chooses between RelationSelect (single) and RelationPicker (multiple)
 * based on the `type` prop.
 *
 * @example
 * ```tsx
 * // Single relation (one-to-one)
 * <RelationField
 *   name="author"
 *   targetCollection="users"
 *   type="single"
 *   label="Author"
 *   required
 * />
 *
 * // Multiple relations (many-to-many)
 * <RelationField
 *   name="tags"
 *   targetCollection="tags"
 *   type="multiple"
 *   label="Tags"
 *   maxItems={5}
 *   orderable
 * />
 * ```
 */
export function RelationField<T extends Questpie<any>>({
  name,
  targetCollection,
  type,
  label,
  description,
  localized,
  locale,
  filter,
  required,
  disabled,
  readOnly,
  placeholder,
  orderable,
  maxItems,
  renderOption,
  renderValue,
  renderItem,
  control: controlProp,
}: RelationFieldProps<T>) {
  const resolveText = useResolveText();
  const resolvedLabel = label ? resolveText(label) : undefined;
  const resolvedDescription = description
    ? resolveText(description)
    : undefined;
  const formContext = useFormContext();
  const control = controlProp ?? formContext?.control;

  if (!control) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "RelationField: No form control found. Make sure to use within FormProvider or pass control prop.",
      );
    }
    return null;
  }

  return (
    <Controller
      name={name}
      control={control}
      rules={{
        required: required ? `${resolvedLabel || name} is required` : undefined,
      }}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;

        if (type === "single") {
          return (
            <div className="space-y-1">
              <RelationSelect<T>
                name={name}
                value={field.value as string | null}
                onChange={field.onChange}
                targetCollection={targetCollection}
                label={resolvedLabel}
                localized={localized}
                locale={locale}
                filter={filter}
                required={required}
                disabled={disabled}
                readOnly={readOnly}
                placeholder={placeholder}
                error={error}
                renderOption={renderOption}
                renderValue={renderValue}
              />
              {resolvedDescription && !error && (
                <p className="text-muted-foreground text-xs">
                  {resolvedDescription}
                </p>
              )}
            </div>
          );
        }

        return (
          <div className="space-y-1">
            <RelationPicker<T>
              name={name}
              value={field.value as string[] | null}
              onChange={field.onChange}
              targetCollection={targetCollection}
              label={resolvedLabel}
              localized={localized}
              locale={locale}
              filter={filter}
              required={required}
              disabled={disabled}
              readOnly={readOnly}
              placeholder={placeholder}
              error={error}
              orderable={orderable}
              maxItems={maxItems}
              renderOption={renderOption}
              renderItem={renderItem}
            />
            {resolvedDescription && !error && (
              <p className="text-muted-foreground text-xs">
                {resolvedDescription}
              </p>
            )}
          </div>
        );
      }}
    />
  );
}
