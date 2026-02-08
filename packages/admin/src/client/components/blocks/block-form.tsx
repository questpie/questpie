/**
 * Block Form
 *
 * Form for editing the selected block's values.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { BlockNode } from "../../blocks/types.js";
import type { FieldDefinition } from "../../builder/field/field.js";
import { useResolveText } from "../../i18n/hooks.js";
import { FormField } from "../../views/collection/form-field.js";
import { Button } from "../ui/button.js";
import {
	useBlockEditor,
	useSelectedBlockDefinition,
} from "./block-editor-context.js";
import { BlockTypeIcon } from "./block-type-icon.js";
import { findBlockById } from "./utils/tree-utils.js";

// ============================================================================
// Component
// ============================================================================

export function BlockForm() {
	const { state, actions } = useBlockEditor();
	const blockDef = useSelectedBlockDefinition();

	// Find block node
	const block = React.useMemo(() => {
		if (!state.selectedBlockId) return null;
		return findBlockById(state.content._tree, state.selectedBlockId);
	}, [state.content._tree, state.selectedBlockId]);

	if (!state.selectedBlockId || !block || !blockDef) {
		return <BlockFormEmpty />;
	}

	// Get block label
	const blockLabel = getBlockDisplayLabel(blockDef, block);

	// Handle close (deselect block)
	const handleClose = () => {
		actions.selectBlock(null);
	};

	return (
		<div className="flex h-full flex-col">
			{/* Header */}
			<div className="flex items-center gap-2 border-b px-4 py-3">
				<BlockTypeIcon type={block.type} size={18} />
				<h3 className="flex-1 font-medium text-sm">{blockLabel}</h3>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0"
					onClick={handleClose}
					title="Close"
				>
					<Icon icon="ph:x" className="h-4 w-4" />
				</Button>
			</div>

			{/* Description */}
			{blockDef.admin?.description && (
				<p className="border-b px-4 py-2 text-sm text-muted-foreground">
					{getDescriptionText(blockDef.admin.description)}
				</p>
			)}

			{/* Fields */}
			<div className="flex-1 overflow-auto p-4">
				{blockDef.fields ? (
					// Key by blockId to force remount when switching blocks
					// This prevents React from reusing Controller instances
					// which would cause values to leak between blocks with same field names
					<BlockFormFields
						key={state.selectedBlockId}
						fields={blockDef.fields as Record<string, FieldDefinition>}
						blockId={state.selectedBlockId!}
					/>
				) : (
					<div className="text-center text-sm text-muted-foreground">
						This block has no editable fields.
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Empty State
// ============================================================================

function BlockFormEmpty() {
	return (
		<div className="flex h-full items-center justify-center text-center">
			<div className="text-muted-foreground">
				<p className="text-lg font-medium">No block selected</p>
				<p className="text-sm">Click a block to edit its content</p>
			</div>
		</div>
	);
}

// ============================================================================
// Block Form Fields
// ============================================================================

type BlockFormFieldsProps = {
	fields: Record<string, FieldDefinition>;
	blockId: string;
};

function BlockFormFields({ fields, blockId }: BlockFormFieldsProps) {
	return (
		<div className="space-y-4">
			{Object.entries(fields).map(([fieldName, fieldDef]) => (
				<BlockFormField
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
// Individual Field - Uses registered field components with scoped names
// ============================================================================

type BlockFormFieldProps = {
	name: string;
	blockId: string;
	definition: FieldDefinition;
};

function BlockFormField({ name, blockId, definition }: BlockFormFieldProps) {
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

	// If field has a registered component, use it with scoped name
	if (FieldComponent) {
		const componentProps = {
			name: scopedName,
			label,
			description,
			placeholder,
			required: options.required ?? false,
			disabled: options.disabled ?? false,
			readOnly: options.readOnly ?? false,
			localized: options.localized ?? false, // IMPORTANT: Pass localized for LocaleBadge
			// Pass all field-specific options
			...stripUiOptions(options),
		};

		return <FieldComponent {...componentProps} />;
	}

	// Fallback to FormField for unregistered field types
	return (
		<FormField
			name={scopedName}
			label={label}
			description={description}
			placeholder={placeholder}
			required={options.required}
			disabled={options.disabled}
			localized={options.localized} // IMPORTANT: Pass localized for LocaleBadge
			type={fieldType as any}
			options={options.options}
		/>
	);
}

// Strip UI-specific options that shouldn't be passed to field components
function stripUiOptions(options: Record<string, any>) {
	const {
		label,
		description,
		placeholder,
		required,
		disabled,
		readOnly,
		hidden,
		visible,
		localized,
		locale,
		compute,
		onChange: _onChange,
		...rest
	} = options;
	return rest;
}

// ============================================================================
// Helpers
// ============================================================================

import type { BlockSchema } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types.js";

function getDescriptionText(description: I18nText | undefined): string {
	if (!description) return "";

	if (typeof description === "string") {
		return description;
	}

	if (typeof description === "function") {
		return "";
	}

	if ("key" in description) {
		return description.fallback || "";
	}

	const localeMap = description as Record<string, string>;
	return localeMap.en || Object.values(localeMap)[0] || "";
}

function getBlockDisplayLabel(blockDef: BlockSchema, block: BlockNode): string {
	const label = blockDef.admin?.label;

	if (!label) {
		return block.type.charAt(0).toUpperCase() + block.type.slice(1);
	}

	if (typeof label === "string") {
		return label;
	}

	if ("key" in label) {
		return label.fallback || block.type;
	}

	// I18nLocaleMap
	return label.en || Object.values(label)[0] || block.type;
}
