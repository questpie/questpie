/**
 * ObjectField Component
 *
 * Renders nested fields for JSON object structures.
 * Supports wrapper modes (flat, collapsible) and layout modes (stack, inline, grid).
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import type { FieldDefinition } from "../../builder/field/field";
import { createFieldRegistryProxy } from "../../builder/proxies";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectAdmin, useAdminStore } from "../../runtime";
import { FormField } from "../../views/collection/form-field";
import type { BaseFieldProps, ObjectFieldConfig } from "./field-types";
import { gridColumnClasses } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

// ============================================================================
// Types
// ============================================================================

export interface ObjectFieldProps
  extends BaseFieldProps, Omit<ObjectFieldConfig, "fields"> {
  /**
   * Nested field definitions.
   * Can be a callback (evaluated at render time) or pre-evaluated record.
   */
  fields?: ((ctx: { r: any }) => Record<string, any>) | Record<string, any>;
}

// ============================================================================
// Nested Field Renderer
// ============================================================================

interface NestedFieldRendererProps {
  fieldName: string;
  fieldDef: FieldDefinition;
  parentName: string;
  disabled?: boolean;
}

function NestedFieldRenderer({
  fieldName,
  fieldDef,
  parentName,
  disabled,
}: NestedFieldRendererProps) {
  const resolveText = useResolveText();
  const fullName = `${parentName}.${fieldName}`;
  const fieldType = fieldDef.name;
  const options = fieldDef["~options"] || {};

  // For nested object fields, render recursively
  if (fieldType === "object" && options.fields) {
    return (
      <ObjectField
        name={fullName}
        label={resolveText(options.label)}
        description={resolveText(options.description)}
        fields={options.fields}
        wrapper={options.wrapper}
        layout={options.layout}
        columns={options.columns}
        defaultCollapsed={options.defaultCollapsed}
        disabled={disabled}
        required={options.required}
      />
    );
  }

  // For other fields, use FormField
  return (
    <FormField
      name={fullName}
      label={resolveText(options.label)}
      description={resolveText(options.description)}
      placeholder={resolveText(options.placeholder)}
      required={options.required}
      disabled={disabled || options.disabled}
      type={fieldType as any}
      options={options.options}
    />
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ObjectField({
  name,
  label,
  description,
  required,
  disabled,
  localized,
  locale,
  className,
  fields: fieldsProp,
  wrapper = "flat",
  layout = "stack",
  columns = 2,
  defaultCollapsed = true,
}: ObjectFieldProps) {
  const resolveText = useResolveText();
  const admin = useAdminStore(selectAdmin);
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);

  // Resolve nested field definitions
  const nestedFields = React.useMemo(() => {
    if (!fieldsProp) return {};

    // If it's a callback, evaluate it with field registry
    if (typeof fieldsProp === "function") {
      const registeredFields = admin.getFields();
      const r = createFieldRegistryProxy(registeredFields as any);
      return fieldsProp({ r });
    }

    // Otherwise it's already evaluated
    return fieldsProp;
  }, [fieldsProp, admin]);

  const fieldEntries = Object.entries(nestedFields);

  if (fieldEntries.length === 0) {
    return null;
  }

  // Render nested fields based on layout
  const renderFields = () => {
    const fieldElements = fieldEntries.map(([fieldName, fieldDef]) => (
      <NestedFieldRenderer
        key={fieldName}
        fieldName={fieldName}
        fieldDef={fieldDef as FieldDefinition}
        parentName={name}
        disabled={disabled}
      />
    ));

    if (layout === "inline") {
      return (
        <div className="flex flex-wrap items-end gap-2">{fieldElements}</div>
      );
    }

    if (layout === "grid") {
      return (
        <div
          className={cn(
            "grid gap-4",
            gridColumnClasses[columns] || "grid-cols-2",
          )}
        >
          {fieldElements}
        </div>
      );
    }

    // Default: stack
    return <div className="space-y-4">{fieldElements}</div>;
  };

  // Collapsible wrapper (also support legacy layout="collapsible" for backwards compatibility)
  if (wrapper === "collapsible" || (layout as string) === "collapsible") {
    return (
      <div
        className={cn(
          "rounded-lg border border-border/60 bg-card/30 backdrop-blur-sm",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center justify-between p-3 text-left hover:bg-muted/50"
          disabled={disabled}
        >
          <div className="flex items-center gap-2">
            {isCollapsed ? (
              <Icon icon="ph:caret-right" className="h-4 w-4" />
            ) : (
              <Icon icon="ph:caret-down" className="h-4 w-4" />
            )}
            <span className="font-medium">{resolveText(label ?? name)}</span>
            {required && <span className="text-destructive">*</span>}
          </div>
        </button>
        {!isCollapsed && (
          <div className="border-t p-4">
            {description && (
              <p className="mb-4 text-sm text-muted-foreground">
                {resolveText(description)}
              </p>
            )}
            {renderFields()}
          </div>
        )}
      </div>
    );
  }

  // Flat wrapper with optional label
  if (label) {
    return (
      <FieldWrapper
        name={name}
        label={resolveText(label)}
        description={description}
        required={required}
        disabled={disabled}
        localized={localized}
        locale={locale}
      >
        <div className={cn("pt-1", className)}>{renderFields()}</div>
      </FieldWrapper>
    );
  }

  // No label - just render fields
  return <div className={className}>{renderFields()}</div>;
}
