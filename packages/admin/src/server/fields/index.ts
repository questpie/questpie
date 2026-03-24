/**
 * Admin Field Types
 *
 * Additional field types provided by the admin module.
 * These fields are registered automatically when the `adminModule` is used.
 *
 * @example
 * ```ts
 * // questpie.config.ts
 * import { runtimeConfig } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * export default runtimeConfig({
 *   modules: [adminModule],  // Registers richText and blocks fields
 * });
 *
 * // collections/pages/index.ts — fields are now available via file convention
 * import { collection } from "questpie";
 *
 * export default collection("pages", {
 *   fields: ({ f }) => ({
 *     title: f.text({ required: true }),
 *     content: f.richText({ features: ["bold", "italic", "link"] }),
 *     sections: f.blocks({ allowedBlocks: ["hero", "text"] }),
 *   }),
 * });
 * ```
 */

// Export types
export type {
	BlockNode,
	BlocksDocument,
	BlocksFieldMeta,
	BlockValues,
} from "./blocks.js";
// Export field factories
export { type BlocksFieldState, blocks, blocksFieldType } from "./blocks.js";
export type {
	RichTextFeature,
	RichTextFieldMeta,
	TipTapDocument,
	TipTapNode,
} from "./rich-text.js";
export { type RichTextFieldState, richText, richTextFieldType } from "./rich-text.js";

// Import V2 factories for adminFields record
import { blocks } from "./blocks.js";
import { richText } from "./rich-text.js";

/**
 * Admin field types to be registered with the field registry.
 * These are V2 factory functions — callable in `.fields()` callbacks.
 */
export const adminFields = {
	richText,
	blocks,
} as const;
