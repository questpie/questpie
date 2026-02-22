// Introspection API
export {
	type AdminFormViewSchema as AdminGlobalFormViewSchema,
	type AdminGlobalSchema,
	type GlobalAccessInfo,
	type GlobalAccessResult,
	type GlobalFieldAccessInfo,
	type GlobalFieldSchema,
	type GlobalSchema,
	introspectGlobal,
	introspectGlobals,
} from "../introspection.js";
// Extension types for module augmentation
export type {
	GlobalBuilderExtensions,
	GlobalFieldsOf,
	GlobalStateOf,
} from "./extensions.js";
export * from "./global.js";
export * from "./global-builder.js";
export * from "./types.js";
