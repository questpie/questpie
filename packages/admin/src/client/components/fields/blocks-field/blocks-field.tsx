/**
 * Blocks Field Component
 *
 * Form field for editing block content using the visual block editor.
 * Block definitions are fetched from server introspection API.
 */

"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";

import type { BlockSchema } from "#questpie/admin/server/block/index.js";

import type { BlockContent } from "../../../blocks/types.js";
import { EMPTY_BLOCK_CONTENT, isBlockContent } from "../../../blocks/types.js";
import type { BaseFieldProps } from "../../../builder/types/common.js";
import { useAdminConfig } from "../../../hooks/use-admin-config.js";
import { useTranslation } from "../../../i18n/hooks.js";
import { BlockEditorLayout } from "../../blocks/block-editor-layout.js";
import { BlockEditorProvider } from "../../blocks/block-editor-provider.js";
import { countBlocks } from "../../blocks/utils/tree-utils.js";
import { FieldWrapper } from "../field-wrapper.js";

const EMPTY_BLOCKS: Record<string, BlockSchema> = {};

/**
 * Blocks field configuration.
 *
 * @typeParam TAllowed - Union of allowed block type names (inferred from admin registry)
 */
export type BlocksFieldConfig<TAllowed extends string = string> = {
	/** Allowed block types (if not set, all registered blocks are allowed) */
	allowedBlocks?: TAllowed[];
	/** Minimum number of blocks */
	minBlocks?: number;
	/** Maximum number of blocks */
	maxBlocks?: number;
};

type BlocksFieldProps = BaseFieldProps & BlocksFieldConfig;

/**
 * Blocks field component.
 *
 * Renders the visual block editor for editing block content.
 */
export function BlocksField({
	name,
	value,
	onChange,
	label,
	description,
	error,
	required,
	disabled,
	allowedBlocks,
	minBlocks,
	maxBlocks,
}: BlocksFieldProps) {
	const { t } = useTranslation();
	const form = useFormContext();
	const watchedContent = useWatch({ control: form.control, name });
	const { data: adminConfig } = useAdminConfig();

	// Ensure we have valid block content
	const content: BlockContent = isBlockContent(watchedContent)
		? watchedContent
		: isBlockContent(value)
			? value
			: EMPTY_BLOCK_CONTENT;

	// Get blocks from server introspection
	const blocks = adminConfig?.blocks ?? EMPTY_BLOCKS;

	// Filter blocks by allowed list
	const filteredBlocks = React.useMemo<Record<string, BlockSchema>>(() => {
		if (!allowedBlocks || allowedBlocks.length === 0) {
			return blocks;
		}
		const allowed = new Set(allowedBlocks);
		return Object.fromEntries(
			Object.entries(blocks).filter(([name]) => allowed.has(name)),
		);
	}, [blocks, allowedBlocks]);

	// Handle content changes (validation happens on form submit)
	const handleChange = React.useCallback(
		(newContent: BlockContent) => {
			onChange?.(newContent);
		},
		[onChange],
	);

	const blockCount = countBlocks(content._tree);
	const hasBlocks = Object.keys(filteredBlocks).length > 0;

	return (
		<FieldWrapper
			name={name}
			label={label}
			description={description}
			error={error}
			required={required}
			disabled={disabled}
		>
			<div className="qa-blocks-field">
				{hasBlocks ? (
					<BlockEditorProvider
						value={content}
						onChange={handleChange}
						blocks={filteredBlocks}
						allowedBlocks={allowedBlocks}
					>
						<BlockEditorLayout />
					</BlockEditorProvider>
				) : (
					<div className="text-muted-foreground py-4">
						<p className="text-sm">{t("blocks.noDefinitions")}</p>
						<p className="mt-1 text-xs">{t("blocks.noDefinitionsHint")}</p>
					</div>
				)}

				{/* Constraints info */}
				{(minBlocks || maxBlocks) && (
					<div className="text-muted-foreground mt-2 text-xs">
						{minBlocks && <span>Min: {minBlocks} blocks </span>}
						{maxBlocks && <span>Max: {maxBlocks} blocks</span>}
						<span className="ml-2">Current: {blockCount}</span>
					</div>
				)}
			</div>
		</FieldWrapper>
	);
}
