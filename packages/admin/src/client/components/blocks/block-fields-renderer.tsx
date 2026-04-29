/**
 * Block Fields Renderer
 *
 * Renders form fields for a block inline (inside the block card).
 * Uses registered field components from the admin config.
 */

"use client";

import * as React from "react";

import type { BlockSchema } from "#questpie/admin/server/block/index.js";

import type { FieldInstance } from "../../builder/field/field.js";
import { useResolveText, useTranslation } from "../../i18n/hooks.js";
import { selectAdmin, useAdminStore } from "../../runtime/provider.js";
import { buildFieldDefinitionsFromMetadata } from "../../utils/build-field-definitions-from-schema.js";
import { useLazyComponent } from "../../utils/use-lazy-component.js";
import {
	FieldLayoutRenderer,
	type FieldLayoutContext,
} from "../layout/field-layout-renderer.js";
import { Skeleton } from "../ui/skeleton.js";

// ============================================================================
// Types
// ============================================================================

type BlockFieldsRendererProps = {
	/** Block ID for scoping field names */
	blockId: string;
	/** Block schema containing field definitions */
	blockSchema: BlockSchema;
};

// ============================================================================
// Component
// ============================================================================

export function BlockFieldsRenderer({
	blockId,
	blockSchema,
}: BlockFieldsRendererProps) {
	const { t } = useTranslation();
	const admin = useAdminStore(selectAdmin);

	// Convert block field metadata to field definitions with component references
	const blockFields = React.useMemo(() => {
		if (!blockSchema?.fields || !admin) return {};
		return buildFieldDefinitionsFromMetadata(
			blockSchema.fields as Record<
				string,
				{ metadata?: unknown; name?: string }
			>,
			admin.getFields() as any,
		);
	}, [blockSchema?.fields, admin]);

	const resolveText = useResolveText();

	if (Object.keys(blockFields).length === 0) {
		return (
			<div className="text-muted-foreground py-4 text-center text-sm">
				{t("blocks.noEditableFields")}
			</div>
		);
	}

	// When form layout is defined, use the shared layout renderer
	if (blockSchema.form?.fields?.length) {
		const layoutCtx: FieldLayoutContext = {
			renderField: (fieldName) => {
				const fieldDef = blockFields[fieldName];
				if (!fieldDef) return null;
				return (
					<BlockField
						key={`${blockId}:${fieldName}`}
						name={fieldName}
						blockId={blockId}
						definition={fieldDef}
					/>
				);
			},
			resolveText: (text, fallback) => resolveText(text, fallback),
		};
		return (
			<FieldLayoutRenderer
				items={blockSchema.form.fields as any}
				ctx={layoutCtx}
			/>
		);
	}

	return (
		<div className="space-y-4">
			{Object.entries(blockFields).map(([fieldName, fieldDef]) => (
				<BlockField
					// Include blockId in key to ensure fresh Controller instances per block
					key={`${blockId}:${fieldName}`}
					name={fieldName}
					blockId={blockId}
					definition={fieldDef}
				/>
			))}
		</div>
	);
}

// ============================================================================
// Individual Field
// ============================================================================

type BlockFieldProps = {
	name: string;
	blockId: string;
	definition: FieldInstance;
};

function BlockFieldSkeleton({ type }: { type?: string }) {
	const isLarge = type === "blocks" || type === "json" || type === "richText";
	return (
		<div className="space-y-2" aria-busy="true">
			<Skeleton variant="text" className="h-4 w-24" />
			<Skeleton className={isLarge ? "h-40 w-full" : "h-10 w-full"} />
		</div>
	);
}

function BlockField({ name, blockId, definition }: BlockFieldProps) {
	const resolveText = useResolveText();
	const options = (definition["~options"] || {}) as Record<string, any>;
	const fieldType = definition.name;

	// Resolve i18n texts
	const label = resolveText(options.label, name);
	const description = resolveText(options.description, "");
	const placeholder = resolveText(options.placeholder, "");

	// Scope the field name to the block's values in the parent form
	// This ensures block fields don't conflict with collection-level fields
	const scopedName = `content._values.${blockId}.${name}`;

	// Check if field has a registered component
	const { Component: FieldComponent, loading: componentLoading } =
		useLazyComponent(definition.component);

	if (componentLoading) {
		return <BlockFieldSkeleton type={fieldType} />;
	}

	// All fields should have a registered component (registry-first)
	if (!FieldComponent) {
		return (
			<div className="text-destructive text-sm">
				No component registered for field type: {fieldType}
			</div>
		);
	}

	const componentProps = {
		name: scopedName,
		label,
		description,
		placeholder,
		required: options.required ?? false,
		disabled: options.disabled ?? false,
		readOnly: options.readOnly ?? false,
		localized: options.localized ?? false,
		...stripUiOptions(options),
	};

	return <FieldComponent {...componentProps} />;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Strip UI-specific options that shouldn't be passed to field components
 */
function stripUiOptions(options: Record<string, any>) {
	const {
		label: _label,
		description: _description,
		placeholder: _placeholder,
		required: _required,
		disabled: _disabled,
		readOnly: _readOnly,
		hidden: _hidden,
		visible: _visible,
		localized: _localized,
		locale: _locale,
		compute: _compute,
		onChange: _onChange,
		...rest
	} = options;
	return rest;
}
