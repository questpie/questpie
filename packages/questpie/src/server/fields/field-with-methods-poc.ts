/**
 * PoC: FieldWithMethods — tsdown .d.ts emit test (QUE-247)
 *
 * This file tests whether tsdown can emit usable .d.ts declarations for
 * the planned FieldWithMethods mapped wrapper type.
 *
 * Key concern: complex mapped types with conditional re-wrapping have
 * previously collapsed to `{}` in tsdown declaration emit.
 */

import type { HasDefault, NotNull } from "drizzle-orm/column-builder";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { FieldState } from "./field-class-types.js";
import type { OperatorSetDefinition } from "./operators/types.js";
import type { FieldAccess, FieldHooks, ReferentialAction } from "./types.js";

// ============================================================================
// 1. FieldCommonMethods — source of truth for common method signatures
// ============================================================================

/**
 * Explicit interface describing every common method on Field.
 * The Field class implements this; FieldWithMethods maps over it.
 */
export interface FieldCommonMethods<TState extends FieldState> {
	required(): PocField<
		Omit<TState, "notNull" | "column"> & {
			notNull: true;
			column: NotNull<TState["column"]>;
		}
	>;
	default<V>(
		value: V | (() => V),
	): PocField<
		Omit<TState, "hasDefault" | "column"> & {
			hasDefault: true;
			column: HasDefault<TState["column"]>;
		}
	>;
	label(l: I18nText): PocField<TState & { label: I18nText }>;
	description(d: I18nText): PocField<TState & { description: I18nText }>;
	localized(): PocField<Omit<TState, "localized"> & { localized: true }>;
	inputFalse(): PocField<Omit<TState, "input"> & { input: false }>;
	inputOptional(): PocField<Omit<TState, "input"> & { input: "optional" }>;
	outputFalse(): PocField<Omit<TState, "output"> & { output: false }>;
	virtual(): PocField<
		Omit<TState, "virtual" | "column"> & { virtual: true; column: null }
	>;
	hooks<H extends FieldHooks>(h: H): PocField<TState & { hooks: H }>;
	access(a: FieldAccess): PocField<TState & { access: FieldAccess }>;
	array(): PocField<{
		type: TState["type"];
		data: TState["data"][];
		column: unknown;
		notNull: false;
		hasDefault: false;
		localized: TState["localized"];
		virtual: false;
		input: TState["input"];
		output: TState["output"];
		isArray: true;
		operators: OperatorSetDefinition;
	}>;
	operators<TOps extends OperatorSetDefinition>(
		ops: TOps,
	): PocField<TState & { operators: TOps }>;
	drizzle<TNewCol>(
		fn: (col: TState["column"]) => TNewCol,
	): PocField<TState & { column: TNewCol }>;
	zod(fn: (schema: unknown) => unknown): PocField<TState>;
	fromDb(fn: (value: unknown) => unknown): PocField<TState>;
	toDb(fn: (value: unknown) => unknown): PocField<TState>;
}

// ============================================================================
// 2. PocField — minimal field class for testing
// ============================================================================

/**
 * Minimal field stub — just enough to test .d.ts emit.
 */
export class PocField<TState extends FieldState = FieldState> {
	declare readonly _: TState;
	readonly _state: Readonly<Record<string, unknown>>;

	constructor(state: Record<string, unknown>) {
		this._state = Object.freeze({ ...state });
	}

	getType(): string {
		return String(this._state.type);
	}
}

// ============================================================================
// 3. FieldWithMethods — the mapped wrapper type
// ============================================================================

/**
 * Wrapper type that adds type-specific methods to PocField.
 * Each common method's return type is re-wrapped to preserve TMethods.
 *
 * THIS is the critical type for .d.ts emit testing.
 */
export type FieldWithMethods<
	TState extends FieldState,
	TMethods,
> = PocField<TState> & {
	// Re-wrap common methods: preserve TMethods across chain
	[K in keyof FieldCommonMethods<TState>]: FieldCommonMethods<TState>[K] extends (
		...args: infer A
	) => PocField<infer R extends FieldState>
		? (...args: A) => FieldWithMethods<R, TMethods>
		: FieldCommonMethods<TState>[K];
} & {
	// Re-wrap type-specific methods: return FieldWithMethods<TState, TMethods>
	// (type-specific methods don't change TState — they use derive() at runtime)
	[K in keyof TMethods]: TMethods[K] extends (
		...args: infer A
	) => any
		? (...args: A) => FieldWithMethods<TState, TMethods>
		: TMethods[K];
};

// ============================================================================
// 4. FieldDeriveExtra — restricted patch for user-land methods
// ============================================================================

export type FieldDeriveExtra = Omit<
	Partial<Record<string, unknown>>,
	"type" | "columnFactory" | "schemaFactory" | "operatorSet"
>;

// ============================================================================
// 5. fieldType() factory — creates field factories with type-specific methods
// ============================================================================

/**
 * Define a new field type with type-specific chain methods.
 */
export function fieldType<
	TName extends string,
	TState extends FieldState,
	TMethods,
>(
	name: TName,
	config: {
		create: () => Record<string, unknown>;
		methods?: TMethods;
	},
): {
	name: TName;
	factory: () => FieldWithMethods<TState, TMethods>;
	methods: TMethods;
} {
	return {
		name,
		factory: () => {
			return new PocField(config.create()) as any;
		},
		methods: config.methods ?? ({} as TMethods),
	};
}

// ============================================================================
// 6. Test field type definitions — simulate text() and number()
// ============================================================================

// --- Text field type ---

export interface TextFieldState extends FieldState {
	type: "text";
	data: string;
}

export interface TextMethods {
	pattern(re: RegExp): any;
	trim(): any;
	lowercase(): any;
	uppercase(): any;
	min(n: number): any;
	max(n: number): any;
}

export const pocTextField = fieldType<"text", TextFieldState, TextMethods>(
	"text",
	{
		create: () => ({
			type: "text",
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
		}),
		methods: {
			pattern: (_re: RegExp) => null as any,
			trim: () => null as any,
			lowercase: () => null as any,
			uppercase: () => null as any,
			min: (_n: number) => null as any,
			max: (_n: number) => null as any,
		},
	},
);

// --- Number field type ---

export interface NumberFieldState extends FieldState {
	type: "number";
	data: number;
}

export interface NumberMethods {
	min(n: number): any;
	max(n: number): any;
	positive(): any;
	int(): any;
	step(n: number): any;
}

export const pocNumberField = fieldType<
	"number",
	NumberFieldState,
	NumberMethods
>("number", {
	create: () => ({
		type: "number",
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}),
	methods: {
		min: (_n: number) => null as any,
		max: (_n: number) => null as any,
		positive: () => null as any,
		int: () => null as any,
		step: (_n: number) => null as any,
	},
});

// ============================================================================
// 7. Usage simulation — these must type-check AND survive .d.ts emit
// ============================================================================

/**
 * Simulate consumer code that chains methods.
 * If .d.ts emit works, external consumers can do the same.
 */
export function pocUsageTest() {
	const t = pocTextField.factory();

	// Type-specific method
	const t1 = t.pattern(/^[A-Z]/);

	// Common method preserves type-specific methods
	const t2 = t.required();
	const t3 = t2.pattern(/^[A-Z]/); // MUST work — TMethods preserved

	// Chain mix
	const t4 = t.label({ en: "Name" }).required().pattern(/^[A-Z]/).trim();

	// Number field — different methods
	const n = pocNumberField.factory();
	const n1 = n.min(0).max(100).int();
	const n2 = n.required().positive();

	return { t1, t2, t3, t4, n1, n2 };
}

// ============================================================================
// 8. Extension augmentation test — simulates admin .admin() extension
// ============================================================================

/**
 * Augment FieldCommonMethods to add .admin() — simulates how
 * the admin module adds extensions.
 */
declare module "./field-with-methods-poc.js" {
	interface FieldCommonMethods<TState extends FieldState> {
		admin(config: { hidden?: boolean; readOnly?: boolean }): PocField<TState>;
	}
}

/**
 * Test that augmented methods also survive the mapped type.
 */
export function pocAugmentationTest() {
	const t = pocTextField.factory();

	// Extension method via augmentation
	const t1 = t.admin({ hidden: true });

	// Chain: type-specific + extension
	const t2 = t.pattern(/x/).required().admin({ readOnly: true });

	return { t1, t2 };
}
