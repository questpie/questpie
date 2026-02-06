/**
 * RichText Editor Variants
 *
 * Convenience components for common presets.
 */

import * as React from "react";

import { RichTextEditor } from "./index";
import type { RichTextEditorProps } from "./types";

/**
 * RichTextMinimal - Only bubble menu with basic formatting
 *
 * Perfect for: Inline editing, comments, simple text fields
 * Features: Bold, Italic, Underline, Link (bubble menu only)
 *
 * @example
 * ```tsx
 * <RichTextMinimal
 *   name="comment"
 *   value={comment}
 *   onChange={setComment}
 *   placeholder="Add a comment..."
 * />
 * ```
 */
export function RichTextMinimal(props: Omit<RichTextEditorProps, "preset">) {
  return <RichTextEditor {...props} preset="minimal" />;
}

/**
 * RichTextSimple - Basic rich text without media
 *
 * Perfect for: Blog posts, articles, descriptions
 * Features: Headings, formatting, lists, quotes, links
 *
 * @example
 * ```tsx
 * <RichTextSimple
 *   name="description"
 *   value={description}
 *   onChange={setDescription}
 *   placeholder="Enter description..."
 *   showCharacterCount
 *   maxCharacters={500}
 * />
 * ```
 */
export function RichTextSimple(props: Omit<RichTextEditorProps, "preset">) {
  return <RichTextEditor {...props} preset="simple" />;
}

/**
 * RichTextStandard - Full-featured editor (default)
 *
 * Perfect for: General-purpose content editing
 * Features: All formatting, alignment, images, tables
 *
 * @example
 * ```tsx
 * <RichTextStandard
 *   name="content"
 *   value={content}
 *   onChange={setContent}
 *   onImageUpload={handleImageUpload}
 * />
 * ```
 */
export function RichTextStandard(props: Omit<RichTextEditorProps, "preset">) {
  return <RichTextEditor {...props} preset="standard" />;
}

/**
 * RichTextAdvanced - Everything including advanced features
 *
 * Perfect for: Documentation, technical writing, complex layouts
 * Features: Everything in standard + future advanced features
 *
 * @example
 * ```tsx
 * <RichTextAdvanced
 *   name="documentation"
 *   value={docs}
 *   onChange={setDocs}
 *   onImageUpload={handleImageUpload}
 *   showCharacterCount
 * />
 * ```
 */
export function RichTextAdvanced(props: Omit<RichTextEditorProps, "preset">) {
  return <RichTextEditor {...props} preset="advanced" />;
}
