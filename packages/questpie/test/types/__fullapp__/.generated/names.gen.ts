/* oxlint-disable */
// FIXTURE leaf layer (L0 names.gen.ts) — mirrors the machine-emitted multi-file
// split (Step 6). Module entity-NAME key registries ONLY: imports `typeof
// _modules` (value) and augments Questpie.CollectionKeys/GlobalKeys/JobKeys with
// the MODULE entity names (distributive `keyof`). The USER literal half lives in
// factories.ts; ambient merge composes both. NO AppContext reach (leaf).
//
// This file lives in the `.generated` dot-folder, so it is imported for
// side-effect by index.ts/entities.gen.ts to join the program (the type-test
// imports index.ts → loads this ambient augmentation).

// ── Modules ────────────────────────────────────────────────
import _modules from "../modules.js";

// ── Module entity-name key sets (distributive `keyof`) ─────
type _ModuleCollectionsKeyNames = (typeof _modules)[number] extends infer M ? M extends { collections: infer C } ? keyof C & string : never : never;
type _ModuleGlobalsKeyNames = (typeof _modules)[number] extends infer M ? M extends { globals: infer C } ? keyof C & string : never : never;
type _ModuleJobsKeyNames = (typeof _modules)[number] extends infer M ? M extends { jobs: infer C } ? keyof C & string : never : never;

declare global {
	namespace Questpie {
		interface CollectionKeys extends Record<_ModuleCollectionsKeyNames, unknown> {}
		interface GlobalKeys extends Record<_ModuleGlobalsKeyNames, unknown> {}
		interface JobKeys extends Record<_ModuleJobsKeyNames, unknown> {}
	}
}
