/**
 * Field Layout Renderer
 *
 * Shared layout rendering for form fields supporting sections, tabs, and grids.
 * Parameterized with a renderField callback so it can be used by:
 * - Block fields renderer (scoped names: content._values.{blockId}.{field})
 * - Object field component (scoped names: parent.field)
 * - Collection/global forms (via auto-form-fields.tsx)
 */

"use client";

import * as React from "react";

import type { FieldLayoutItem } from "../../builder";
import {
	getFieldName,
	isFieldReference,
} from "../../builder/types/field-types";
import { cn } from "../../lib/utils";
import { resolveIconElement } from "../component-renderer";
import { getGridColumnsClass } from "../fields/field-utils";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "../ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

// ============================================================================
// Types
// ============================================================================

export interface FieldLayoutContext {
	/** Render a single field by name */
	renderField: (
		fieldName: string,
		opts?: { className?: string },
	) => React.ReactNode;
	/** Resolve i18n text to string */
	resolveText: (text: any, fallback?: string) => string;
}

interface FieldLayoutRendererProps {
	/** Layout items to render */
	items: FieldLayoutItem[];
	/** Context for rendering */
	ctx: FieldLayoutContext;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Render an array of FieldLayoutItem using the provided context.
 * Handles field references, sections, and tabs recursively.
 */
export function FieldLayoutRenderer({
	items,
	ctx,
}: FieldLayoutRendererProps): React.ReactNode {
	if (!items?.length) return null;

	const renderedItems = items.map((item, index) => {
		// Field reference (string or {field, className})
		if (isFieldReference(item)) {
			const fieldName = getFieldName(item);
			if (!fieldName) return null;
			const className =
				typeof item === "object" && "className" in item
					? item.className
					: undefined;
			return (
				<React.Fragment key={fieldName}>
					{ctx.renderField(fieldName, { className })}
				</React.Fragment>
			);
		}

		// Layout containers
		if (typeof item === "object" && "type" in item) {
			switch (item.type) {
				case "section":
					return (
						<SectionRenderer
							key={`section-${index}`}
							section={item}
							index={index}
							ctx={ctx}
						/>
					);
				case "tabs":
					return (
						<TabsRenderer key={`tabs-${index}`} tabsLayout={item} ctx={ctx} />
					);
				default:
					return null;
			}
		}

		return null;
	});

	const validItems = renderedItems.filter(Boolean);
	if (validItems.length === 0) return null;

	return validItems.length === 1 ? (
		validItems[0]
	) : (
		<div className="space-y-6">{validItems}</div>
	);
}

// ============================================================================
// Section Renderer
// ============================================================================

function SectionRenderer({
	section,
	index,
	ctx,
}: {
	section: any;
	index: number;
	ctx: FieldLayoutContext;
}): React.ReactNode {
	const wrapper = section.wrapper ?? "flat";
	const layout = section.layout ?? "stack";
	const columns = section.columns ?? 2;

	const renderSectionContent = () => {
		if (!section.fields?.length) return null;

		// For grid layout, render fields in a grid
		if (layout === "grid") {
			const gridClass = getGridColumnsClass(columns, true);
			return (
				<div className={cn("grid gap-4", gridClass, section.className)}>
					{section.fields.map((fieldItem: FieldLayoutItem, idx: number) => {
						if (!isFieldReference(fieldItem)) {
							// Nested layout container
							return (
								<FieldLayoutRenderer
									key={`nested-${idx}`}
									items={[fieldItem]}
									ctx={ctx}
								/>
							);
						}
						const fieldName = getFieldName(fieldItem);
						if (!fieldName) return null;
						const className =
							typeof fieldItem === "object" && "className" in fieldItem
								? fieldItem.className
								: undefined;
						return (
							<React.Fragment key={fieldName}>
								{ctx.renderField(fieldName, { className })}
							</React.Fragment>
						);
					})}
				</div>
			);
		}

		if (layout === "inline") {
			return (
				<div className={cn("flex flex-wrap gap-4", section.className)}>
					{section.fields.map((fieldItem: FieldLayoutItem) => {
						if (!isFieldReference(fieldItem)) return null;
						const fieldName = getFieldName(fieldItem);
						if (!fieldName) return null;
						return (
							<React.Fragment key={fieldName}>
								{ctx.renderField(fieldName)}
							</React.Fragment>
						);
					})}
				</div>
			);
		}

		// Stack (default) — recurse for nested containers
		return <FieldLayoutRenderer items={section.fields} ctx={ctx} />;
	};

	const content = renderSectionContent();
	if (!content) return null;

	// Collapsible wrapper
	if (wrapper === "collapsible") {
		const value = `section-${index}`;
		const defaultOpen = section.defaultCollapsed !== true;
		return (
			<Accordion defaultValue={defaultOpen ? [value] : []} className="w-full">
				<AccordionItem value={value} className="border-transparent px-4">
					<AccordionTrigger className="hover:no-underline">
						<span className="font-semibold">
							{ctx.resolveText(section.label, "Section")}
						</span>
					</AccordionTrigger>
					<AccordionContent className="pt-2 pb-4">
						{section.description && (
							<p className="text-muted-foreground mb-4 text-sm text-pretty">
								{ctx.resolveText(section.description, "")}
							</p>
						)}
						{content}
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		);
	}

	// Flat wrapper
	const header =
		section.label || section.description ? (
			<div className="mb-4">
				{section.label && (
					<h3 className="text-lg font-semibold">
						{ctx.resolveText(section.label, "")}
					</h3>
				)}
				{section.description && (
					<p className="text-muted-foreground mt-1 text-sm text-pretty">
						{ctx.resolveText(section.description, "")}
					</p>
				)}
			</div>
		) : null;

	return (
		<div className={cn("space-y-4", section.className)}>
			{header}
			{content}
		</div>
	);
}

// ============================================================================
// Tabs Renderer
// ============================================================================

function TabsRenderer({
	tabsLayout,
	ctx,
}: {
	tabsLayout: any;
	ctx: FieldLayoutContext;
}): React.ReactNode {
	const tabs = tabsLayout.tabs;
	if (!tabs?.length) return null;

	const defaultTab = tabs[0]?.id;

	return (
		<Tabs defaultValue={defaultTab}>
			<TabsList className="w-full">
				{tabs.map((tab: any) => (
					<TabsTrigger key={tab.id} value={tab.id} className="flex-1">
						{resolveIconElement(tab.icon, { className: "size-3.5" })}
						{ctx.resolveText(tab.label, tab.id)}
					</TabsTrigger>
				))}
			</TabsList>
			{tabs.map((tab: any) => (
				<TabsContent key={tab.id} value={tab.id} className="mt-4">
					<FieldLayoutRenderer items={tab.fields} ctx={ctx} />
				</TabsContent>
			))}
		</Tabs>
	);
}
