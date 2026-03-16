/**
 * ObjectField Component
 *
 * Renders nested fields for JSON object structures.
 * Supports wrapper modes (flat, collapsible) and layout modes (stack, inline, grid).
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import type { FieldInstance } from "../../builder/field/field";
import { configureField } from "../../builder/field/field";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectAdmin, useAdminStore } from "../../runtime";
import type { BaseFieldProps, ObjectFieldConfig } from "./field-types";
import { gridColumnClasses } from "./field-utils";
import { FieldWrapper } from "./field-wrapper";

// ============================================================================
// Types
// ============================================================================

interface ObjectFieldProps
	extends BaseFieldProps,
		Omit<ObjectFieldConfig, "fields"> {
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
	fieldDef: FieldInstance;
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
	const options = (fieldDef["~options"] || {}) as Record<string, any>;

	// Get the component from the field definition (registry-based)
	// Cast to ComponentType since MaybeLazyComponent includes lazy variants
	const Component = fieldDef.component as React.ComponentType<any> | undefined;

	if (!Component) {
		// Fallback error display if no component found
		return (
			<div className="text-sm text-destructive">
				No component for field type: {fieldDef.name}
			</div>
		);
	}

	// Strip UI-specific options that are handled by FieldWrapper
	const {
		label,
		description,
		placeholder,
		required,
		disabled: optionsDisabled,
		readOnly,
		hidden,
		localized,
		locale,
		...fieldSpecificOptions
	} = options;

	// Render using the component from the field registry
	return (
		<Component
			name={fullName}
			label={resolveText(label)}
			description={resolveText(description)}
			placeholder={resolveText(placeholder)}
			required={required}
			disabled={disabled || optionsDisabled}
			readOnly={readOnly}
			localized={localized}
			locale={locale}
			{...fieldSpecificOptions}
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
			const r: Record<
				string,
				(opts?: Record<string, unknown>) => FieldInstance
			> = {};
			for (const key in registeredFields) {
				r[key] = (opts) => configureField(registeredFields[key], opts ?? {});
			}
			return fieldsProp({ r });
		}

		// Otherwise it's already evaluated
		return fieldsProp;
	}, [fieldsProp, admin]);

	const fieldEntries = Object.entries(nestedFields);

	if (fieldEntries.length === 0) {
		return null;
	}

	// Collapsible wrapper (also support legacy layout="collapsible" for backwards compatibility)
	if (wrapper === "collapsible" || (layout as string) === "collapsible") {
		return (
			<div
				className={cn(
					"qa-object-field rounded-lg border border-border bg-card ",
					className,
				)}
			>
				<button
					type="button"
					onClick={() => setIsCollapsed(!isCollapsed)}
					className="flex w-full items-center justify-between p-3 text-left hover:bg-muted"
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
						<NestedFieldsLayout
							fieldEntries={fieldEntries}
							layout={layout}
							columns={columns}
							name={name}
							disabled={disabled}
						/>
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
				<div className={cn("qa-object-field pt-1", className)}>
					<NestedFieldsLayout
						fieldEntries={fieldEntries}
						layout={layout}
						columns={columns}
						name={name}
						disabled={disabled}
					/>
				</div>
			</FieldWrapper>
		);
	}

	// No label - just render fields
	return (
		<div className={cn("qa-object-field", className)}>
			<NestedFieldsLayout
				fieldEntries={fieldEntries}
				layout={layout}
				columns={columns}
				name={name}
				disabled={disabled}
			/>
		</div>
	);
}

// ============================================================================
// Nested Fields Layout
// ============================================================================

interface NestedFieldsLayoutProps {
	fieldEntries: [string, any][];
	layout: ObjectFieldProps["layout"];
	columns: number;
	name: string;
	disabled?: boolean;
}

function NestedFieldsLayout({
	fieldEntries,
	layout,
	columns,
	name,
	disabled,
}: NestedFieldsLayoutProps) {
	const fieldElements = fieldEntries.map(([fieldName, fieldDef]) => (
		<NestedFieldRenderer
			key={fieldName}
			fieldName={fieldName}
			fieldDef={fieldDef as FieldInstance}
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
}
