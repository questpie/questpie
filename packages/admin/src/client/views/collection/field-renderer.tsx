/**
 * FieldRenderer Component
 *
 * Renders a single form field using FieldDefinition.
 * Shared between AutoFormFields and BlockEditor.
 */

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { ComponentRegistry } from "../../builder";
import type { FieldDefinition } from "../../builder/field/field";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useCollectionMeta } from "../../hooks/use-collection-meta";
import { useFieldHooks } from "../../hooks/use-field-hooks";
import { useGlobalMeta } from "../../hooks/use-global-meta";
import { useResolveText } from "../../i18n/hooks";
import { useScopedLocale } from "../../runtime";
import {
	buildComponentProps,
	type FieldContext,
	getFieldContext,
	getFieldOptions,
	getFullFieldName,
} from "./field-context";

// ============================================================================
// Types
// ============================================================================

export interface FieldRendererProps {
	fieldName: string;
	fieldDef?: FieldDefinition;
	collection: string;
	/** Entity type - determines which meta hook to use */
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	className?: string;
	/**
	 * Callback to render embedded collection fields.
	 * Required for embedded fields to work (handles recursive AutoFormFields).
	 */
	renderEmbeddedFields?: (params: {
		embeddedCollection: string;
		embeddedCollectionConfig: any;
		fullFieldName: string;
		index: number;
	}) => React.ReactNode;
	/**
	 * All collection configs (for embedded collections)
	 */
	allCollectionsConfig?: Record<string, any>;
	/**
	 * Entity metadata from backend (for inferring localized fields)
	 */
	entityMeta?: { localizedFields?: string[] };
}

// ============================================================================
// Helpers
// ============================================================================

function renderConfigError(message: string) {
	return (
		<div className="border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive rounded">
			{message}
		</div>
	);
}

function stripFieldUiOptions(options: Record<string, any>) {
	const {
		label,
		description,
		placeholder,
		required,
		disabled,
		readOnly,
		visible,
		localized,
		locale,
		...rest
	} = options;

	return rest;
}

/**
 * Render field using FieldDefinition.field.component
 *
 * This is the primary rendering method. Field components receive:
 * - Base props (name, value, onChange, label, etc.) from componentProps
 * - Field-specific options from FieldDefinition["~options"]
 */
function renderDefinitionComponent({
	context,
	componentProps,
	blocks,
}: {
	context: FieldContext;
	componentProps: ReturnType<typeof buildComponentProps>;
	blocks?: Record<string, any>;
}) {
	const Component = context.component;
	if (!Component) return null;

	// Get field-specific options from FieldDefinition
	const options = stripFieldUiOptions(getFieldOptions(context.fieldDef));

	// For blocks field, inject the blocks registry from admin state
	if (context.type === "blocks" && blocks) {
		return <Component {...componentProps} {...options} blocks={blocks} />;
	}

	return <Component {...componentProps} {...options} />;
}

/**
 * Render embedded collection field
 *
 * Embedded fields need special handling because they require:
 * 1. Access to allCollectionsConfig for the embedded collection's config
 * 2. A renderFields callback that recursively renders AutoFormFields
 */
function renderEmbeddedField({
	context,
	registry,
	allCollectionsConfig,
	componentProps,
	renderEmbeddedFields,
}: {
	context: FieldContext;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<string, any>;
	componentProps: ReturnType<typeof buildComponentProps>;
	renderEmbeddedFields?: FieldRendererProps["renderEmbeddedFields"];
}) {
	if (context.type !== "embedded") return null;

	const options = stripFieldUiOptions(getFieldOptions(context.fieldDef));
	const embeddedCollection = options.collection;

	if (!embeddedCollection) {
		return renderConfigError(
			`Missing collection for embedded field "${context.fieldName}".`,
		);
	}

	const embeddedCollectionConfig = allCollectionsConfig?.[embeddedCollection];

	// Use the component from FieldDefinition, or fall back to registry/default
	const EmbeddedComponent =
		context.component ||
		(registry?.fields?.embedded as React.ComponentType<any>);

	if (!EmbeddedComponent) {
		return renderConfigError(
			`No component found for embedded field "${context.fieldName}".`,
		);
	}

	return (
		<EmbeddedComponent
			{...componentProps}
			{...options}
			value={context.fieldValue || []}
			collection={embeddedCollection}
			renderFields={(index: number) =>
				renderEmbeddedFields?.({
					embeddedCollection,
					embeddedCollectionConfig,
					fullFieldName: context.fullFieldName,
					index,
				})
			}
		/>
	);
}

// ============================================================================
// FieldRenderer Component
// ============================================================================

/**
 * Render a single field with conditional logic
 *
 * Rendering priority:
 * 1. Embedded fields (need special handling for recursive AutoFormFields)
 * 2. FieldDefinition.field.component (registry-first approach)
 * 3. Error message if no component registered
 */
export function FieldRenderer({
	fieldName,
	fieldDef,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	renderEmbeddedFields,
	className,
	entityMeta: entityMetaProp,
}: FieldRendererProps) {
	const form = useFormContext() as any;
	// Use scoped locale (from LocaleScopeProvider in ResourceSheet) or global locale
	const { locale } = useScopedLocale();
	const resolveText = useResolveText();
	const { data: adminConfig } = useAdminConfig();

	// Use useWatch hook (React pattern) instead of form.getValues() method
	// This ensures reactive updates when form values change
	// Watch all form values - the fieldPrefix scoping is handled by getFieldContext
	const watchedValues = useWatch({ control: form.control });
	const fullFieldName = getFullFieldName(fieldName, fieldPrefix);
	const watchedFieldValue = useWatch({
		control: form.control,
		name: fullFieldName,
	} as any);

	// Extract the scoped values if fieldPrefix is provided
	const formValues = React.useMemo(() => {
		if (!watchedValues) return {};
		if (!fieldPrefix) return watchedValues as Record<string, any>;
		// Navigate to the nested path
		const parts = fieldPrefix.split(".");
		let result: any = watchedValues;
		for (const part of parts) {
			result = result?.[part];
			if (result === undefined) return {};
		}
		return (result ?? {}) as Record<string, any>;
	}, [watchedValues, fieldPrefix]);

	// Fetch entity metadata for inferring localized fields
	// Use prop if provided, otherwise fetch from backend based on mode
	const { data: fetchedCollectionMeta } = useCollectionMeta(collection, {
		enabled: !entityMetaProp && mode === "collection",
	});
	const { data: fetchedGlobalMeta } = useGlobalMeta(collection, {
		enabled: !entityMetaProp && mode === "global",
	});

	const entityMeta =
		entityMetaProp ??
		(mode === "global" ? fetchedGlobalMeta : fetchedCollectionMeta);

	const context = getFieldContext({
		fieldName,
		fieldDef,
		collection,
		form,
		fieldPrefix,
		locale,
		entityMeta,
		formValues, // Pass pre-watched values to avoid calling form.watch() internally
	});

	// Get field options for hooks
	const fieldOptions = getFieldOptions(fieldDef);

	// Check if compute is client-side (function) vs server-side (object with handler)
	// Server-side compute is handled by useReactiveFields in form-view.tsx
	const clientSideCompute =
		typeof fieldOptions.compute === "function"
			? fieldOptions.compute
			: undefined;

	// Use field hooks for compute, onChange, loadOptions
	const {
		handleChange,
		computedValue,
		isComputed,
		options: hookOptions,
		optionsLoading,
	} = useFieldHooks({
		fieldName,
		fullFieldName: context.fullFieldName,
		locale,
		compute: clientSideCompute,
		onChange: fieldOptions.onChange,
		defaultValue: fieldOptions.defaultValue,
		loadOptions: fieldOptions.loadOptions,
		staticOptions: context.options,
	});

	// Hidden fields are not rendered
	if (context.isHidden) return null;

	// Field not found in config
	if (!fieldDef) {
		const entityType = mode === "global" ? "global" : "collection";
		return renderConfigError(
			`Field "${fieldName}" not found in ${entityType} "${collection}" config.`,
		);
	}

	// Use hook options if available, otherwise use context options
	const resolvedOptions = hookOptions ?? context.options;

	// Build props and resolve I18nText labels to strings
	const rawComponentProps = buildComponentProps(context);

	// For computed fields, use computed value instead of form value
	const fieldValue = isComputed
		? computedValue
		: watchedFieldValue === undefined
			? rawComponentProps.value
			: watchedFieldValue;

	const componentProps = {
		...rawComponentProps,
		// Use computed value if field is computed
		value: fieldValue,
		// Use handleChange from hooks instead of context.updateValue
		onChange: handleChange,
		// Use resolved options
		options: resolvedOptions,
		// Pass loading state for async options
		optionsLoading,
		// Computed fields are always readonly
		readOnly: rawComponentProps.readOnly || isComputed,
		label: resolveText(rawComponentProps.label, "", formValues),
		description: resolveText(rawComponentProps.description, "", formValues),
		placeholder: resolveText(rawComponentProps.placeholder, "", formValues),
	};

	// Render content based on priority
	let content: React.ReactNode = null;

	// 1. Embedded fields need special handling for recursive rendering
	if (context.type === "embedded") {
		content = renderEmbeddedField({
			context,
			registry,
			allCollectionsConfig,
			componentProps,
			renderEmbeddedFields,
		});
	}

	// 2. Use FieldDefinition.field.component (registry-first approach)
	if (!content && context.component) {
		content = renderDefinitionComponent({
			context,
			componentProps,
			blocks: adminConfig?.blocks,
		});
	}

	// 3. No component found - show error (all fields should have registered components)
	if (!content) {
		content = renderConfigError(
			`No component registered for field type "${context.type}" (field: "${context.fieldName}").`,
		);
	}

	// Wrap with className if provided
	if (className) {
		return <div className={className}>{content}</div>;
	}

	return <>{content}</>;
}
