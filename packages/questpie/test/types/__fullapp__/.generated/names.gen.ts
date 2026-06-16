/* oxlint-disable */
// FIXTURE leaf layer (L0 names.gen.ts) — mirrors the machine-emitted multi-file
// split (Step 6). Module entity-NAME key registries ONLY: imports `typeof
// _modules` (value) and augments Questpie.<Cat>Keys with the MODULE entity names
// (distributive `keyof`). The emission is GENERIC over every keyed-entity
// category (collections/globals/jobs/routes/services/fieldTypes/views/
// components/blocks/workflows — emails is extractFromModules:false so it gets
// NO module-name half). The USER literal half lives in factories.ts; ambient
// merge composes both. NO AppContext reach (leaf).
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
type _ModuleRoutesKeyNames = (typeof _modules)[number] extends infer M ? M extends { routes: infer C } ? keyof C & string : never : never;
type _ModuleServicesKeyNames = (typeof _modules)[number] extends infer M ? M extends { services: infer C } ? keyof C & string : never : never;
type _ModuleFieldTypesKeyNames = (typeof _modules)[number] extends infer M ? M extends { fieldTypes: infer C } ? keyof C & string : never : never;
type _ModuleViewsKeyNames = (typeof _modules)[number] extends infer M ? M extends { views: infer C } ? keyof C & string : never : never;
type _ModuleComponentsKeyNames = (typeof _modules)[number] extends infer M ? M extends { components: infer C } ? keyof C & string : never : never;
type _ModuleBlocksKeyNames = (typeof _modules)[number] extends infer M ? M extends { blocks: infer C } ? keyof C & string : never : never;
type _ModuleWorkflowsKeyNames = (typeof _modules)[number] extends infer M ? M extends { workflows: infer C } ? keyof C & string : never : never;

declare global {
	namespace Questpie {
		interface CollectionKeys extends Record<_ModuleCollectionsKeyNames, unknown> {}
		interface GlobalKeys extends Record<_ModuleGlobalsKeyNames, unknown> {}
		interface JobKeys extends Record<_ModuleJobsKeyNames, unknown> {}
		interface RouteKeys extends Record<_ModuleRoutesKeyNames, unknown> {}
		interface ServiceKeys extends Record<_ModuleServicesKeyNames, unknown> {}
		interface FieldTypeKeys extends Record<_ModuleFieldTypesKeyNames, unknown> {}
		interface ViewKeys extends Record<_ModuleViewsKeyNames, unknown> {}
		interface ComponentKeys extends Record<_ModuleComponentsKeyNames, unknown> {}
		interface BlockKeys extends Record<_ModuleBlocksKeyNames, unknown> {}
		interface WorkflowKeys extends Record<_ModuleWorkflowsKeyNames, unknown> {}
	}
}
