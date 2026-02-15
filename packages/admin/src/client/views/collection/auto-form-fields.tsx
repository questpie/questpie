/**
 * AutoFormFields Component
 *
 * Automatically generates form fields from CollectionBuilderState:
 * - Reads field definitions (FieldDefinition) from config.fields
 * - Reads form layout (FormViewConfig) from config.form
 * - Supports recursive tabs/sections nesting
 * - Auto-generates fields when no form config is defined
 */

import type { CollectionSchema, Questpie } from "questpie";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type {
	ComponentRegistry,
	FieldLayoutItem,
	FormSidebarConfig,
	FormViewConfig,
	SectionLayout,
	TabConfig,
	TabsLayout,
} from "../../builder";
import type { FieldDefinition } from "../../builder/field/field";
import {
	getFieldName,
	isFieldReference,
} from "../../builder/types/field-types";
import { resolveIconElement } from "../../components/component-renderer";
import { getGridColumnsClass } from "../../components/fields/field-utils";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../../components/ui/accordion";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "../../components/ui/tabs";
import { useCollectionFields } from "../../hooks/use-collection-fields";
import { useGlobalFields } from "../../hooks/use-global-fields";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../utils";
import { getFullFieldName, resolveValue } from "./field-context";
import { FieldRenderer } from "./field-renderer";

// ============================================================================
// Types
// ============================================================================

/**
 * Collection config as expected by AutoFormFields
 * This matches CollectionBuilderState structure
 */
interface CollectionConfig {
	name?: string;
	fields?: Record<string, FieldDefinition>;
	form?: FormViewConfig;
}

type AdminFormSchema = CollectionSchema["admin"] extends infer TAdmin
	? TAdmin extends { form?: infer TForm }
		? TForm
		: undefined
	: undefined;

export interface AutoFormFieldsProps<
	T extends Questpie<any> = Questpie<any>,
	K extends string = string,
> {
	/**
	 * CMS instance (for schema introspection) - optional
	 */
	cms?: T;

	/**
	 * Collection or global name
	 */
	collection: K;

	/**
	 * Schema source mode.
	 * - "collection": Fetch collection schema (default)
	 * - "global": Fetch global schema
	 * @default "collection"
	 */
	mode?: "collection" | "global";

	/**
	 * Collection config (CollectionBuilderState)
	 */
	config?: CollectionConfig;

	/**
	 * Component registry for custom field types
	 */
	registry?: ComponentRegistry;

	/**
	 * Custom field renderer (fallback)
	 */
	renderField?: (
		fieldName: string,
		fieldDef?: FieldDefinition,
	) => React.ReactNode;

	/**
	 * Field name prefix for nested fields
	 */
	fieldPrefix?: string;

	/**
	 * All collection configs (for embedded collections)
	 */
	allCollectionsConfig?: Record<string, CollectionConfig>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Normalize FieldLayoutItem to field name
 * Only handles field references, returns null for layout containers
 */
function normalizeFieldItem(item: FieldLayoutItem): {
	field: string;
	className?: string;
} | null {
	if (typeof item === "string") {
		return { field: item };
	}
	if (
		typeof item === "object" &&
		item !== null &&
		"field" in item &&
		typeof item.field === "string"
	) {
		return {
			field: item.field,
			className: "className" in item ? item.className : undefined,
		};
	}
	return null;
}

// ============================================================================
// Layout Helpers
// ============================================================================

function getGapStyle(gap?: number) {
	if (gap === undefined) return undefined;
	return `${gap * 0.25}rem`;
}

// ============================================================================
// Schema Mapping Helpers
// ============================================================================

function formatTabId(label: unknown, index: number): string {
	if (typeof label === "string") {
		const normalized = label
			.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-_]/g, "");
		return normalized || `tab-${index}`;
	}
	if (label && typeof label === "object" && "key" in label) {
		const key = (label as { key?: string }).key;
		if (key) return key;
	}
	return `tab-${index}`;
}

function mapSectionsToLayout(
	sections: Array<{
		label?: any;
		description?: any;
		fields: FieldLayoutItem[];
		collapsible?: boolean;
		defaultCollapsed?: boolean;
	}>,
): FieldLayoutItem[] {
	return sections.map((section) => ({
		type: "section",
		label: section.label,
		description: section.description,
		fields: section.fields,
		wrapper: section.collapsible ? "collapsible" : "flat",
		defaultCollapsed: section.defaultCollapsed,
	}));
}

function mapFormSchemaToConfig(
	form?: AdminFormSchema,
): FormViewConfig | undefined {
	if (!form) return undefined;

	// New format: form already has the correct FormViewConfig structure
	// with fields array containing inline sections/tabs
	if (form.fields?.length) {
		return {
			fields: form.fields as FieldLayoutItem[],
			sidebar: form.sidebar as FormSidebarConfig | undefined,
		};
	}

	return undefined;
}

// ============================================================================
// Field Layout Renderers (Recursive)
// ============================================================================

interface FieldLayoutRendererProps {
	fieldItems: FieldLayoutItem[];
	fields: Record<string, FieldDefinition>;
	collection: string;
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	allCollectionsConfig?: Record<string, CollectionConfig>;
	excludedFields?: Set<string>;
	formValues: any;
	resolveText: (
		text: any,
		fallback?: string,
		contextValues?: Record<string, any>,
	) => string;
}

/**
 * Render fields list
 */
function renderFields({
	fieldItems,
	fields,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	excludedFields,
	columns = 1,
	gap,
	className,
}: {
	fieldItems: FieldLayoutItem[];
	fields: Record<string, FieldDefinition>;
	collection: string;
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	allCollectionsConfig?: Record<string, CollectionConfig>;
	excludedFields?: Set<string>;
	columns?: number;
	gap?: number;
	className?: string;
}) {
	const visibleFields = fieldItems
		.map(normalizeFieldItem)
		.filter(
			(item): item is { field: string; className?: string } => item !== null,
		)
		.filter((item) => !excludedFields?.has(item.field));

	if (!visibleFields.length) return null;

	const gridClass = columns > 1 ? getGridColumnsClass(columns, true) : "";

	// Calculate if last field should span full width
	// (when there's an odd number of fields in a multi-column grid)
	const shouldLastFieldSpan =
		columns > 1 && visibleFields.length % columns !== 0;

	const fieldElements = visibleFields.map((item, index) => {
		const isLast = index === visibleFields.length - 1;
		// Use col-span-full for last item that would be alone in its row
		const spanClass = isLast && shouldLastFieldSpan ? "col-span-full" : "";

		return (
			<FieldRenderer
				key={item.field}
				fieldName={item.field}
				fieldDef={fields[item.field]}
				collection={collection}
				mode={mode}
				registry={registry}
				fieldPrefix={fieldPrefix}
				allCollectionsConfig={allCollectionsConfig}
				className={cn(item.className, spanClass)}
				renderEmbeddedFields={({
					embeddedCollection,
					embeddedCollectionConfig,
					fullFieldName,
					index: embeddedIndex,
				}) => (
					<AutoFormFields
						collection={embeddedCollection}
						mode="collection"
						config={embeddedCollectionConfig}
						registry={registry}
						fieldPrefix={`${fullFieldName}.${embeddedIndex}`}
						allCollectionsConfig={allCollectionsConfig}
					/>
				)}
			/>
		);
	});

	// Grid uses container query breakpoints (@sm:, @md:, etc.)
	// These respond to the nearest @container ancestor (defined in AutoFormFields wrapper)
	if (columns > 1) {
		return (
			<div
				className={cn("grid gap-4", gridClass, className)}
				style={gap ? { gap: getGapStyle(gap) } : undefined}
			>
				{fieldElements}
			</div>
		);
	}

	// Single column - no grid needed
	return <div className={cn("space-y-4", className)}>{fieldElements}</div>;
}

/**
 * Render field layout items (fields, sections, tabs)
 *
 * NEW API: fields array can contain:
 * - Field references (string or {field, className})
 * - Section layouts ({ type: 'section', ... })
 * - Tabs layouts ({ type: 'tabs', ... })
 */
function getLayoutKey(item: SectionLayout | TabsLayout): string {
	if (item.type === "tabs") {
		const tabKey = item.tabs
			.map((tab: TabConfig) => tab.id)
			.filter(Boolean)
			.join("-");
		return tabKey ? `tabs-${tabKey}` : "tabs";
	}

	const fieldKey = item.fields
		.map((fieldItem: FieldLayoutItem) => {
			if (isFieldReference(fieldItem)) {
				return getFieldName(fieldItem) ?? "field";
			}
			if (typeof fieldItem === "object" && "type" in fieldItem) {
				return fieldItem.type;
			}
			return "item";
		})
		.join("-");

	return fieldKey ? `section-${fieldKey}` : "section";
}

function renderFieldLayoutItems({
	fieldItems,
	fields,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	excludedFields,
	formValues,
	resolveText,
}: FieldLayoutRendererProps): React.ReactNode {
	if (!fieldItems?.length) return null;

	const renderedItems = fieldItems.map((item, index) => {
		// Field reference (string or {field, className})
		if (isFieldReference(item)) {
			const fieldName = getFieldName(item);
			if (!fieldName || !fields[fieldName]) return null;

			// Check if excluded
			if (excludedFields?.has(fieldName)) return null;

			// Check if hidden
			const fieldDef = fields[fieldName];
			const fieldOptions = (fieldDef as any)["~options"] || {};
			const isHidden =
				typeof fieldOptions.hidden === "function"
					? fieldOptions.hidden(formValues)
					: fieldOptions.hidden === true;
			if (isHidden) return null;

			return (
				<FieldRenderer
					key={fieldName}
					fieldName={fieldName}
					fieldDef={fieldDef}
					collection={collection}
					mode={mode}
					registry={registry}
					fieldPrefix={fieldPrefix}
					allCollectionsConfig={allCollectionsConfig}
					className={
						typeof item === "object" && "className" in item
							? item.className
							: undefined
					}
					renderEmbeddedFields={({
						embeddedCollection,
						embeddedCollectionConfig,
						fullFieldName,
						index: embeddedIndex,
					}) => (
						<AutoFormFields
							collection={embeddedCollection}
							mode="collection"
							config={embeddedCollectionConfig}
							registry={registry}
							fieldPrefix={`${fullFieldName}.${embeddedIndex}`}
							allCollectionsConfig={allCollectionsConfig}
						/>
					)}
				/>
			);
		}

		// Layout containers
		if (typeof item === "object" && "type" in item) {
			switch (item.type) {
				case "tabs":
					return (
						<React.Fragment key={getLayoutKey(item)}>
							{renderTabs({
								tabsLayout: item,
								fields,
								collection,
								mode,
								registry,
								fieldPrefix,
								allCollectionsConfig,
								excludedFields,
								formValues,
								resolveText,
							})}
						</React.Fragment>
					);

				case "section":
					return (
						<React.Fragment key={getLayoutKey(item)}>
							{renderSection({
								section: item,
								index,
								fields,
								collection,
								mode,
								registry,
								fieldPrefix,
								allCollectionsConfig,
								excludedFields,
								formValues,
								resolveText,
							})}
						</React.Fragment>
					);

				default:
					return null;
			}
		}

		return null;
	});

	const validItems = renderedItems.filter(Boolean);

	return validItems.length === 1 ? (
		validItems[0]
	) : (
		<div className="space-y-6">{validItems}</div>
	);
}

/**
 * Render a section layout
 * Mirrors object field: wrapper (flat|collapsible) + layout (stack|inline|grid)
 */
function renderSection({
	section,
	index,
	fields,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	excludedFields,
	formValues,
	resolveText,
}: {
	section: SectionLayout;
	index: number;
	fields: Record<string, FieldDefinition>;
	collection: string;
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	allCollectionsConfig?: Record<string, CollectionConfig>;
	excludedFields?: Set<string>;
	formValues: any;
	resolveText: (
		text: any,
		fallback?: string,
		contextValues?: Record<string, any>,
	) => string;
}): React.ReactNode {
	// Check if hidden
	const isHidden = resolveValue(section.hidden, formValues, false);
	if (isHidden) return null;

	const wrapper = section.wrapper ?? "flat";
	const layout = section.layout ?? "stack";
	const columns = section.columns ?? 2;
	const gap = section.gap;

	// Render section fields based on layout mode
	const renderSectionFields = () => {
		if (layout === "grid") {
			// Grid layout - use renderFields with columns
			return renderFields({
				fieldItems: section.fields,
				fields,
				collection,
				mode,
				registry,
				fieldPrefix,
				allCollectionsConfig,
				excludedFields,
				columns,
				gap,
				className: section.className,
			});
		}

		if (layout === "inline") {
			// Inline layout - horizontal flexbox
			return (
				<div className={cn("flex flex-wrap gap-4", section.className)}>
					{section.fields.map((item, _idx) => {
						const fieldName = getFieldName(item);
						if (!fieldName || !fields[fieldName]) return null;
						if (excludedFields?.has(fieldName)) return null;

						const fieldDef = fields[fieldName];
						const fieldOptions = (fieldDef as any)["~options"] || {};
						const isVis =
							typeof fieldOptions.visible === "function"
								? fieldOptions.visible(formValues)
								: fieldOptions.visible !== false;
						if (!isVis) return null;

						return (
							<FieldRenderer
								key={fieldName}
								fieldName={fieldName}
								fieldDef={fieldDef}
								collection={collection}
								mode={mode}
								registry={registry}
								fieldPrefix={fieldPrefix}
								allCollectionsConfig={allCollectionsConfig}
								className={
									typeof item === "object" && "className" in item
										? item.className
										: undefined
								}
								renderEmbeddedFields={({
									embeddedCollection,
									embeddedCollectionConfig,
									fullFieldName,
									index: embeddedIndex,
								}) => (
									<AutoFormFields
										collection={embeddedCollection}
										mode="collection"
										config={embeddedCollectionConfig}
										registry={registry}
										fieldPrefix={`${fullFieldName}.${embeddedIndex}`}
										allCollectionsConfig={allCollectionsConfig}
									/>
								)}
							/>
						);
					})}
				</div>
			);
		}

		// Stack layout (default) - render using main function
		return renderFieldLayoutItems({
			fieldItems: section.fields,
			fields,
			collection,
			mode,
			registry,
			fieldPrefix,
			allCollectionsConfig,
			excludedFields,
			formValues,
			resolveText,
		});
	};

	const content = renderSectionFields();
	if (!content) return null;

	// Section header
	const header =
		section.label || section.description ? (
			<div className="mb-4">
				{section.label && (
					<h3 className="text-lg font-semibold">
						{resolveText(section.label, "", formValues)}
					</h3>
				)}
				{section.description && (
					<p className="text-sm text-muted-foreground mt-1">
						{resolveText(section.description, "", formValues)}
					</p>
				)}
			</div>
		) : null;

	// Collapsible wrapper
	if (wrapper === "collapsible") {
		const value = `section-${index}`;
		const defaultOpen = section.defaultCollapsed !== true;

		return (
			<Accordion
				key={value}
				defaultValue={defaultOpen ? [value] : []}
				className="w-full"
			>
				<AccordionItem value={value} className="border rounded-lg px-4">
					<AccordionTrigger className="hover:no-underline">
						<span className="font-semibold">
							{resolveText(section.label, "Section", formValues)}
						</span>
					</AccordionTrigger>
					<AccordionContent className="pt-2 pb-4">
						{section.description && (
							<p className="text-sm text-muted-foreground mb-4">
								{resolveText(section.description, "", formValues)}
							</p>
						)}
						{content}
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		);
	}

	// Flat wrapper (no visual container)
	return (
		<div className={cn("space-y-4", section.className)}>
			{header}
			{content}
		</div>
	);
}

/**
 * Render tabs layout
 */
function renderTabs({
	tabsLayout,
	fields,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	excludedFields,
	formValues,
	resolveText,
}: {
	tabsLayout: TabsLayout;
	fields: Record<string, FieldDefinition>;
	collection: string;
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	allCollectionsConfig?: Record<string, CollectionConfig>;
	excludedFields?: Set<string>;
	formValues: any;
	resolveText: (
		text: any,
		fallback?: string,
		contextValues?: Record<string, any>,
	) => string;
}): React.ReactNode {
	const visibleTabs = tabsLayout.tabs.filter(
		(tab: TabConfig) => !resolveValue(tab.hidden, formValues, false),
	);

	if (!visibleTabs.length) return null;

	const defaultTab = visibleTabs[0]?.id;

	return (
		<Tabs defaultValue={defaultTab}>
			<TabsList variant="line">
				{visibleTabs.map((tab: TabConfig) => (
					<TabsTrigger key={tab.id} value={tab.id}>
						{resolveIconElement(tab.icon, { className: "mr-2 size-4" })}
						{resolveText(tab.label, tab.id, formValues)}
					</TabsTrigger>
				))}
			</TabsList>
			{visibleTabs.map((tab: TabConfig) => (
				<TabsContent key={tab.id} value={tab.id} className="mt-4">
					{renderFieldLayoutItems({
						fieldItems: tab.fields,
						fields,
						collection,
						mode,
						registry,
						fieldPrefix,
						allCollectionsConfig,
						excludedFields,
						formValues,
						resolveText,
					})}
				</TabsContent>
			))}
		</Tabs>
	);
}

/**
 * Render sidebar content
 */
function renderSidebar({
	sidebar,
	fields,
	collection,
	mode = "collection",
	registry,
	fieldPrefix,
	allCollectionsConfig,
	formValues,
	resolveText,
}: {
	sidebar: FormSidebarConfig;
	fields: Record<string, FieldDefinition>;
	collection: string;
	mode?: "collection" | "global";
	registry?: ComponentRegistry;
	fieldPrefix?: string;
	allCollectionsConfig?: Record<string, CollectionConfig>;
	formValues: any;
	resolveText: (
		text: any,
		fallback?: string,
		contextValues?: Record<string, any>,
	) => string;
}): React.ReactNode {
	return renderFieldLayoutItems({
		fieldItems: sidebar.fields,
		fields,
		collection,
		mode,
		registry,
		fieldPrefix,
		allCollectionsConfig,
		formValues,
		resolveText,
	});
}

/**
 * Extract field names from field layout items recursively
 */
function extractFieldNamesFromFieldItems(
	fieldItems?: FieldLayoutItem[],
): Set<string> {
	const fieldNames = new Set<string>();

	if (!fieldItems) return fieldNames;

	for (const item of fieldItems) {
		// Field reference
		if (isFieldReference(item)) {
			const fieldName = getFieldName(item);
			if (fieldName) fieldNames.add(fieldName);
			continue;
		}

		// Layout containers
		if (typeof item === "object" && "type" in item) {
			switch (item.type) {
				case "tabs":
					for (const tab of item.tabs) {
						const tabFields = extractFieldNamesFromFieldItems(tab.fields);
						for (const f of tabFields) fieldNames.add(f);
					}
					break;

				case "section": {
					const sectionFields = extractFieldNamesFromFieldItems(item.fields);
					for (const f of sectionFields) fieldNames.add(f);
					break;
				}
			}
		}
	}

	return fieldNames;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * AutoFormFields Component
 *
 * Renders form fields based on CollectionBuilderState config.
 * Supports recursive tabs/sections nesting and auto-generates
 * field list when no form config is defined.
 */
export function AutoFormFields<T extends Questpie<any>, K extends string>({
	cms: _cms,
	collection,
	mode = "collection",
	config,
	registry,
	renderField,
	fieldPrefix,
	allCollectionsConfig,
}: AutoFormFieldsProps<T, K>): React.ReactElement {
	// Use the appropriate hook based on mode
	const collectionResult = useCollectionFields(
		mode === "collection" ? collection : "",
		{
			fallbackFields: mode === "collection" ? config?.fields : undefined,
			schemaQueryOptions: { enabled: mode === "collection" },
		},
	);
	const globalResult = useGlobalFields(mode === "global" ? collection : "", {
		schemaQueryOptions: { enabled: mode === "global" },
	});

	const resolvedFields =
		mode === "global"
			? { ...globalResult.fields, ...config?.fields }
			: collectionResult.fields;
	const schema =
		mode === "global" ? (globalResult.schema as any) : collectionResult.schema;
	const form = useFormContext() as any;
	// Use useWatch hook (React pattern) instead of form.watch() method
	// Watch all form values - the fieldPrefix scoping is handled below
	const watchedValues = useWatch({ control: form.control });

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

	const resolveText = useResolveText();

	// Get fields config
	const fields = (resolvedFields || {}) as Record<string, FieldDefinition>;

	// Extract form config from view builder (~config property)
	const schemaFormConfig = mapFormSchemaToConfig(schema?.admin?.form);
	const formConfig =
		(config?.form as any)?.["~config"] ?? config?.form ?? schemaFormConfig;

	// Get all field names for auto-generation
	const allFieldNames = Object.keys(fields);

	// Collect sidebar field names to exclude from main content
	const sidebarFieldNames = formConfig?.sidebar
		? extractFieldNamesFromFieldItems(formConfig.sidebar.fields)
		: new Set<string>();

	// Custom render function provided
	if (renderField) {
		return (
			<div className="space-y-4">
				{allFieldNames.map((fieldName) => {
					const fullFieldName = getFullFieldName(fieldName, fieldPrefix);
					return (
						<React.Fragment key={fullFieldName}>
							{renderField(fullFieldName, fields[fieldName])}
						</React.Fragment>
					);
				})}
			</div>
		);
	}

	// Render main content based on form config
	const renderMainContent = () => {
		// If form config has fields, render them
		if (formConfig?.fields?.length) {
			return renderFieldLayoutItems({
				fieldItems: formConfig.fields,
				fields,
				collection,
				mode,
				registry,
				fieldPrefix,
				allCollectionsConfig,
				excludedFields: sidebarFieldNames,
				formValues,
				resolveText,
			});
		}

		// Auto-generate: render all fields not in sidebar
		const autoFields = allFieldNames.filter((f) => !sidebarFieldNames.has(f));
		if (autoFields.length) {
			return renderFields({
				fieldItems: autoFields,
				fields,
				collection,
				mode,
				registry,
				fieldPrefix,
				allCollectionsConfig,
			});
		}

		return null;
	};

	const mainContent = renderMainContent();

	// Check if sidebar layout is needed
	const hasSidebar = formConfig?.sidebar?.fields?.length;

	if (hasSidebar && formConfig?.sidebar) {
		const sidebarContent = renderSidebar({
			sidebar: formConfig.sidebar,
			fields,
			collection,
			mode,
			registry,
			fieldPrefix,
			allCollectionsConfig,
			formValues,
			resolveText,
		});

		const sidebarPosition = formConfig.sidebar.position || "right";

		// Single @container on outermost wrapper for all container queries
		return (
			<div className="@container w-full">
				<div
					className={cn(
						"flex flex-col-reverse gap-6 @2xl:flex-row",
						sidebarPosition === "left" && "@2xl:flex-row-reverse",
					)}
				>
					<div className="min-w-0 flex-1">{mainContent}</div>
					{sidebarContent && (
						<aside
							className={cn(
								"@2xl:border-l @max-2xl:border-b @max-2xl:pb-4 w-full border-border @2xl:pl-4",
								"w-full @2xl:max-w-xs",
							)}
						>
							<div className="space-y-4 @2xl:sticky @2xl:h-auto @2xl:top-4">
								{sidebarContent}
							</div>
						</aside>
					)}
				</div>
			</div>
		);
	}

	return <div className="@container">{mainContent}</div>;
}
