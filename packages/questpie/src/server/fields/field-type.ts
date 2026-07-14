/**
 * fieldType() — Define a field type with type-specific chain methods.
 *
 * Replaces prototype patching with Proxy-based method wrapping.
 * Each fieldType defines:
 * - `create()`: factory function that returns FieldRuntimeState
 * - `methods`: type-specific chain methods (e.g., pattern, trim for text)
 *
 * The returned factory produces fields wrapped in a Proxy that intercepts
 * method calls and re-wraps after each call to preserve all methods.
 *
 * @module
 */

import type { output, ZodType } from "zod";

import type { FieldRuntimeState, FieldState } from "./field-class-types.js";
import { Field } from "./field-class.js";
import type { FieldWithMethods } from "./field-with-methods.js";

// ============================================================================
// Types
// ============================================================================

/**
 * A registered field type definition.
 */
export interface FieldTypeDefinition<
	TName extends string = string,
	TArgs extends any[] = any[],
	TMethods = {},
	TState extends FieldState = any,
> {
	/** Field type name (e.g., "text", "number", "color") */
	name: TName;
	/** Factory function that creates a configured field */
	factory: (...args: TArgs) => FieldWithMethods<TState, TMethods>;
	/** Type-specific method implementations */
	methods: TMethods;
}

type FieldStateFromRuntime<TState extends FieldRuntimeState> = {
	type: TState["type"];
	data: TState["schemaFactory"] extends () => infer TSchema
		? TSchema extends ZodType
			? output<TSchema>
			: unknown
		: unknown;
	column: TState["columnFactory"] extends (name: string) => infer TColumn
		? TColumn
		: null;
	notNull: TState["notNull"];
	hasDefault: TState["hasDefault"];
	localized: TState["localized"];
	virtual: TState["virtual"] extends false ? false : true;
	input: TState["input"];
	output: TState["output"];
	isArray: TState["isArray"];
	operators: TState["operatorSet"];
};

/**
 * Extension entry for plugin-contributed methods (e.g., .admin(), .form()).
 */
export interface BuilderExtensionEntry {
	stateKey: string;
	resolve: (config: any) => any;
}

// ============================================================================
// wrapFieldComplete — Proxy that preserves all methods across chain
// ============================================================================

/**
 * Wrap a Field instance in a Proxy that intercepts method calls:
 *
 * 1. Type-specific methods (from fieldType().methods) — re-wrap result
 * 2. Extension methods (.admin(), .form()) — re-wrap result
 * 3. Core methods (required, label, etc.) — re-wrap if result is Field
 * 4. Properties — pass through
 *
 * After EVERY method call, the Proxy is re-wrapped with the same
 * registries, so methods are never "lost" across the chain.
 */
export function wrapFieldComplete(
	field: Field<any>,
	typeMethods: Record<
		string,
		(field: Field<any>, ...args: any[]) => Field<any>
	>,
	extensions: Record<string, BuilderExtensionEntry>,
): Field<any> {
	return new Proxy(field, {
		get(target, prop) {
			if (typeof prop !== "string") return Reflect.get(target, prop);

			// 1. Type-specific method (pattern, trim, hasMany, ...)
			if (prop in typeMethods) {
				return (...args: any[]) =>
					wrapFieldComplete(
						typeMethods[prop](target, ...args),
						typeMethods,
						extensions,
					);
			}

			// 2. Extension method (admin, form, ...)
			if (prop in extensions) {
				const ext = extensions[prop];
				return (config: any) =>
					wrapFieldComplete(
						target.set(ext.stateKey, ext.resolve(config)),
						typeMethods,
						extensions,
					);
			}

			// 3. Core method or property
			const val = Reflect.get(target, prop);
			if (typeof val === "function") {
				return (...args: any[]) => {
					const result = val.apply(target, args);
					// If result is a Field, re-wrap to preserve methods
					return result instanceof Field
						? wrapFieldComplete(result, typeMethods, extensions)
						: result;
				};
			}

			return val;
		},
	}) as Field<any>;
}

// ============================================================================
// fieldType() — Define a new field type
// ============================================================================

/**
 * Define a new field type with type-specific chain methods.
 *
 * @example
 * ```ts
 * const textFieldType = fieldType("text", {
 *   create: (maxLength = 255) => ({
 *     type: "text",
 *     columnFactory: (name) => varchar(name, { length: maxLength }),
 *     schemaFactory: () => z.string().max(maxLength),
 *     operatorSet: stringColumnOperators,
 *     // ... defaults
 *   }),
 *   methods: {
 *     pattern: (field, re: RegExp) => field.derive({ pattern: re }),
 *     trim: (field) => field.derive({ trim: true }),
 *   },
 * });
 * ```
 */
export function fieldType<
	TName extends string,
	TArgs extends any[],
	TState extends FieldRuntimeState,
	TMethods extends Record<
		string,
		(field: Field<any>, ...args: any[]) => Field<any>
	>,
>(
	name: TName,
	config: {
		/** Factory function that creates FieldRuntimeState from arguments */
		create: (...args: TArgs) => TState;
		/** Type-specific chain methods */
		methods?: TMethods;
	},
): FieldTypeDefinition<TName, TArgs, TMethods, FieldStateFromRuntime<TState>> {
	const methods = config.methods ?? ({} as TMethods);

	return Object.freeze({
		name,
		factory: (...args: TArgs) => {
			const state = config.create(...args);
			const field = new Field(state);
			const wrapped =
				Object.keys(methods).length === 0
					? field
					: wrapFieldComplete(field, methods, {});
			return wrapped as FieldWithMethods<
				FieldStateFromRuntime<TState>,
				TMethods
			>;
		},
		methods,
	});
}
