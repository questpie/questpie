"use client";

import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Checkbox } from "../ui/checkbox";
import type {
  CheckboxGroupProps,
  CheckboxInputProps,
  RadioGroupProps,
} from "./types";

/**
 * Checkbox Input Primitive
 *
 * A single checkbox with value/onChange pattern.
 *
 * @example
 * ```tsx
 * <CheckboxInput
 *   value={isAccepted}
 *   onChange={setIsAccepted}
 * />
 * ```
 */
export function CheckboxInput({
  value,
  onChange,
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: CheckboxInputProps) {
  return (
    <Checkbox
      id={id}
      checked={value}
      onCheckedChange={(checked) => onChange(checked === true)}
      disabled={disabled}
      aria-invalid={ariaInvalid}
      className={className}
    />
  );
}

/**
 * Checkbox Group Primitive
 *
 * A group of checkboxes for multi-selection.
 * Returns an array of selected values.
 *
 * @example
 * ```tsx
 * <CheckboxGroup
 *   value={selectedCategories}
 *   onChange={setSelectedCategories}
 *   options={[
 *     { value: "news", label: "News" },
 *     { value: "blog", label: "Blog" },
 *     { value: "tutorial", label: "Tutorial" },
 *   ]}
 *   orientation="vertical"
 * />
 * ```
 */
export function CheckboxGroup<TValue extends string = string>({
  value,
  onChange,
  options,
  orientation = "vertical",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: CheckboxGroupProps<TValue>) {
  const resolveText = useResolveText();
  const handleChange = (optionValue: TValue, checked: boolean) => {
    if (checked) {
      onChange([...value, optionValue]);
    } else {
      onChange(value.filter((v) => v !== optionValue));
    }
  };

  return (
    <div
      id={id}
      role="group"
      aria-invalid={ariaInvalid}
      className={cn(
        "flex gap-3",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
    >
      {options.map((option) => {
        const optionId = `${id}-${String(option.value)}`;
        return (
          <div
            key={String(option.value)}
            className={cn(
              "flex items-center gap-2",
              option.disabled || disabled
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer",
            )}
          >
            <CheckboxInput
              id={optionId}
              value={value.includes(option.value)}
              onChange={(checked) => handleChange(option.value, checked)}
              disabled={option.disabled || disabled}
            />
            <label htmlFor={optionId} className="text-sm cursor-pointer">
              {resolveText(option.label)}
            </label>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Radio Group Primitive
 *
 * A group of radio buttons for single selection.
 * Returns the selected value or null.
 *
 * @example
 * ```tsx
 * <RadioGroup
 *   value={selectedPriority}
 *   onChange={setSelectedPriority}
 *   options={[
 *     { value: "low", label: "Low" },
 *     { value: "medium", label: "Medium" },
 *     { value: "high", label: "High" },
 *   ]}
 * />
 * ```
 */
export function RadioGroup<TValue extends string = string>({
  value,
  onChange,
  options,
  orientation = "vertical",
  disabled,
  className,
  id,
  "aria-invalid": ariaInvalid,
}: RadioGroupProps<TValue>) {
  const resolveText = useResolveText();
  return (
    <div
      id={id}
      role="radiogroup"
      aria-invalid={ariaInvalid}
      className={cn(
        "flex gap-3",
        orientation === "vertical" ? "flex-col" : "flex-row flex-wrap",
        className,
      )}
    >
      {options.map((option) => {
        const optionId = `${id}-${String(option.value)}`;
        return (
          <div
            key={String(option.value)}
            className={cn(
              "flex items-center gap-2",
              option.disabled || disabled
                ? "opacity-50 cursor-not-allowed"
                : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              id={optionId}
              name={id}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={option.disabled || disabled}
              className={cn(
                "size-4 shrink-0 accent-primary",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
            <label htmlFor={optionId} className="text-sm cursor-pointer">
              {resolveText(option.label)}
            </label>
          </div>
        );
      })}
    </div>
  );
}
