/**
 * Block Fields Renderer
 *
 * Renders form fields for a block inline (inside the block card).
 * Uses registered field components from the admin config.
 */

"use client";

import * as React from "react";
import type { BlockSchema } from "#questpie/admin/server";
import type { FieldDefinition } from "../../builder/field/field.js";
import { useResolveText } from "../../i18n/hooks.js";
import { selectAdmin, useAdminStore } from "../../runtime/index.js";
import { buildFieldDefinitionsFromMetadata } from "../../utils/build-field-definitions-from-schema.js";

// ============================================================================
// Types
// ============================================================================

export type BlockFieldsRendererProps = {
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

	if (Object.keys(blockFields).length === 0) {
		return (
			<div className="text-center text-sm text-muted-foreground py-4">
				This block has no editable fields.
			</div>
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
	definition: FieldDefinition;
};

function BlockField({ name, blockId, definition }: BlockFieldProps) {
	const resolveText = useResolveText();
	const options = (definition as any)["~options"] || {};
	const fieldType = definition.name;

	// Resolve i18n texts
	const label = resolveText(options.label, name);
	const description = resolveText(options.description, "");
	const placeholder = resolveText(options.placeholder, "");

	// Scope the field name to the block's values in the parent form
	// This ensures block fields don't conflict with collection-level fields
	const scopedName = `content._values.${blockId}.${name}`;

	// Check if field has a registered component
	const FieldComponent = definition.field?.component as
		| React.ComponentType<any>
		| undefined;

	// All fields should have a registered component (registry-first)
	if (!FieldComponent) {
		return (
			<div className="text-sm text-destructive">
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
