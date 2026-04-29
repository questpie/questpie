/**
 * FieldWithMethods — type-level wrapper that preserves type-specific methods.
 *
 * When a field type defines methods (e.g., text has .pattern(), .trim()),
 * these methods must survive common operations like .required(), .label(), etc.
 *
 * FieldWithMethods wraps the common method return types to re-attach TMethods,
 * ensuring the full method set is always available regardless of chain order.
 *
 * Proven in QUE-247 PoC: tsdown .d.ts emit preserves these mapped types.
 *
 * @module
 */

import type { SQL } from "drizzle-orm";
import type { HasDefault, NotNull } from "drizzle-orm/column-builder";
import type { ZodType } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { ArrayFieldState, FieldState } from "./field-class-types.js";
import type { Field } from "./field-class.js";
import type { OperatorSetDefinition } from "./operators/types.js";
import type { FieldAccess, FieldHooks, ReferentialAction } from "./types.js";

// ============================================================================
// FieldCommonMethods — source of truth for common method signatures
// ============================================================================

/**
 * Explicit interface describing every common method on Field.
 * The Field class implements these; FieldWithMethods maps over them.
 *
 * Extensions (e.g., admin module) augment this interface to add
 * .admin(), .form() etc. The mapped type picks them up automatically.
 */
export interface FieldCommonMethods<TState extends FieldState> {
	required(): Field<
		Omit<TState, "notNull" | "column"> & {
			notNull: true;
			column: NotNull<TState["column"]>;
		}
	>;
	default<V>(value: V | (() => V)): Field<
		Omit<TState, "hasDefault" | "column"> & {
			hasDefault: true;
			column: HasDefault<TState["column"]>;
		}
	>;
	label(l: I18nText): Field<TState & { label: I18nText }>;
	description(d: I18nText): Field<TState & { description: I18nText }>;
	localized(): Field<Omit<TState, "localized"> & { localized: true }>;
	inputFalse(): Field<Omit<TState, "input"> & { input: false }>;
	inputOptional(): Field<Omit<TState, "input"> & { input: "optional" }>;
	inputTrue(): Field<Omit<TState, "input"> & { input: true }>;
	outputFalse(): Field<Omit<TState, "output"> & { output: false }>;
	virtual(
		expr?: SQL,
	): Field<
		Omit<TState, "virtual" | "column"> & { virtual: true; column: null }
	>;
	hooks<H extends FieldHooks>(h: H): Field<TState & { hooks: H }>;
	access(a: FieldAccess): Field<TState & { access: FieldAccess }>;
	array(): Field<ArrayFieldState<TState>>;
	operators<TOps extends OperatorSetDefinition>(
		ops: TOps,
	): Field<TState & { operators: TOps }>;
	drizzle<TNewCol>(
		fn: (col: TState["column"]) => TNewCol,
	): Field<TState & { column: TNewCol }>;
	zod(fn: (schema: ZodType) => ZodType): Field<TState>;
	fromDb(fn: (value: unknown) => unknown): Field<TState>;
	toDb(fn: (value: unknown) => unknown): Field<TState>;
	minItems(n: number): Field<TState>;
	maxItems(n: number): Field<TState>;
}

// ============================================================================
// FieldWithMethods — mapped wrapper type
// ============================================================================

/**
 * Wrapper type that adds type-specific methods to Field and preserves
 * them across all common method chains.
 *
 * How it works:
 * 1. Re-maps each common method: if it returns Field<R>, return FieldWithMethods<R, TMethods>
 * 2. Re-maps each TMethods method: always returns FieldWithMethods<TState, TMethods>
 *    (type-specific methods don't change TState — they use derive() at runtime)
 * 3. Intersects with Field<TState> for runtime accessors (getType, toColumn, etc.)
 *
 * @template TState - Accumulated type state
 * @template TMethods - Type-specific methods interface (e.g., TextMethods)
 */
export type FieldWithMethods<TState extends FieldState, TMethods> =
	// Method override maps must come BEFORE Field<TState> in the intersection.
	// TypeScript resolves method calls on intersections using the FIRST matching
	// overload, so placing the override maps first ensures the re-wrapped return
	// types are used rather than Field<TState>'s own return types.
	{
		// Re-wrap common methods: preserve TMethods across chain
		[K in keyof FieldCommonMethods<TState>]: FieldCommonMethods<TState>[K] extends (
			...args: infer A
		) => Field<infer R extends FieldState>
			? (...args: A) => FieldWithMethods<R, TMethods>
			: FieldCommonMethods<TState>[K];
	} & {
		// Re-wrap type-specific methods: return FieldWithMethods<TState, TMethods>
		[K in keyof TMethods]: TMethods[K] extends (...args: infer A) => any
			? (...args: A) => FieldWithMethods<TState, TMethods>
			: TMethods[K];
	} & Field<TState>;
