import type { HTMLAttributes, ReactNode } from "react";

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
	/** aria-describedby for linking to description/error elements */
	"aria-describedby"?: string;
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
	/**
	 * Native virtual-keyboard hint. When omitted it is derived from `type`
	 * (email/url/tel/search); `text` and `password` keep the standard keyboard.
	 */
	inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
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
	description?: I18nText;
	disabled?: boolean;
	icon?: ReactNode;
	/**
	 * Utility classes applied to the option's visual chrome
	 * (badge in cells, row in dropdowns).
	 */
	className?: string;
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
