/**
 * Lightweight entry point for the admin codegen plugin.
 *
 * Import `adminPlugin` from this path in `questpie.config.ts` to avoid
 * pulling in the full `@questpie/admin/server` barrel (which has heavy
 * dependencies like drizzle-orm that may not be installed at codegen time).
 *
 * @example
 * ```ts
 * import { runtimeConfig } from "questpie";
 * import { adminPlugin } from "@questpie/admin/plugin";
 *
 * export default runtimeConfig({
 *   plugins: [adminPlugin()],
 *   db: { url: process.env.DATABASE_URL! },
 * });
 * ```
 */
export { adminPlugin } from "../server/plugin.js";
