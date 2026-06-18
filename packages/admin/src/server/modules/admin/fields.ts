/**
 * Admin module field types.
 * Re-exports the admin field factories so codegen discovers them
 * via the standard `fields.ts` file convention and augments
 * Questpie.FieldTypesMap (mirrors the starter module's fields.ts).
 */
export { adminFields as default } from "../../fields/index.js";
