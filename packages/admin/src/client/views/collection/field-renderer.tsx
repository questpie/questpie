/**
 * FieldRenderer Component
 *
 * Renders a single form field using FieldDefinition.
 * Shared between AutoFormFields and BlockEditor.
 */

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";

import type { ComponentRegistry } from "../../builder";
import type { FieldInstance } from "../../builder/field/field";
import { Skeleton } from "../../components/ui/skeleton";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useFieldHooks } from "../../hooks/use-field-hooks";
import { useReactiveProps } from "../../hooks/use-reactive-prop";
import { useResolveText } from "../../i18n/hooks";
import { useScopedLocale } from "../../runtime";
import {
	scopeDependencies,
	trackDependencies,
} from "../../utils/dependency-tracker";
import { useLazyComponent } from "../../utils/use-lazy-component.js";
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

interface FieldRendererProps {
	fieldName: string;
	fieldDef?: FieldInstance;
	collection: string;
	/** Entity type used for contextual behavior */
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	className?: string;
	/** Extra props forwarded to the field component (escape hatch). */
	extraProps?: Record<string, any>;
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
		<div className="border-destructive/40 bg-destructive/5 text-destructive rounded border p-3 text-sm">
			{message}
		</div>
	);
}

function FieldComponentSkeleton({ type }: { type?: string }) {
	const largeFieldTypes = new Set(["blocks", "json", "object", "richText"]);
	const tallFieldTypes = new Set(["textarea", "upload"]);
	const controlClassName = largeFieldTypes.has(type ?? "")
		? "h-40 w-full"
		: tallFieldTypes.has(type ?? "")
			? "h-28 w-full"
			: "h-10 w-full";

	return (
		<div className="space-y-2" aria-busy="true">
			<Skeleton variant="text" className="h-4 w-24" />
			<Skeleton className={controlClassName} />
		</div>
	);
}

function stripFieldUiOptions(options: Record<string, any>) {
	const rest = { ...options };
	delete rest.label;
	delete rest.description;
	delete rest.placeholder;
	delete rest.required;
	delete rest.disabled;
	delete rest.readOnly;
	delete rest.visible;
	delete rest.localized;
	delete rest.locale;
	return rest;
}

const DYNAMIC_FIELD_OPTION_KEYS = [
	"hidden",
	"readOnly",
	"disabled",
	"required",
	"options",
	"label",
	"description",
	"placeholder",
] as const;

function collectFieldOptionDependencies(
	fieldOptions: Record<string, any>,
	values: Record<string, any>,
): string[] {
	const deps = new Set<string>();

	for (const key of DYNAMIC_FIELD_OPTION_KEYS) {
		const value = fieldOptions[key];
		if (typeof value !== "function") {
			continue;
		}

		const tracked = trackDependencies(values, value);
		for (const dep of tracked.deps) {
			deps.add(dep);
		}
	}

	return [...deps];
}

function computeDynamicDependencyPaths({
	fieldOptions,
	form,
	fieldPrefix,
}: {
	fieldOptions: Record<string, any>;
	form: any;
	fieldPrefix?: string;
}): string[] {
	const scopedValues =
		((fieldPrefix ? form.getValues(fieldPrefix) : form.getValues()) as
			| Record<string, any>
			| undefined) ?? {};

	const trackedDeps = collectFieldOptionDependencies(
		fieldOptions,
		scopedValues,
	);
	return scopeDependencies(trackedDeps, fieldPrefix);
}

/**
 * Render field using FieldDefinition.field.component
 *
 * The caller has already merged field-instance options + layout `extraProps`
 * + base props (label/value/onChange/…) into `componentProps` and resolved
 * any `ReactivePropPlaceholder`s via `useReactiveProps`. The component just
 * receives the final flat record.
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

	// For blocks field, inject the blocks registry from admin state
	if (context.type === "blocks" && blocks) {
		return <Component {...componentProps} blocks={blocks} />;
	}

	return <Component {...componentProps} />;
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

	// `componentProps` already includes resolved field-instance options merged
	// with layout extraProps (see FieldRenderer body). Pull out `collection`
	// for the embedded routing — it's part of the merged record.
	const embeddedCollection = (componentProps as Record<string, unknown>)
		.collection as string | undefined;

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
	extraProps,
}: FieldRendererProps) {
	const form = useFormContext() as any;
	// Use scoped locale (from LocaleScopeProvider in ResourceSheet) or global locale
	const { locale } = useScopedLocale();
	const resolveText = useResolveText();
	const { data: adminConfig } = useAdminConfig();
	const fullFieldName = getFullFieldName(fieldName, fieldPrefix);

	// Get field options for context + hooks
	const fieldOptions = React.useMemo(
		() => getFieldOptions(fieldDef),
		[fieldDef],
	);

	const dynamicDependencyPaths = React.useMemo(
		() =>
			computeDynamicDependencyPaths({
				fieldOptions,
				form,
				fieldPrefix,
			}),
		[fieldOptions, form, fieldPrefix],
	);

	const watchNames = React.useMemo(() => {
		return [...new Set([fullFieldName, ...dynamicDependencyPaths])];
	}, [fullFieldName, dynamicDependencyPaths]);

	const watchedDependencyValues = useWatch({
		control: form.control,
		name: watchNames as any,
	});

	const watchedFieldValue = Array.isArray(watchedDependencyValues)
		? watchedDependencyValues[0]
		: watchedDependencyValues;

	// Extract scoped values from form snapshot when relevant dependencies change
	const formValues = React.useMemo(() => {
		void watchedDependencyValues;

		if (!fieldPrefix) {
			return (form.getValues() ?? {}) as Record<string, any>;
		}

		return (form.getValues(fieldPrefix) ?? {}) as Record<string, any>;
	}, [form, fieldPrefix, watchedDependencyValues]);

	const context = getFieldContext({
		fieldName,
		fieldDef,
		collection,
		form,
		fieldPrefix,
		locale,
		entityMeta: entityMetaProp,
		formValues, // Pass pre-watched values to avoid calling form.watch() internally
	});

	// Resolve lazy component (supports () => import(...) loaders)
	const { Component: resolvedComponent, loading: componentLoading } =
		useLazyComponent(context.component);

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

	// Merge field-instance admin meta (e.g. `f.relation(...).admin({ filter })`)
	// with layout-level escape-hatch `extraProps` from the form layout. Layout
	// wins over field-level so per-instance overrides are possible.
	const mergedFieldProps = React.useMemo(
		() => ({
			...stripFieldUiOptions(getFieldOptions(fieldDef)),
			...(extraProps ?? {}),
		}),
		[fieldDef, extraProps],
	);

	// Resolve any `ReactivePropPlaceholder` entries (from EITHER source) via
	// /admin/reactive in a single batched call. Static entries pass through
	// synchronously without touching the network. Field components never see
	// placeholders.
	const { props: resolvedFieldProps } = useReactiveProps({
		entity: collection,
		entityType: mode,
		field: fullFieldName,
		props: mergedFieldProps,
	});

	// For computed fields, use computed value instead of form value
	const fieldValue = isComputed
		? computedValue
		: watchedFieldValue === undefined
			? rawComponentProps.value
			: watchedFieldValue;

	const componentProps = {
		...rawComponentProps,
		// Field-instance + layout props (placeholders already resolved). Spread
		// before our base overrides so framework-controlled keys
		// (value/onChange/readOnly/label/...) always win.
		...resolvedFieldProps,
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
			context: { ...context, component: resolvedComponent ?? undefined },
			registry,
			allCollectionsConfig,
			componentProps,
			renderEmbeddedFields,
		});
	}

	// 2. Show field-shaped skeleton while lazy component is loading
	if (!content && componentLoading) {
		content = <FieldComponentSkeleton type={context.type} />;
	}

	// 3. Use FieldDefinition.field.component (registry-first approach)
	if (!content && resolvedComponent) {
		content = renderDefinitionComponent({
			context: { ...context, component: resolvedComponent },
			componentProps,
			blocks: adminConfig?.blocks,
		});
	}

	// 4. No component found - show error (all fields should have registered components)
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
