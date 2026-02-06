import type { ReactNode } from "react";
import type { I18nText } from "../../i18n/types";

// =============================================================================
// Base Props (shared by all primitives)
// =============================================================================

export interface BasePrimitiveProps {
  /** Unique identifier */
  id?: string;
  /** Placeholder text */
  placeholder?: I18nText;
  /** Disabled state */
  disabled?: boolean;
  /** Read-only state */
  readOnly?: boolean;
  /** Additional class names */
  className?: string;
  /** aria-invalid for error state */
  "aria-invalid"?: boolean;
}

// =============================================================================
// Text Inputs
// =============================================================================

export interface TextInputProps extends BasePrimitiveProps {
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password" | "url" | "tel" | "search";
  maxLength?: number;
  autoComplete?: string;
}

export interface NumberInputProps extends BasePrimitiveProps {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Show increment/decrement buttons */
  showButtons?: boolean;
}

export interface TextareaInputProps extends BasePrimitiveProps {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength?: number;
  autoResize?: boolean;
}

// =============================================================================
// Select / Multi-Select
// =============================================================================

export interface SelectOption<TValue = string> {
  value: TValue;
  label: I18nText;
  disabled?: boolean;
  icon?: ReactNode;
}

export interface SelectOptionGroup<TValue = string> {
  label: I18nText;
  options: SelectOption<TValue>[];
}

export type SelectOptions<TValue = string> =
  | SelectOption<TValue>[]
  | SelectOptionGroup<TValue>[];

// =============================================================================
// Boolean Inputs
// =============================================================================
// Boolean Inputs
// =============================================================================

export interface ToggleInputProps extends BasePrimitiveProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Size variant */
  size?: "sm" | "default" | "lg";
}

export interface CheckboxInputProps extends BasePrimitiveProps {
  value: boolean;
  onChange: (value: boolean) => void;
  /** Indeterminate state */
  indeterminate?: boolean;
}

export interface CheckboxGroupProps<
  TValue = string,
> extends BasePrimitiveProps {
  value: TValue[];
  onChange: (value: TValue[]) => void;
  options: SelectOption<TValue>[];
  /** Layout direction */
  orientation?: "horizontal" | "vertical";
}

export interface RadioGroupProps<TValue = string> extends BasePrimitiveProps {
  value: TValue | null;
  onChange: (value: TValue) => void;
  options: SelectOption<TValue>[];
  orientation?: "horizontal" | "vertical";
}

// =============================================================================
// Date/Time Inputs
// =============================================================================

export interface DateInputProps extends BasePrimitiveProps {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Minimum date */
  minDate?: Date;
  /** Maximum date */
  maxDate?: Date;
  /** Date format display */
  format?: string;
}

export interface DateTimeInputProps extends DateInputProps {
  /** Time precision */
  precision?: "minute" | "second";
}

export interface TimeInputProps extends BasePrimitiveProps {
  value: string | null; // "HH:mm" or "HH:mm:ss"
  onChange: (value: string | null) => void;
  precision?: "minute" | "second";
}

export interface DateRangeInputProps extends BasePrimitiveProps {
  value: { start: Date | null; end: Date | null };
  onChange: (value: { start: Date | null; end: Date | null }) => void;
  minDate?: Date;
  maxDate?: Date;
}

// =============================================================================
// Special Inputs
// =============================================================================

export interface TagInputProps extends BasePrimitiveProps {
  value: string[];
  onChange: (value: string[]) => void;
  /** Suggestions for autocomplete */
  suggestions?: string[];
  /** Max tags */
  maxTags?: number;
  /** Allow duplicates */
  allowDuplicates?: boolean;
  /** Validation pattern */
  pattern?: RegExp;
}

export interface ColorInputProps extends BasePrimitiveProps {
  value: string; // hex color
  onChange: (value: string) => void;
  /** Preset colors */
  presets?: string[];
  /** Allow alpha */
  alpha?: boolean;
}

export interface SliderInputProps extends BasePrimitiveProps {
  value: number | [number, number];
  onChange: (value: number | [number, number]) => void;
  min: number;
  max: number;
  step?: number;
  /** Show value label */
  showValue?: boolean;
}

export interface JsonEditorProps extends BasePrimitiveProps {
  value: unknown;
  onChange: (value: unknown) => void;
  /** Max height */
  maxHeight?: string;
  /** Line numbers */
  showLineNumbers?: boolean;
  /** Schema for validation */
  schema?: unknown;
}

// =============================================================================
// Utility Types
// =============================================================================

/** Check if options are grouped */
export function isOptionGroup<T>(
  option: SelectOption<T> | SelectOptionGroup<T>,
): option is SelectOptionGroup<T> {
  return "options" in option;
}

/** Flatten grouped options */
export function flattenOptions<T>(
  options: SelectOptions<T>,
): SelectOption<T>[] {
  return options.flatMap((opt) => (isOptionGroup(opt) ? opt.options : [opt]));
}
