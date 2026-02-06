/**
 * Blocks Field Component
 *
 * Form field for editing block content using the visual block editor.
 */

"use client";

import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { BlockContent } from "../../../blocks/types.js";
import { EMPTY_BLOCK_CONTENT, isBlockContent } from "../../../blocks/types.js";
import type { BlockDefinition } from "../../../builder/block/types.js";
import type { BaseFieldProps } from "../../../builder/types/common.js";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { BlockEditorLayout } from "../../blocks/block-editor-layout.js";
import { BlockEditorProvider } from "../../blocks/block-editor-provider.js";
import { countBlocks } from "../../blocks/utils/tree-utils.js";
import { FieldWrapper } from "../field-wrapper.js";

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

export type BlocksFieldProps = BaseFieldProps &
  BlocksFieldConfig & {
    /** Registered block definitions (passed from admin context) */
    blocks?: Record<string, BlockDefinition>;
  };

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
  readOnly,
  allowedBlocks,
  minBlocks,
  maxBlocks,
  blocks = {},
}: BlocksFieldProps) {
  const form = useFormContext();
  const watchedContent = useWatch({ control: form.control, name });

  // Ensure we have valid block content
  const content: BlockContent = isBlockContent(watchedContent)
    ? watchedContent
    : isBlockContent(value)
      ? value
      : EMPTY_BLOCK_CONTENT;

  // Filter blocks by allowed list
  const filteredBlocks = React.useMemo(() => {
    if (!allowedBlocks || allowedBlocks.length === 0) {
      return blocks;
    }
    return Object.fromEntries(
      Object.entries(blocks).filter(([name]) => allowedBlocks.includes(name)),
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
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-medium">
              <span>Blocks ({blockCount})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="py-8 text-center text-muted-foreground">
              <p className="text-sm">No block definitions registered</p>
              <p className="mt-1 text-xs">
                Register blocks with .blocks() in your admin configuration
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Constraints info */}
      {(minBlocks || maxBlocks) && (
        <div className="mt-2 text-xs text-muted-foreground">
          {minBlocks && <span>Min: {minBlocks} blocks </span>}
          {maxBlocks && <span>Max: {maxBlocks} blocks</span>}
          <span className="ml-2">Current: {blockCount}</span>
        </div>
      )}
    </FieldWrapper>
  );
}

export default BlocksField;
