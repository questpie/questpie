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
import {
	FieldLayoutRenderer,
	type FieldLayoutContext,
} from "../layout/field-layout-renderer";
import { Button } from "../ui/button";
import type { BaseFieldProps, ObjectFieldConfig } from "./field-types";
import { gridColumnClasses } from "./field-utils";
import { FieldLocaleIndicator, FieldWrapper } from "./field-wrapper";

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

interface ObjectFieldPanelProps {
	name: string;
	label?: string;
	description?: string;
	required?: boolean;
	disabled?: boolean;
	localized?: boolean;
	locale?: string;
	className?: string;
	isCollapsed: boolean;
	onToggle: () => void;
	children: React.ReactNode;
}

function ObjectFieldPanel({
	name,
	label,
	description,
	required,
	disabled,
	localized,
	locale,
	className,
	isCollapsed,
	onToggle,
	children,
}: ObjectFieldPanelProps): React.ReactElement {
	const resolveText = useResolveText();
	const resolvedLabel = resolveText(label ?? name);

	return (
		<div
			className={cn("qa-object-field panel-surface overflow-hidden", className)}
		>
			<Button
				type="button"
				variant="ghost"
				onClick={onToggle}
				className="h-auto min-h-10 w-full justify-between rounded-none px-3 py-2 text-left"
				disabled={disabled}
			>
				<span className="flex min-w-0 items-center gap-2">
					<Icon
						icon={isCollapsed ? "ph:caret-right" : "ph:caret-down"}
						className="size-4 shrink-0"
					/>
					<span className="min-w-0 truncate font-medium">{resolvedLabel}</span>
					{required && <span className="text-destructive shrink-0">*</span>}
				</span>
				<FieldLocaleIndicator localized={localized} locale={locale} />
			</Button>
			{!isCollapsed && (
				<div className="border-border-subtle space-y-4 border-t p-4">
					{description && (
						<p className="text-muted-foreground text-sm text-pretty">
							{resolveText(description)}
						</p>
					)}
					{children}
				</div>
			)}
		</div>
	);
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
}: NestedFieldRendererProps): React.ReactElement {
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
		hidden: _hidden,
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
}: ObjectFieldProps): React.ReactElement | null {
	const resolveText = useResolveText();
	const admin = useAdminStore(selectAdmin);
	const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);
	const toggleCollapsed = React.useCallback(() => {
		setIsCollapsed((current) => !current);
	}, []);

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

	const fieldEntries = React.useMemo(
		() => Object.entries(nestedFields),
		[nestedFields],
	);
	const layoutCtx = React.useMemo<FieldLayoutContext>(
		() => ({
			renderField: (fieldName) => {
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
		}),
		[disabled, name, nestedFields, resolveText],
	);

	if (fieldEntries.length === 0) {
		return null;
	}

	// When form layout is defined, use the shared layout renderer
	if (formProp?.fields?.length) {
		const content = (
			<FieldLayoutRenderer items={formProp.fields} ctx={layoutCtx} />
		);

		// Wrap in collapsible or flat container
		if (wrapper === "collapsible") {
			return (
				<ObjectFieldPanel
					name={name}
					label={label}
					description={description}
					required={required}
					disabled={disabled}
					localized={localized}
					locale={locale}
					className={className}
					isCollapsed={isCollapsed}
					onToggle={toggleCollapsed}
				>
					{content}
				</ObjectFieldPanel>
			);
		}

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
					<div className={cn("qa-object-field pt-1", className)}>{content}</div>
				</FieldWrapper>
			);
		}

		return <div className={cn("qa-object-field", className)}>{content}</div>;
	}

	// Collapsible wrapper (also support legacy layout="collapsible" for backwards compatibility)
	if (wrapper === "collapsible" || (layout as string) === "collapsible") {
		return (
			<ObjectFieldPanel
				name={name}
				label={label}
				description={description}
				required={required}
				disabled={disabled}
				localized={localized}
				locale={locale}
				className={className}
				isCollapsed={isCollapsed}
				onToggle={toggleCollapsed}
			>
				<NestedFieldsLayout
					fieldEntries={fieldEntries}
					layout={layout}
					columns={columns}
					name={name}
					disabled={disabled}
				/>
			</ObjectFieldPanel>
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
}: NestedFieldsLayoutProps): React.ReactElement {
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
