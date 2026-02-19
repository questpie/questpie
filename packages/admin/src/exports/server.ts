/**
 * @questpie/admin/server - Server-Side Admin Module
 *
 * Server-side exports for the admin panel backend.
 * Use this when setting up your app with adminModule.
 *
 * @example
 * ```ts
 * import { q } from "questpie";
 * import { adminModule } from "@questpie/admin/server";
 *
 * const app = q({ name: "my-app" })
 *   .use(adminModule)
 *   .build({ db: { url: process.env.DATABASE_URL } });
 * ```
 */

// Re-export everything from server index
export * from "#questpie/admin/server/index.js";
