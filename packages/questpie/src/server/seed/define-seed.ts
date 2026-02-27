import type { Seed } from "./types.js";

/**
 * Define a seed using the file-convention format.
 * Seeds placed in `seeds/*.ts` are auto-discovered by codegen.
 *
 * The `run` and `undo` handlers receive a fully-typed `SeedContext` that
 * extends `AppContext` — same flat access to `db`, `collections`, `globals`,
 * `queue`, `email`, etc. as function and job handlers. Types are auto-resolved
 * via `declare module "questpie"` in the generated `.generated/index.ts`.
 *
 * The `app` property provides the typed Questpie instance — useful for
 * locale-specific context creation (`app.createContext({ locale: "sk" })`).
 *
 * @example
 * ```ts
 * import { seed } from "questpie";
 *
 * export default seed({
 *   id: "siteSettings",
 *   category: "required",
 *   async run({ globals, createContext, log }) {
 *     log("Seeding site settings...");
 *     await globals.siteSettings.update({ shopName: "My Shop" });
 *
 *     // Locale-specific update:
 *     const ctxSk = await createContext({ locale: "sk" });
 *     await globals.siteSettings.update({ shopName: "Môj obchod" }, ctxSk);
 *   },
 * });
 * ```
 */
export function seed(def: Seed): Seed {
	return def;
}
