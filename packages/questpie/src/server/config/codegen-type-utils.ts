/**
 * Codegen Type Utilities
 *
 * Type-level helpers used by generated code (.generated/index.ts, .generated/factories.ts).
 * Moved out of codegen string templates into a proper TS file so they can be imported
 * instead of emitted inline.
 *
 * @see QUE-163 — Codegen Simplification
 */

import type {
	ServiceInstanceOf,
	ServiceNamespace,
	ServiceNamespaceOf,
} from "#questpie/server/services/define-service.js";

import type { Registry } from "./app-context.js";

/**
 * Convert a union type to an intersection type.
 *
 * Used in generated index.ts to merge module property types:
 * `_U2I<ModuleUnion extends ... ? V : never>` collapses into an intersection.
 */
export type UnionToIntersection<U> = (
	U extends any ? (x: U) => void : never
) extends (x: infer I) => void
	? I
	: never;

/**
 * Extract a property type from the Registry interface by key.
 *
 * Used in generated factories.ts to derive view/component type aliases
 * from the globally augmented Registry without importing modules directly.
 */
export type RegistryProp<K extends string> =
	Registry extends Record<K, infer V> ? V : Record<string, unknown>;

/**
 * Recursively extract a named property from a module tree.
 *
 * A module may have direct `M[K]` properties and nested `M["modules"]` sub-modules.
 * This type intersects them all, giving a flat merged record of all contributions
 * at every nesting level.
 *
 * Used in generated code to derive `_AllFieldTypes` and `_AllModule*` types.
 */
export type ExtractModuleProp<M, K extends string> = (M extends {
	modules: infer Sub extends readonly any[];
}
	? ExtractModulePropArr<Sub, K>
	: {}) &
	(K extends keyof M ? (M[K] extends Record<string, any> ? M[K] : {}) : {});

/**
 * Array companion for ExtractModuleProp — recurses over a readonly tuple of modules.
 */
export type ExtractModulePropArr<
	A extends readonly any[],
	K extends string,
> = A extends readonly [infer H, ...infer T extends readonly any[]]
	? ExtractModuleProp<H, K> & ExtractModulePropArr<T, K>
	: {};

/**
 * Merge a named property from all modules in a tuple.
 *
 * Alias for `ExtractModulePropArr` with a cleaner name for generated code.
 * Used by codegen to derive merged types:
 *
 * ```ts
 * type AllCollections = MergeModuleProp<typeof _modulesArr, "collections">;
 * type AllJobs = MergeModuleProp<typeof _modulesArr, "jobs">;
 * ```
 */
export type MergeModuleProp<
	TModules extends readonly any[],
	K extends string,
> = ExtractModulePropArr<TModules, K>;

/**
 * Normalize a service namespace to its runtime placement namespace.
 *
 * - `undefined` and `"services"` are both default namespace (`services.*`)
 * - `null` is top-level
 * - any other string is custom namespace (`ctx.<namespace>.<name>`)
 */
export type NormalizeServiceNamespace<TNamespace> = TNamespace extends
	| undefined
	| "services"
	? "services"
	: TNamespace extends ServiceNamespace
		? TNamespace
		: "services";

/**
 * Extract service definitions that belong to a specific namespace.
 */
export type ServiceDefinitionsInNamespace<
	TServices,
	TNamespace extends string | null,
> = {
	[K in keyof TServices as NormalizeServiceNamespace<
		ServiceNamespaceOf<TServices[K]>
	> extends TNamespace
		? K
		: never]: TServices[K];
};

/**
 * Convert service definitions in a namespace into instance types.
 */
export type ServiceInstancesInNamespace<
	TServices,
	TNamespace extends string | null,
> = {
	[K in keyof ServiceDefinitionsInNamespace<
		TServices,
		TNamespace
	>]: ServiceInstanceOf<
		ServiceDefinitionsInNamespace<TServices, TNamespace>[K]
	>;
};

/**
 * Top-level namespace (`namespace: null`) service instances keyed by service name.
 */
export type ServiceTopLevelInstances<TServices> = ServiceInstancesInNamespace<
	TServices,
	null
>;

type NarrowString<T> = [T] extends [string]
	? [string] extends [T]
		? never
		: T
	: never;

type CustomServiceNamespaceNames<TServices> = Exclude<
	NarrowString<
		NormalizeServiceNamespace<ServiceNamespaceOf<TServices[keyof TServices]>>
	>,
	"services"
>;

/**
 * Custom namespace map: `{ analytics: { tracker: Tracker } }`.
 */
export type ServiceCustomNamespaceInstances<TServices> = {
	[TNamespace in CustomServiceNamespaceNames<TServices>]: ServiceInstancesInNamespace<
		TServices,
		TNamespace
	>;
};
