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
import { useCollectionMeta } from "../../hooks/use-collection-meta";
import { useFieldHooks } from "../../hooks/use-field-hooks";
import { useResolveText } from "../../i18n/hooks";
import { selectAdmin, useAdminStore, useScopedLocale } from "../../runtime";
import {
  buildComponentProps,
  buildFormFieldProps,
  type FieldContext,
  getFieldContext,
  getFieldOptions,
  getFullFieldName,
} from "./field-context";
import type { FormFieldProps } from "./form-field";
import { FormField } from "./form-field";

// ============================================================================
// Types
// ============================================================================

export interface FieldRendererProps {
  fieldName: string;
  fieldDef?: FieldDefinition;
  collection: string;
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
   * Collection metadata from backend (for inferring localized fields)
   */
  collectionMeta?: { localizedFields?: string[] };
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

function renderFormField(
  formFieldProps: FormFieldProps,
  type?: FormFieldProps["type"],
  extra?: Partial<FormFieldProps>,
) {
  return <FormField {...formFieldProps} type={type} {...extra} />;
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

/**
 * Render primitive field using FormField component
 *
 * This is the fallback for fields without a FieldDefinition.field.component.
 * It maps field types to FormField types for basic form controls.
 */
function renderPrimitiveField({
  context,
  formFieldProps,
}: {
  context: FieldContext;
  formFieldProps: FormFieldProps;
}) {
  if (!context.type) {
    return renderConfigError(
      `Missing field type for "${context.fieldName}". ` +
        `Available fields: ${Object.keys(context.fieldDef || {}).join(", ")}`,
    );
  }

  // Map field types to FormField types
  const typeMap: Record<string, FormFieldProps["type"]> = {
    text: "text",
    email: "email",
    password: "password",
    textarea: "textarea",
    number: "number",
    checkbox: "checkbox",
    switch: "switch",
    select: "select",
    date: "date",
    datetime: "datetime",
    json: "json",
  };

  const mappedType = typeMap[context.type];

  if (context.type === "select" && context.options) {
    return renderFormField(formFieldProps, "select", {
      options: context.options,
    });
  }

  if (mappedType) {
    return renderFormField(formFieldProps, mappedType);
  }

  // Unknown type - try to render as text
  return renderFormField(formFieldProps, "text");
}

// ============================================================================
// FieldRenderer Component
// ============================================================================

/**
 * Render a single field with conditional logic
 *
 * Rendering priority:
 * 1. Embedded fields (need special handling for recursive AutoFormFields)
 * 2. FieldDefinition.field.component (handles relation, array, richText, etc.)
 * 3. Primitive fields via FormField (fallback for fields without component)
 */
export function FieldRenderer({
  fieldName,
  fieldDef,
  collection,
  registry,
  fieldPrefix,
  allCollectionsConfig,
  renderEmbeddedFields,
  className,
  collectionMeta: collectionMetaProp,
}: FieldRendererProps) {
  const form = useFormContext() as any;
  // Use scoped locale (from LocaleScopeProvider in ResourceSheet) or global locale
  const { locale } = useScopedLocale();
  const resolveText = useResolveText();
  // Get admin for blocks registry
  const admin = useAdminStore(selectAdmin);

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

  // Fetch collection metadata for inferring localized fields
  // Use prop if provided, otherwise fetch from backend
  const { data: fetchedMeta } = useCollectionMeta(collection, {
    enabled: !collectionMetaProp,
  });
  const collectionMeta = collectionMetaProp ?? fetchedMeta;

  const context = getFieldContext({
    fieldName,
    fieldDef,
    collection,
    form,
    fieldPrefix,
    locale,
    collectionMeta,
    formValues, // Pass pre-watched values to avoid calling form.watch() internally
  });

  // Get field options for hooks
  const fieldOptions = getFieldOptions(fieldDef);

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
    compute: fieldOptions.compute,
    onChange: fieldOptions.onChange,
    defaultValue: fieldOptions.defaultValue,
    loadOptions: fieldOptions.loadOptions,
    staticOptions: context.options,
  });

  // Hidden fields are not rendered
  if (context.isHidden) return null;

  // Field not found in config
  if (!fieldDef) {
    return renderConfigError(
      `Field "${fieldName}" not found in collection "${collection}" config.`,
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

  const rawFormFieldProps = buildFormFieldProps(context);
  const formFieldProps: FormFieldProps = {
    ...rawFormFieldProps,
    // Use resolved options for select fields (cast for compatibility)
    options: resolvedOptions as FormFieldProps["options"],
    label: resolveText(rawFormFieldProps.label, "", formValues),
    description: resolveText(rawFormFieldProps.description, "", formValues),
    placeholder: resolveText(rawFormFieldProps.placeholder, "", formValues),
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

  // 2. Use FieldDefinition.field.component if available
  if (!content && context.component) {
    content = renderDefinitionComponent({
      context,
      componentProps,
      blocks: admin.state.blocks,
    });
  }

  // 3. Fallback to primitive field rendering
  if (!content) {
    content = renderPrimitiveField({ context, formFieldProps });
  }

  if (!content) return null;

  // Wrap with className if provided
  if (className) {
    return <div className={className}>{content}</div>;
  }

  return <>{content}</>;
}
