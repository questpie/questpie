/**
 * Field Context
 *
 * Provides context and utilities for rendering form fields.
 * Extracted from auto-form-fields.tsx for better modularity.
 */

import type React from "react";
import type { FieldDefinition } from "../../builder/field/field";
import type { DynamicI18nText } from "../../builder/types/common";

// ============================================================================
// Types
// ============================================================================

/**
 * Context object containing all information needed to render a field.
 * Note: label, description, placeholder can be I18nText - resolve them before passing to components.
 */
export type FieldContext = {
	fieldName: string;
	fullFieldName: string;
	collection: string;
	fieldDef?: FieldDefinition;
	fieldValue: any;
	/** Can be I18nText - must be resolved before passing to component */
	label?: DynamicI18nText;
	/** Can be I18nText - must be resolved before passing to component */
	description?: DynamicI18nText;
	/** Can be I18nText - must be resolved before passing to component */
	placeholder?: DynamicI18nText;
	options?: Array<{ label: string; value: any }>;
	/** Whether field is hidden (not rendered). Default false. */
	isHidden: boolean;
	/** Whether field is read-only (normal look, not editable). Computed fields are always readonly. */
	isReadOnly: boolean;
	/** Whether field is disabled (grayed out). */
	isDisabled: boolean;
	isRequired: boolean;
	isLocalized: boolean;
	/** Whether field has a compute function */
	isComputed: boolean;
	locale?: string;
	fieldError?: string;
	updateValue: (nextValue: any) => void;
	type?: string;
	component?: React.ComponentType<any>;
	/** Compute function if field is computed */
	compute?: (values: Record<string, any>) => any;
};

// ============================================================================
// Helper Functions - Field Definition Access
// ============================================================================

/**
 * Get field type from FieldDefinition
 * FieldDefinition.name contains the type name (e.g., "text", "relation")
 */
export function getFieldType(
	fieldDef: FieldDefinition | undefined,
): string | undefined {
	if (!fieldDef) return undefined;
	// FieldDefinition stores the field type in 'name' property
	// This comes from field("text", ...) where "text" is the type
	return fieldDef.name;
}

/**
 * Get field options from FieldDefinition
 * Options are stored in "~options" property
 */
export function getFieldOptions(
	fieldDef: FieldDefinition | undefined,
): Record<string, any> {
	if (!fieldDef) return {};
	return (fieldDef as any)["~options"] || {};
}

/**
 * Get field component from FieldDefinition
 * Component is stored in field.component
 */
export function getFieldComponent(
	fieldDef: FieldDefinition | undefined,
): React.ComponentType<any> | undefined {
	if (!fieldDef?.field?.component) return undefined;
	return fieldDef.field.component as React.ComponentType<any>;
}

// ============================================================================
// Helper Functions - Value Resolution
// ============================================================================

type ValueResolver<T> = T | ((values: any) => T);

export function resolveValue<T>(
	value: ValueResolver<T> | undefined,
	formValues: any,
	defaultValue: T,
): T {
	if (value === undefined) return defaultValue;
	if (typeof value === "function") {
		return (value as (values: any) => T)(formValues);
	}
	return value;
}

/**
 * Get form values for conditional field logic.
 *
 * @deprecated This is a legacy fallback. All callers should now use useWatch()
 * hook in their component and pass the watched values to getFieldContext via
 * the `formValues` parameter. This function uses form.watch() which doesn't
 * properly integrate with React's render cycle.
 *
 * Best practice pattern:
 * ```tsx
 * const watchedValues = useWatch({ control: form.control });
 * const context = getFieldContext({ ..., formValues: watchedValues });
 * ```
 */
export function getFormValues(form: any, fieldPrefix?: string) {
	if (!form?.watch) return {};
	const values = fieldPrefix ? form.watch(fieldPrefix) : form.watch();
	return values ?? {};
}

export function getFullFieldName(fieldName: string, fieldPrefix?: string) {
	return fieldPrefix ? `${fieldPrefix}.${fieldName}` : fieldName;
}

// ============================================================================
// Field Context Factory
// ============================================================================

export interface GetFieldContextParams {
	fieldName: string;
	fieldDef?: FieldDefinition;
	collection: string;
	form: any;
	fieldPrefix?: string;
	locale?: string;
	/** Entity metadata from backend (for inferring localized fields) */
	entityMeta?: { localizedFields?: string[] };
	/**
	 * Pre-watched form values from useWatch hook.
	 * If provided, avoids calling form.watch() internally.
	 * This is the preferred pattern for better React integration.
	 */
	formValues?: Record<string, any>;
}

/**
 * Create a FieldContext object from field definition and form context.
 * Contains all information needed to render a field component.
 */
export function getFieldContext({
	fieldName,
	fieldDef,
	collection,
	form,
	fieldPrefix,
	locale,
	formValues: formValuesProp,
	entityMeta,
}: GetFieldContextParams): FieldContext {
	// Use pre-watched values if provided (preferred), otherwise fall back to form.watch()
	const formValues = formValuesProp ?? getFormValues(form, fieldPrefix);
	const fullFieldName = getFullFieldName(fieldName, fieldPrefix);
	const fieldState = form?.getFieldState
		? form.getFieldState(fullFieldName)
		: undefined;
	const fieldError = fieldState?.error?.message;
	const fieldValue = formValues[fieldName];

	// Get options from FieldDefinition
	const options = getFieldOptions(fieldDef);
	const type = getFieldType(fieldDef);
	const component = getFieldComponent(fieldDef);

	const label = options.label;
	const description = options.description;
	const placeholder = options.placeholder;

	// hidden: false/undefined = visible, true = hidden
	const isHidden = resolveValue(options.hidden, formValues, false);
	// compute implies readonly
	const isComputed = typeof options.compute === "function";
	const isReadOnly =
		isComputed || resolveValue(options.readOnly, formValues, false);
	const isDisabled = resolveValue(options.disabled, formValues, false);
	const isRequired = resolveValue(options.required, formValues, false);

	// Check if field is localized: explicit config takes priority, fallback to BE metadata
	const isLocalized =
		options.localized !== undefined
			? !!options.localized
			: (entityMeta?.localizedFields?.includes(fieldName) ?? false);

	// Resolve dynamic options for select fields
	const selectOptions = options.options
		? typeof options.options === "function"
			? options.options(formValues)
			: options.options
		: undefined;

	const updateValue = (nextValue: any) => {
		if (form?.setValue) {
			form.setValue(fullFieldName, nextValue, {
				shouldDirty: true,
				shouldTouch: true,
			});
		}
	};

	return {
		fieldName,
		fullFieldName,
		collection,
		fieldDef,
		fieldValue,
		label,
		description,
		placeholder,
		options: selectOptions,
		isHidden,
		isReadOnly,
		isDisabled,
		isRequired,
		isLocalized,
		isComputed,
		locale,
		fieldError,
		updateValue,
		type,
		component,
		compute: options.compute,
	};
}

// ============================================================================
// Component Props Builders
// ============================================================================

/**
 * Raw component props with I18nText (needs resolution before passing to components)
 */
export type RawComponentProps = {
	name: string;
	value: any;
	onChange: (value: any) => void;
	label?: DynamicI18nText;
	description?: DynamicI18nText;
	placeholder?: DynamicI18nText;
	required: boolean;
	disabled: boolean;
	readOnly: boolean;
	error?: string;
	localized: boolean;
	locale?: string;
};

/**
 * Build props for a FieldDefinition component (field.component).
 * Returns raw props with I18nText - resolve before passing to component.
 */
export function buildComponentProps(context: FieldContext): RawComponentProps {
	return {
		name: context.fullFieldName,
		value: context.fieldValue,
		onChange: context.updateValue,
		label: context.label,
		description: context.description,
		placeholder: context.placeholder,
		required: context.isRequired,
		disabled: context.isDisabled,
		readOnly: context.isReadOnly,
		error: context.fieldError,
		localized: context.isLocalized,
		locale: context.locale,
	};
}
