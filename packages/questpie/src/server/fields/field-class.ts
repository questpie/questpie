/**
 * Field Builder — Core Field Class
 *
 * Immutable builder class where each method returns a new Field
 * with updated type state via intersections.
 *
 * ```ts
 * f.text(255).required().label({ en: "Name" })
 * ```
 *
 * Type state grows monotonically:
 * - Field<{ type: "text", data: string, notNull: false, ... }>
 * - .required() → Field<{ ... } & { notNull: true }>
 * - .default("") → Field<{ ... } & { hasDefault: true }>
 */

import type { SQL } from "drizzle-orm";
import type { HasDefault, NotNull } from "drizzle-orm/column-builder";
import { jsonb } from "drizzle-orm/pg-core";
import { type ZodType, z } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import { buildZodFromState } from "./derive-schema.js";
import type {
	ArrayFieldState,
	CrdtFieldConfig,
	FieldRuntimeState,
	FieldState,
} from "./field-class-types.js";
import type { FieldWithMethods } from "./field-with-methods.js";
import { selectMultiOps } from "./operators/builtin.js";
import { resolveContextualOperators } from "./operators/resolve.js";
import type { OperatorSetDefinition } from "./operators/types.js";
import type {
	ContextualOperators,
	FieldAccess,
	FieldHooks,
	FieldLocation,
	FieldMetadata,
	FieldMetadataBase,
} from "./types.js";

// ============================================================================
// Field Class
// ============================================================================

/**
 * Immutable field builder.
 *
 * Each method returns a new Field instance with updated type state.
 * The `TState` generic accumulates properties through intersection.
 *
 * @template TState - Accumulated type state (grows via intersection at each step)
 * @template TMethods - Type-specific methods contributed by the field type
 *
 * VARIANCE — declared, never inferred, and not interchangeable:
 * `out TState` is what lets `_clone<TExtra>` keep its own type parameter and
 * what keeps `Field<BooleanFieldState>` assignable to `Field<FieldState>` (the
 * constraint on every collection's `fields()`). Bare fails TS2322 on the four
 * `Omit`-returning methods; `in out` fails the `Record<string, Field<FieldState>>`
 * constraint in every example app. `in out TMethods` is forced — the wrapper map
 * takes `keyof TMethods`, which makes it invariant, and `out` is TS2636 here.
 * See field-with-methods.ts for the full argument.
 */
export class Field<
	out TState extends FieldState = FieldState,
	in out TMethods = {},
> {
	/**
	 * Phantom type property for type-level state access.
	 * Not used at runtime — provides the TState type to type extractors.
	 */
	declare readonly _: TState;

	/** Internal runtime state — frozen, immutable */
	readonly _state: Readonly<FieldRuntimeState>;

	/**
	 * Create a new Field. Use factory functions (text(), number(), etc.)
	 * instead of calling this directly.
	 */
	constructor(state: FieldRuntimeState) {
		this._state = Object.freeze({ ...state });
	}

	// ========================================================================
	// Immutable Clone
	// ========================================================================

	/**
	 * Create a new Field with merged state.
	 * Each builder method calls this to produce an immutable copy.
	 */
	private _clone<TExtra>(
		extra: Partial<FieldRuntimeState>,
	): FieldWithMethods<TState & TExtra, TMethods> {
		return new Field({
			...this._state,
			...extra,
		}) as unknown as FieldWithMethods<TState & TExtra, TMethods>;
	}

	// ========================================================================
	// Builder Methods — Common
	// ========================================================================

	/** Mark field as NOT NULL (required). */
	required(): FieldWithMethods<
		Omit<TState, "notNull" | "column"> & {
			notNull: true;
			column: NotNull<TState["column"]>;
		},
		TMethods
	> {
		return new Field({ ...this._state, notNull: true }) as any;
	}

	/**
	 * Set a default value. Makes input optional.
	 *
	 * The value is constrained to the field's data type (Drizzle-identical):
	 * `f.boolean().default(true)` compiles, `f.boolean().default("yes")` does not.
	 * Accepts a literal value, a factory, or a raw SQL expression.
	 * For column-level SQL defaults use `.drizzle((c) => c.default(...))`.
	 */
	default(
		value: TState["data"] | (() => TState["data"]) | SQL,
	): FieldWithMethods<
		Omit<TState, "hasDefault" | "column"> & {
			hasDefault: true;
			column: HasDefault<TState["column"]>;
		},
		TMethods
	> {
		return new Field({
			...this._state,
			hasDefault: true,
			defaultValue: value,
		}) as any;
	}

	/** Set display label. */
	label(l: I18nText): FieldWithMethods<TState & { label: I18nText }, TMethods> {
		return this._clone<{ label: I18nText }>({ label: l });
	}

	/** Set description / help text. */
	description(
		d: I18nText,
	): FieldWithMethods<TState & { description: I18nText }, TMethods> {
		return this._clone<{ description: I18nText }>({ description: d });
	}

	/** Mark field as localized (stored in i18n table). */
	localized(): FieldWithMethods<
		Omit<TState, "localized"> & { localized: true },
		TMethods
	> {
		return new Field({ ...this._state, localized: true }) as any;
	}

	/** Exclude field from input (read-only). */
	inputFalse(): FieldWithMethods<
		Omit<TState, "input"> & { input: false },
		TMethods
	> {
		return this._clone<{ input: false }>({ input: false });
	}

	/** Make input always optional (even if field is NOT NULL). */
	inputOptional(): FieldWithMethods<
		Omit<TState, "input"> & { input: "optional" },
		TMethods
	> {
		return this._clone<{ input: "optional" }>({ input: "optional" });
	}

	/** Force field into input (even if virtual). */
	inputTrue(): FieldWithMethods<
		Omit<TState, "input"> & { input: true },
		TMethods
	> {
		return this._clone<{ input: true }>({ input: true });
	}

	/** Exclude field from output (write-only). */
	outputFalse(): FieldWithMethods<
		Omit<TState, "output"> & { output: false },
		TMethods
	> {
		return this._clone<{ output: false }>({ output: false });
	}

	/**
	 * Mark field as virtual (no DB column).
	 * Optionally provide a SQL expression for computed columns.
	 */
	virtual(
		expr?: SQL,
	): FieldWithMethods<
		Omit<TState, "virtual" | "column"> & { virtual: true; column: null },
		TMethods
	> {
		return new Field({ ...this._state, virtual: expr ?? true }) as any;
	}

	/** Set field-level hooks. Hook values are typed to the field's data type. */
	hooks<H extends FieldHooks<TState["data"]>>(
		h: H,
	): FieldWithMethods<TState & { hooks: H }, TMethods> {
		return this._clone<{ hooks: H }>({ hooks: h as FieldHooks });
	}

	/** Set field-level access control. */
	access(
		a: FieldAccess,
	): FieldWithMethods<TState & { access: FieldAccess }, TMethods> {
		return this._clone<{ access: FieldAccess }>({ access: a });
	}

	/** Mark this field with a framework-owned CRDT merge strategy. */
	crdt<const TConfig extends CrdtFieldConfig>(
		config: TConfig,
	): FieldWithMethods<TState & { crdt: TConfig }, TMethods> {
		return this._clone<{ crdt: TConfig }>({
			crdt: { ...config },
		});
	}

	/**
	 * Wrap this field in an array (stored as JSONB).
	 * The inner field's type becomes the element type.
	 */
	array(): FieldWithMethods<ArrayFieldState<TState>, TMethods> {
		return new Field({
			...this._state,
			isArray: true,
			innerField: this,
			// Array fields use jsonb column
			columnFactory: (name: string) => jsonb(name),
			// Override operator set for array
			operatorSet: selectMultiOps,
		}) as unknown as FieldWithMethods<ArrayFieldState<TState>, TMethods>;
	}

	/**
	 * Override the operator set for this field.
	 */
	operators<TOps extends OperatorSetDefinition>(
		ops: TOps,
	): FieldWithMethods<TState & { operators: TOps }, TMethods> {
		return this._clone<{ operators: TOps }>({ operatorSet: ops });
	}

	/**
	 * Escape hatch: modify the underlying Drizzle column builder.
	 * The transform receives the column builder and returns a (possibly different) one.
	 *
	 * `.drizzle()` replaces the column and leaves the field's `data` alone.
	 * To change the value type use `.$type<T>()` (type-level) or `.zod()`
	 * (type + validation).
	 */
	drizzle<TNewCol>(fn: (col: TState["column"]) => TNewCol): FieldWithMethods<
		Omit<TState, "column" | "data"> & {
			column: TNewCol;
			data: TState["data"];
		},
		TMethods
	> {
		return this._clone({ drizzleTransform: fn as any }) as any;
	}

	/**
	 * Escape hatch: modify the auto-derived Zod schema.
	 * Applied after auto-derivation when toZodSchema() is called.
	 *
	 * The returned schema's output type propagates to the field's `data`
	 * type (and therefore select/insert types). Returning a plain `ZodType`
	 * (output `unknown`) leaves the field's existing `data` in place.
	 *
	 * @example
	 * ```ts
	 * // Refine validation without changing the type
	 * slug: f.text().zod((s) => s.refine(isKebabCase, "must be kebab-case"))
	 *
	 * // Replace the schema — field value type narrows to the schema output
	 * settings: f.json().zod(() => z.object({ theme: z.enum(["light", "dark"]) }))
	 * ```
	 */
	zod<TSchema extends ZodType = ZodType>(
		fn: (schema: ZodType) => TSchema,
	): FieldWithMethods<
		Omit<TState, "data"> & {
			data: unknown extends z.output<TSchema>
				? TState["data"]
				: z.output<TSchema>;
		},
		TMethods
	> {
		return this._clone({ zodTransform: fn }) as any;
	}

	/**
	 * Explicitly set the field's TypeScript value type — type-level only,
	 * no runtime effect (mirrors Drizzle's `$type`). The type flows to
	 * select/insert types and `$types.value`.
	 *
	 * Mainly for `f.json()` fields, whose value otherwise types as the
	 * loose `JsonValue`. For runtime validation on top of the type, pair
	 * with `.zod()`.
	 *
	 * @example
	 * ```ts
	 * type Layout = { rows: { id: string; span: number }[] };
	 * layout: f.json().$type<Layout>()
	 * ```
	 */
	$type<T>(): FieldWithMethods<Omit<TState, "data"> & { data: T }, TMethods> {
		return this._clone({}) as any;
	}

	/** Transform value after reading from DB. */
	fromDb(fn: (value: unknown) => unknown): FieldWithMethods<TState, TMethods> {
		return this._clone<{}>({ fromDbFn: fn });
	}

	/** Transform value before writing to DB. */
	toDb(fn: (value: unknown) => unknown): FieldWithMethods<TState, TMethods> {
		return this._clone<{}>({ toDbFn: fn });
	}

	// ========================================================================
	// Public Derive — for fieldType() methods
	// ========================================================================

	/**
	 * Create a new Field with additional state, restricted to safe properties.
	 * Used by `fieldType().methods` to modify field state without accessing
	 * identity properties (type, columnFactory, schemaFactory, operatorSet, etc.).
	 *
	 * @param extra - Partial state to merge (identity properties are omitted)
	 */
	derive(
		extra: Omit<
			Partial<FieldRuntimeState>,
			| "type"
			| "columnFactory"
			| "schemaFactory"
			| "operatorSet"
			| "innerField"
			| "isArray"
			| "virtual"
		>,
	): FieldWithMethods<TState, TMethods> {
		return new Field({
			...this._state,
			...extra,
		}) as unknown as FieldWithMethods<TState, TMethods>;
	}

	// ========================================================================
	// Builder Methods — Plugin Extensions
	// ========================================================================

	/**
	 * Generic extension setter for plugin-contributed state.
	 * Used by codegen-generated extension proxies (e.g. `.admin()`, `.form()`).
	 *
	 * @param key - Extension key (e.g. "admin", "form")
	 * @param value - Extension value
	 */
	set<TKey extends string>(
		key: TKey,
		value: unknown,
	): FieldWithMethods<TState, TMethods> {
		return new Field({
			...this._state,
			extensions: { ...this._state.extensions, [key]: value },
		}) as unknown as FieldWithMethods<TState, TMethods>;
	}

	// ========================================================================
	// Builder Methods — Array Refinements (only meaningful after .array())
	// ========================================================================

	/** Set minimum items for array field. */
	minItems(n: number): FieldWithMethods<TState, TMethods> {
		return this._clone<{}>({ minItems: n });
	}

	/** Set maximum items for array field. */
	maxItems(n: number): FieldWithMethods<TState, TMethods> {
		return this._clone<{}>({ maxItems: n });
	}

	// ========================================================================
	// Public Runtime Accessors
	// ========================================================================

	/**
	 * Get the resolved field type string.
	 * Returns "array" for array-wrapped fields, custom type if set, else the base type.
	 */
	getType(): string {
		return this._state.isArray
			? "array"
			: (this._state.customType ?? this._state.type);
	}

	/**
	 * Get the field's storage location: "main", "i18n", "virtual", or "relation".
	 */
	getLocation(): FieldLocation {
		return this._inferLocation();
	}

	/** Phantom types for type-level inference. */
	declare readonly $types: {
		value: TState["data"];
		input: TState["data"];
		output: TState["data"];
		select: TState["data"];
		column: TState["column"];
		location: FieldLocation;
	};

	/**
	 * Generate Drizzle column(s) for this field.
	 * Returns null for virtual/relation fields.
	 */
	toColumn(name: string): unknown {
		const s = this._state;

		// Virtual fields have no column
		if (
			s.virtual === true ||
			(typeof s.virtual === "object" && s.virtual !== null)
		) {
			return null;
		}

		// No column factory means no column (e.g., hasMany relation)
		if (!s.columnFactory) {
			return null;
		}

		let column = s.columnFactory(name);

		// Apply NOT NULL
		if (s.notNull && typeof (column as any)?.notNull === "function") {
			column = (column as any).notNull();
		}

		// Apply default
		if (
			s.hasDefault &&
			s.defaultValue !== undefined &&
			typeof (column as any)?.default === "function"
		) {
			const defaultVal =
				typeof s.defaultValue === "function"
					? (s.defaultValue as () => unknown)()
					: s.defaultValue;
			column = (column as any).default(defaultVal);
		}

		// Apply user's drizzle transform
		if (s.drizzleTransform) {
			column = s.drizzleTransform(column);
		}

		return column;
	}

	/**
	 * Generate Zod schema for input validation.
	 */
	toZodSchema(): ZodType {
		return buildZodFromState(this._state);
	}

	/**
	 * Get context-aware operators for WHERE clause generation.
	 * Returns both column and JSONB variants.
	 */
	getOperators(): ContextualOperators {
		return resolveContextualOperators(this._state.operatorSet);
	}

	/**
	 * Get metadata for admin introspection.
	 */
	getMetadata(): FieldMetadata {
		const s = this._state;

		if (s.isArray) {
			const innerField = s.innerField as Field<FieldState> | undefined;

			return {
				type: "array",
				label: s.label,
				description: s.description,
				required: s.notNull,
				localized: s.localized,
				readOnly: s.input === false ? true : undefined,
				writeOnly: s.output === false ? true : undefined,
				validation: this._buildValidation(),
				meta: s.extensions?.admin as any,
				nestedFields: innerField
					? {
							item: innerField.getMetadata(),
						}
					: undefined,
			};
		}

		// Use custom metadata factory if provided
		if (s.metadataFactory) {
			return s.metadataFactory(s);
		}

		const base: FieldMetadataBase = {
			type: s.customType ?? s.type,
			label: s.label,
			description: s.description,
			required: s.notNull,
			localized: s.localized,
			readOnly: s.input === false ? true : undefined,
			writeOnly: s.output === false ? true : undefined,
			validation: this._buildValidation(),
			meta: s.extensions?.admin as any,
		};

		return base;
	}

	/**
	 * Get nested field definitions (for object fields).
	 */
	getNestedFields(): Record<string, Field<FieldState>> | undefined {
		return this._state.nestedFields as any;
	}

	/** Transform value after reading from DB. */
	fromDbValue(dbValue: unknown): unknown {
		return this._state.fromDbFn ? this._state.fromDbFn(dbValue) : dbValue;
	}

	/** Transform value before writing to DB. */
	toDbValue(value: unknown): unknown {
		return this._state.toDbFn ? this._state.toDbFn(value) : value;
	}

	// ========================================================================
	// Internal Helpers
	// ========================================================================

	/** Infer field location from state. */
	private _inferLocation(): FieldLocation {
		const s = this._state;
		if (
			s.virtual === true ||
			(typeof s.virtual === "object" && s.virtual !== null)
		) {
			return "virtual";
		}
		if (s.localized) {
			return "i18n";
		}
		if (s.hasMany && !s.multiple) {
			return "relation";
		}
		if (typeof s.through === "string" || typeof s.through === "function") {
			return "relation";
		}
		return "main";
	}

	/** Build validation metadata from accumulated refinements. */
	private _buildValidation(): FieldMetadataBase["validation"] {
		const s = this._state;
		const v: FieldMetadataBase["validation"] = {};

		if (s.maxLength !== undefined) v.maxLength = s.maxLength;
		if (s.minLength !== undefined) v.minLength = s.minLength;
		if (s.pattern !== undefined) v.pattern = s.pattern.source;
		if (s.min !== undefined) v.min = s.min;
		if (s.max !== undefined) v.max = s.max;
		if (s.minItems !== undefined) v.minItems = s.minItems;
		if (s.maxItems !== undefined) v.maxItems = s.maxItems;

		return Object.keys(v).length > 0 ? v : undefined;
	}
}

// ============================================================================
// Factory Helper
// ============================================================================

/**
 * Create a Field from a runtime state definition.
 * Used by builtin field factories to initialize the field.
 *
 * @internal
 */
export function field<TState extends FieldState>(
	state: FieldRuntimeState,
): Field<TState> {
	return new Field(state) as unknown as Field<TState>;
}
