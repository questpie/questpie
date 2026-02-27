/**
 * @questpie/admin/server - Server-Side Admin Module
 *
 * Server-side exports for the admin panel backend.
 *
 * @example
 * ```ts
 * import { runtimeConfig } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * // adminModule is imported by codegen-generated modules.ts
 * export default runtimeConfig({
 *   db: { url: process.env.DATABASE_URL },
 * });
 * ```
 */

// Re-export everything from server index
export * from "#questpie/admin/server/index.js";
