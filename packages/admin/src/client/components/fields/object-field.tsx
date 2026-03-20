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
import { FieldLayoutRenderer, type FieldLayoutContext } from "../layout/field-layout-renderer";

// ============================================================================
// Types
// ============================================================================

interface ObjectFieldProps
	extends BaseFieldProps, Omit<ObjectFieldConfig, "fields"> {
	/**
	 * Nested field definitions.
	 * Can be a callback (evaluated at render time) or pre-evaluated record.
	 */
	fields?: ((ctx: { r: any }) => Record<string, any>) | Record<string, any>;
	/**
	 * Form layout for nested fields (sections, tabs, grid).
	 * When provided, renders fields using the layout system instead of default stack.
	 */
	form?: { fields: any[] };
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
			<div className="text-destructive text-sm">
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
	form: formProp,
	wrapper = "collapsible",
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

	// When form layout is defined, use the shared layout renderer
	if (formProp?.fields?.length) {
		const layoutCtx: FieldLayoutContext = {
			renderField: (fieldName, opts) => {
				const fieldDef = nestedFields[fieldName] as FieldInstance | undefined;
				if (!fieldDef) return null;
				return (
					<NestedFieldRenderer
						key={fieldName}
						fieldName={fieldName}
						fieldDef={fieldDef}
						parentName={name}
						disabled={disabled}
					/>
				);
			},
			resolveText: (text, fallback) => resolveText(text, fallback),
		};

		const content = (
			<FieldLayoutRenderer items={formProp.fields} ctx={layoutCtx} />
		);

		// Wrap in collapsible or flat container
		if (wrapper === "collapsible") {
			return (
				<div className={cn("qa-object-field border-border bg-card rounded-lg border", className)}>
					<button
						type="button"
						onClick={() => setIsCollapsed(!isCollapsed)}
						className="hover:bg-muted flex w-full items-center justify-between p-3 text-left"
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
						<div className="border-t p-4">{content}</div>
					)}
				</div>
			);
		}

		if (label) {
			return (
				<FieldWrapper name={name} label={resolveText(label)} description={description} required={required} disabled={disabled} localized={localized} locale={locale}>
					<div className={cn("qa-object-field pt-1", className)}>{content}</div>
				</FieldWrapper>
			);
		}

		return <div className={cn("qa-object-field", className)}>{content}</div>;
	}

	// Collapsible wrapper (also support legacy layout="collapsible" for backwards compatibility)
	if (wrapper === "collapsible" || (layout as string) === "collapsible") {
		return (
			<div
				className={cn(
					"qa-object-field border-border bg-card rounded-lg border",
					className,
				)}
			>
				<button
					type="button"
					onClick={() => setIsCollapsed(!isCollapsed)}
					className="hover:bg-muted flex w-full items-center justify-between p-3 text-left"
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
							<p className="text-muted-foreground mb-4 text-sm">
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
