/**
 * BlockInspectorBody
 *
 * Default `renderBlock` implementation for `VisualInspectorPanel`.
 * Resolves the block's type from the current `_tree`, looks up the
 * matching schema in the admin config, and renders the block's
 * fields inline so the user can edit them without leaving the
 * inspector.
 *
 * Add/duplicate/remove/reorder are driven by the same pure
 * operations the inline `BlockEditorProvider` uses, so behaviour
 * is identical regardless of the surface.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFormContext } from "react-hook-form";

import {
	duplicateBlockInContent,
	removeBlockFromContent,
} from "../../blocks/block-operations.js";
import type { BlockContent, BlockNode } from "../../blocks/types.js";
import { EMPTY_BLOCK_CONTENT, isBlockContent } from "../../blocks/types.js";
import { useAdminConfig } from "../../hooks/use-admin-config.js";
import { useTranslation } from "../../i18n/hooks.js";
import { BlockFieldsRenderer } from "../blocks/block-fields-renderer.js";
import { findBlockById } from "../blocks/utils/tree-utils.js";
import { Button } from "../ui/button.js";
import { useVisualEdit } from "./visual-edit-context.js";

// ============================================================================
// Types
// ============================================================================

export type BlockInspectorBodyProps = {
	/** Form-field path of the surrounding blocks field */
	blocksPath: string;
	/** Id of the selected block */
	blockId: string;
};

// ============================================================================
// Component
// ============================================================================

export function BlockInspectorBody({
	blocksPath,
	blockId,
}: BlockInspectorBodyProps) {
	const { t } = useTranslation();
	const form = useFormContext();
	const { data: adminConfig } = useAdminConfig();
	const { clear } = useVisualEdit();

	// Watch the entire blocks-field value so the inspector re-renders
	// when the block tree changes (e.g. duplicate/remove from elsewhere).
	const blocksValue = form.watch(blocksPath) as unknown;
	const content: BlockContent = isBlockContent(blocksValue)
		? blocksValue
		: EMPTY_BLOCK_CONTENT;

	const block: BlockNode | null = React.useMemo(
		() => findBlockById(content._tree, blockId),
		[content._tree, blockId],
	);

	const blockSchema = block ? adminConfig?.blocks?.[block.type] : undefined;

	const writeContent = React.useCallback(
		(next: BlockContent) => {
			form.setValue(blocksPath, next as any, {
				shouldDirty: true,
				shouldTouch: true,
			});
		},
		[form, blocksPath],
	);

	const handleDuplicate = React.useCallback(() => {
		const result = duplicateBlockInContent(content, blockId);
		writeContent(result.content);
	}, [blockId, content, writeContent]);

	const handleRemove = React.useCallback(() => {
		const result = removeBlockFromContent(content, blockId);
		writeContent(result.content);
		// Selecting a removed block has no meaning — fall back to Document.
		clear();
	}, [blockId, clear, content, writeContent]);

	if (!block) {
		return (
			<div className="text-muted-foreground py-8 text-center text-xs">
				<p>{t("blocks.unknownBlock", { defaultValue: "Block not found" })}</p>
				<code className="bg-muted mt-1 inline-block rounded px-1.5 py-0.5">
					{blockId}
				</code>
			</div>
		);
	}

	if (!blockSchema) {
		return (
			<div className="border-destructive/40 bg-destructive/5 text-destructive rounded border p-3 text-sm">
				<div className="flex items-center gap-2 font-medium">
					<Icon icon="ph:warning" className="h-4 w-4" />
					{t("blocks.unknownType", { type: block.type })}
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* Inline action toolbar */}
			<div className="bg-surface-low border-border-subtle flex items-center justify-end gap-1 rounded-md border p-1">
				<Button
					variant="ghost"
					size="sm"
					onClick={handleDuplicate}
					className="gap-1.5"
				>
					<Icon icon="ph:copy" className="h-3.5 w-3.5" />
					<span className="text-xs">
						{t("blocks.duplicate", { defaultValue: "Duplicate" })}
					</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleRemove}
					className="text-destructive hover:text-destructive gap-1.5"
				>
					<Icon icon="ph:trash" className="h-3.5 w-3.5" />
					<span className="text-xs">
						{t("blocks.remove", { defaultValue: "Remove" })}
					</span>
				</Button>
			</div>

			{/* Block fields — same renderer the inline editor uses, so a
			    block edited from the inspector and one edited from the tree
			    end up with identical form state. */}
			<BlockFieldsRenderer
				blockId={blockId}
				blockSchema={blockSchema}
				blocksPath={blocksPath}
			/>
		</div>
	);
}
