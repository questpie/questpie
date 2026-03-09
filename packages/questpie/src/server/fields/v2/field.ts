/**
 * Field Builder V2 — Core Field Class
 *
 * Immutable builder class where each method returns a new Field
 * with updated type state via intersections.
 *
 * ```ts
 * f.text(255).required().label({ en: "Name" }).admin({ placeholder: "..." })
 * ```
 *
 * Type state grows monotonically:
 * - Field<{ type: "text", data: string, notNull: false, ... }>
 * - .required() → Field<{ ... } & { notNull: true }>
 * - .default("") → Field<{ ... } & { hasDefault: true }>
 *
 * The class implements the existing FieldDefinition interface via
 * toColumn(), toZodSchema(), getOperators(), getMetadata() so it
 * can be used wherever FieldDefinition is expected.
 */

import type { SQL } from "drizzle-orm";
import { jsonb } from "drizzle-orm/pg-core";
import { z, type ZodType } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";
import type { OperatorSetDefinition } from "../operators/types.js";
import { resolveContextualOperators } from "../operators/resolve.js";
import { selectMultiOps } from "../operators/builtin.js";
import type {
	ContextualOperators,
	FieldDefinition,
	FieldDefinitionAccess,
	FieldDefinitionState,
	FieldHooks,
	FieldLocation,
	FieldMetadata,
	FieldMetadataBase,
} from "../types.js";
import { buildZodFromState } from "./derive-schema.js";
import type { ArrayFieldState, FieldRuntimeState, FieldState } from "./types.js";

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
 */
export class Field<TState extends FieldState = FieldState> {
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
	private _clone<TExtra>(extra: Partial<FieldRuntimeState>): Field<TState & TExtra> {
		return new Field({ ...this._state, ...extra }) as unknown as Field<TState & TExtra>;
	}

	// ========================================================================
	// Builder Methods — Common
	// ========================================================================

	/** Mark field as NOT NULL (required). */
	required(): Field<TState & { notNull: true }> {
		return this._clone<{ notNull: true }>({ notNull: true });
	}

	/** Set a default value. Makes input optional. */
	default<V>(value: V | (() => V)): Field<TState & { hasDefault: true }> {
		return this._clone<{ hasDefault: true }>({
			hasDefault: true,
			defaultValue: value,
		});
	}

	/** Set display label. */
	label(l: I18nText): Field<TState & { label: I18nText }> {
		return this._clone<{ label: I18nText }>({ label: l });
	}

	/** Set description / help text. */
	description(d: I18nText): Field<TState & { description: I18nText }> {
		return this._clone<{ description: I18nText }>({ description: d });
	}

	/** Mark field as localized (stored in i18n table). */
	localized(): Field<TState & { localized: true }> {
		return this._clone<{ localized: true }>({ localized: true });
	}

	/** Exclude field from input (read-only). */
	inputFalse(): Field<TState & { input: false }> {
		return this._clone<{ input: false }>({ input: false });
	}

	/** Make input always optional (even if field is NOT NULL). */
	inputOptional(): Field<TState & { input: "optional" }> {
		return this._clone<{ input: "optional" }>({ input: "optional" });
	}

	/** Exclude field from output (write-only). */
	outputFalse(): Field<TState & { output: false }> {
		return this._clone<{ output: false }>({ output: false });
	}

	/**
	 * Mark field as virtual (no DB column).
	 * Optionally provide a SQL expression for computed columns.
	 */
	virtual(expr?: SQL): Field<TState & { virtual: true; column: null }> {
		return this._clone<{ virtual: true; column: null }>({
			virtual: expr ?? true,
		});
	}

	/** Set field-level hooks. */
	hooks<H extends FieldHooks>(h: H): Field<TState & { hooks: H }> {
		return this._clone<{ hooks: H }>({ hooks: h });
	}

	/** Set field-level access control. */
	access(a: FieldDefinitionAccess): Field<TState & { access: FieldDefinitionAccess }> {
		return this._clone<{ access: FieldDefinitionAccess }>({ access: a });
	}

	/**
	 * Wrap this field in an array (stored as JSONB).
	 * The inner field's type becomes the element type.
	 */
	array(): Field<ArrayFieldState<TState>> {
		return new Field({
			...this._state,
			isArray: true,
			innerField: this,
			// Array fields use jsonb column
			columnFactory: (name: string) => jsonb(name),
			// Override operator set for array
			operatorSet: selectMultiOps,
		}) as unknown as Field<ArrayFieldState<TState>>;
	}

	/**
	 * Override the operator set for this field.
	 */
	operators<TOps extends OperatorSetDefinition>(
		ops: TOps,
	): Field<TState & { operators: TOps }> {
		return this._clone<{ operators: TOps }>({ operatorSet: ops });
	}

	/**
	 * Escape hatch: modify the underlying Drizzle column builder.
	 * The transform receives the column builder and returns a (possibly different) one.
	 */
	drizzle<TNewCol>(fn: (col: TState["column"]) => TNewCol): Field<TState & { column: TNewCol }> {
		return this._clone<{ column: TNewCol }>({ drizzleTransform: fn as any });
	}

	/**
	 * Escape hatch: modify the auto-derived Zod schema.
	 * Applied after auto-derivation when toZodSchema() is called.
	 */
	zod(fn: (schema: ZodType) => ZodType): Field<TState> {
		return this._clone<{}>({ zodTransform: fn });
	}

	/** Transform value after reading from DB. */
	fromDb(fn: (value: unknown) => unknown): Field<TState> {
		return this._clone<{}>({ fromDbFn: fn });
	}

	/** Transform value before writing to DB. */
	toDb(fn: (value: unknown) => unknown): Field<TState> {
		return this._clone<{}>({ toDbFn: fn });
	}

	// ========================================================================
	// Builder Methods — Plugin Extensions
	// ========================================================================

	/**
	 * Set admin-specific configuration for this field.
	 * Added at runtime by @questpie/admin via prototype patching.
	 */
	admin(opts: unknown): Field<TState> {
		// Runtime implementation is patched in by @questpie/admin/server
		return this._clone<{}>({ admin: opts });
	}

	// ========================================================================
	// Builder Methods — Array Refinements (only meaningful after .array())
	// ========================================================================

	/** Set minimum items for array field. */
	minItems(n: number): Field<TState> {
		return this._clone<{}>({ minItems: n });
	}

	/** Set maximum items for array field. */
	maxItems(n: number): Field<TState> {
		return this._clone<{}>({ maxItems: n });
	}

	// ========================================================================
	// FieldDefinition Interface — Backward Compatibility
	// ========================================================================

	/**
	 * Build the state object matching the old FieldDefinitionState shape.
	 * This provides backward compatibility with existing CRUD and admin code.
	 */
	get state(): FieldDefinitionState & {
		value: TState["data"];
		input: TState["data"];
		output: TState["data"];
		select: TState["data"];
		column: TState["column"];
	} {
		return {
			type: this._state.customType ?? this._state.type,
			config: this._buildLegacyConfig(),
			value: undefined as any,
			input: undefined as any,
			output: undefined as any,
			select: undefined as any,
			column: undefined as any,
			location: this._inferLocation(),
			operators: this.getOperators(),
		};
	}

	/** Phantom types for inference — matches FieldDefinition.$types */
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
		if (s.virtual === true || (typeof s.virtual === "object" && s.virtual !== null)) {
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
		if (s.hasDefault && s.defaultValue !== undefined && typeof (column as any)?.default === "function") {
			const defaultVal = typeof s.defaultValue === "function"
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
			meta: s.admin as any,
		};

		return base;
	}

	/**
	 * Get nested field definitions (for object fields).
	 */
	getNestedFields(): Record<string, FieldDefinition<FieldDefinitionState>> | undefined {
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
		if (s.virtual === true || (typeof s.virtual === "object" && s.virtual !== null)) {
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

	/** Build a legacy config object from runtime state (for backward compat). */
	private _buildLegacyConfig(): Record<string, any> {
		const s = this._state;
		return {
			required: s.notNull || undefined,
			default: s.defaultValue,
			label: s.label,
			description: s.description,
			localized: s.localized || undefined,
			virtual: s.virtual === true ? true : s.virtual || undefined,
			input: s.input === true ? undefined : s.input,
			output: s.output === true ? undefined : s.output,
			hooks: s.hooks,
			access: s.access,
			// Field-specific
			maxLength: s.maxLength,
			minLength: s.minLength,
			pattern: s.pattern,
			min: s.min,
			max: s.max,
			// Select
			options: s.options,
			multiple: s.isArray || s.multiple || undefined,
			// Relation
			to: s.to,
			hasMany: s.hasMany,
			through: s.through,
			foreignKey: s.foreignKey,
			sourceField: s.sourceField,
			targetField: s.targetField,
			morphName: s.morphName,
			onDelete: s.onDelete,
			onUpdate: s.onUpdate,
			relationName: s.relationName,
		};
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
export function createField<TState extends FieldState>(
	state: FieldRuntimeState,
): Field<TState> {
	return new Field(state) as unknown as Field<TState>;
}
