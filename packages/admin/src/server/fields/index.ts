/**
 * Admin Field Types
 *
 * Additional field types provided by the admin module.
 * These fields are registered automatically when the `adminModule` is used.
 *
 * @example
 * ```ts
 * // questpie/server/modules.ts
 * import { adminModule } from "@questpie/admin/server";
 *
 * export default [adminModule] as const;
 * ```
 *
 * ```ts
 * // questpie/server/collections/pages.ts
 * import { collection } from "#questpie/factories";
 *
 * export default collection("pages").fields(({ f }) => ({
 *   title: f.text(255).required(),
 *   content: f.richText(),
 *   sections: f.blocks(),
 * }));
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
