import type {
	SeedFactory,
	SimpleSeed,
	StepSeed,
	StepSeedInput,
} from "./types.js";

/**
 * Define a seed using the file-convention format.
 * Seeds placed in `seeds/*.ts` are auto-discovered by codegen.
 *
 * The `run` and `undo` handlers receive a fully-typed `SeedContext` that
 * extends `AppContext` — same flat access to `db`, `collections`, `globals`,
 * `queue`, `email`, etc. as function and job handlers. Types are auto-resolved
 * via `declare module "questpie"` in the generated `.generated/index.ts`.
 *
 * CRUD methods accept partial request context overrides directly. They inherit
 * the active seed transaction, access mode, and session.
 *
 * @example
 * ```ts
 * import { seed } from "questpie";
 *
 * export default seed({
 *   id: "siteSettings",
 *   category: "required",
 *   async run({ globals, log }) {
 *     log("Seeding site settings...");
 *     await globals.siteSettings.update({ shopName: "My Shop" });
 *
 *     // Locale-specific update:
 *     await globals.siteSettings.update(
 *       { shopName: "Môj obchod" },
 *       { locale: "sk" },
 *     );
 *   },
 * });
 * ```
 */
function defineSeed(def: SimpleSeed): SimpleSeed {
	return def;
}

defineSeed.steps = function steps(def: StepSeedInput): StepSeed {
	return {
		...def,
		"~kind": "steps",
	};
};

export const seed = defineSeed as SeedFactory;
