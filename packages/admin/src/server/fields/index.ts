/**
 * Admin Field Types
 *
 * Additional field types provided by the admin module.
 * These fields are registered automatically when adminModule is used.
 *
 * @example
 * ```ts
 * import { q } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const cms = q({ name: "my-cms" })
 *   .use(adminModule)  // Registers richText and blocks fields
 *   .collections({
 *     pages: q.collection("pages").fields((f) => ({
 *       title: f.text({ required: true }),
 *       content: f.richText({ features: ["bold", "italic", "link"] }),
 *       sections: f.blocks({ allowedBlocks: ["hero", "text"] }),
 *     })),
 *   });
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
export { type BlocksFieldConfig, blocksField } from "./blocks.js";
export type {
  RichTextFeature,
  RichTextFieldMeta,
  TipTapDocument,
  TipTapNode,
} from "./rich-text.js";
export { type RichTextFieldConfig, richTextField } from "./rich-text.js";

// Import for adminFields record
import { blocksField } from "./blocks.js";
import { richTextField } from "./rich-text.js";

/**
 * Admin field types to be registered with the field registry.
 * These are automatically registered when adminModule is used.
 */
export const adminFields = {
  richText: richTextField,
  blocks: blocksField,
} as const;
