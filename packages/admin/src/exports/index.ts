/**
 * @questpie/admin - Main Entry Point
 *
 * Re-exports the most commonly used items from client.
 * For server-side functionality, use "@questpie/admin/server".
 *
 * @example
 * ```ts
 * import { qa, adminModule } from "@questpie/admin";
 *
 * const admin = qa()
 *   .use(adminModule)
 *   .collections({ posts: postsAdmin });
 * ```
 */

// Module augmentation for questpie package (must be imported for d.ts generation)
import "../augmentation.js";

// Re-export admin meta types for consumers
export type {
  AnyAdminMeta,
  ArrayFieldAdminMeta,
  BaseAdminMeta,
  BooleanFieldAdminMeta,
  DateFieldAdminMeta,
  JsonFieldAdminMeta,
  NumberFieldAdminMeta,
  ObjectFieldAdminMeta,
  RelationFieldAdminMeta,
  SelectFieldAdminMeta,
  TextareaFieldAdminMeta,
  TextFieldAdminMeta,
  TimeFieldAdminMeta,
  UploadFieldAdminMeta,
} from "../augmentation.js";

// Re-export everything from client
export * from "./client.js";
