/**
 * Field Builder
 *
 * Provides a fluent API for building field definitions with method chaining.
 * Similar to CollectionBuilder, uses TState pattern for type safety.
 *
 * @example
 * ```ts
 * const posts = q.collection("posts").fields((f) => ({
 *   title: f.text().notNull().maxLength(255),
 *   content: f.text().localized(),
 *   excerpt: f.text().virtual(),
 *   author: f.relation("users").belongsTo(),
 * }));
 * ```
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";
import type { I18nText } from "#questpie/shared/i18n/types.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldDefinition,
	FieldDefinitionState,
	FieldLocation,
	FieldMetadata,
	JoinBuilder,
	SelectModifier,
} from "./types.js";

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Set a property in an object type
 */
type SetProperty<T, K extends keyof T, V> = Omit<T, K> & Record<K, V>;

/**
 * Infer field location from config
 */
type InferFieldLocation<TConfig extends BaseFieldConfig> = TConfig extends {
	virtual: true | SQL<unknown>;
}
	? "virtual"
	: TConfig extends { localized: true }
		? "i18n"
		: "main";

// ============================================================================
// Field Implementation Interface
// ============================================================================

/**
 * Field implementation methods - provided by field type definitions
 */
interface FieldImplementation<
	TType extends string,
	TConfig extends BaseFieldConfig,
	TValue,
	TColumn extends AnyPgColumn | null,
> {
	toColumn: (name: string, config: TConfig) => TColumn | TColumn[] | null;
	toZodSchema: (config: TConfig) => ZodType;
	getOperators: (config: TConfig) => ContextualOperators;
	getMetadata: (config: TConfig) => FieldMetadata;
	getNestedFields?: (
		config: TConfig,
	) => Record<string, FieldDefinition<FieldDefinitionState>> | undefined;
	getSelectModifier?: (config: TConfig) => SelectModifier | undefined;
	getJoinBuilder?: (config: TConfig) => JoinBuilder | undefined;
	fromDb?: (dbValue: unknown, config: TConfig) => TValue;
	toDb?: (value: TValue, config: TConfig) => unknown;
}

// ============================================================================
// Field State Type
// ============================================================================

/**
 * Field state - carries all type and configuration information
 */
export interface FieldState<
	TType extends string,
	TConfig extends BaseFieldConfig,
	TValue,
	TColumn extends AnyPgColumn | null,
> {
	type: TType;
	config: TConfig;
	value: TValue;
	input: TValue | null | undefined;
	output: TValue;
	select: TValue;
	column: TColumn;
	location: FieldLocation;
	operators: ContextualOperators<any, any>;
}

// ============================================================================
// Field Builder Class
// ============================================================================

/**
 * Field Builder - fluent API for field configuration
 *
 * Provides method chaining for:
 * - Validation: .notNull(), .maxLength(), .min(), etc.
 * - Location: .localized(), .virtual()
 * - Defaults: .default(value)
 * - Relations: .belongsTo(), .hasMany(), .manyToMany()
 *
 * Each method returns a new FieldBuilder with updated state (immutable).
 */
export class FieldBuilder<
	TType extends string,
	TConfig extends BaseFieldConfig,
	TValue,
	TColumn extends AnyPgColumn | null,
> {
	/**
	 * The field state - carries all type and configuration information
	 * @internal
	 */
	readonly state: FieldState<TType, TConfig, TValue, TColumn>;

	/**
	 * The implementation - provides field-type specific behavior
	 * @internal
	 */
	private readonly implementation: FieldImplementation<
		TType,
		TConfig,
		TValue,
		TColumn
	>;

	constructor(
		state: FieldState<TType, TConfig, TValue, TColumn>,
		implementation: FieldImplementation<TType, TConfig, TValue, TColumn>,
	) {
		this.state = state;
		this.implementation = implementation;
	}

	// ========================================================================
	// Internal Helpers
	// ========================================================================

	/**
	 * Clone the builder with a new state
	 * @internal
	 */
	private clone<
		TNewColumn extends AnyPgColumn | null = TColumn,
		TNewConfig extends BaseFieldConfig = TConfig,
	>(
		newState: FieldState<TType, TNewConfig, TValue, TNewColumn>,
	): FieldBuilder<TType, TNewConfig, TValue, TNewColumn> {
		return new FieldBuilder(newState, this.implementation as any);
	}

	// ========================================================================
	// Location Methods
	// ========================================================================

	/**
	 * Mark field as localized - stored in i18n table
	 *
	 * @example
	 * ```ts
	 * content: f.text().localized()
	 * ```
	 */
	localized(): FieldBuilder<
		TType,
		SetProperty<TConfig, "localized", true>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			location: "i18n",
			config: { ...this.state.config, localized: true } as SetProperty<
				TConfig,
				"localized",
				true
			>,
		});
	}

	/**
	 * Mark field as virtual - no database column
	 *
	 * @example
	 * ```ts
	 * excerpt: f.text().virtual()
	 * ```
	 */
	virtual(): FieldBuilder<
		TType,
		SetProperty<TConfig, "virtual", true>,
		TValue,
		null
	> {
		return this.clone<any, any>({
			...this.state,
			location: "virtual",
			column: null,
			config: { ...this.state.config, virtual: true } as SetProperty<
				TConfig,
				"virtual",
				true
			>,
		});
	}

	/**
	 * Mark field as computed with SQL expression
	 *
	 * @example
	 * ```ts
	 * commentCount: f.number().computed(sql`(SELECT COUNT(*) FROM comments)`)
	 * ```
	 */
	computed<TOutput = TValue>(
		sqlExpression: SQL<TOutput>,
	): FieldBuilder<
		TType,
		SetProperty<TConfig, "virtual", SQL<TOutput>>,
		TValue,
		null
	> {
		return this.clone<any, any>({
			...this.state,
			location: "virtual",
			column: null,
			config: { ...this.state.config, virtual: sqlExpression } as SetProperty<
				TConfig,
				"virtual",
				SQL<TOutput>
			>,
		});
	}

	// ========================================================================
	// Validation Methods
	// ========================================================================

	/**
	 * Mark field as required (not null)
	 *
	 * @example
	 * ```ts
	 * title: f.text().notNull()
	 * ```
	 */
	notNull(): FieldBuilder<
		TType,
		SetProperty<TConfig, "required", true>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			config: { ...this.state.config, required: true } as SetProperty<
				TConfig,
				"required",
				true
			>,
		});
	}

	/**
	 * Set default value
	 *
	 * @example
	 * ```ts
	 * status: f.select().default("draft")
	 * ```
	 */
	default(
		value: TValue,
	): FieldBuilder<
		TType,
		SetProperty<TConfig, "default", TValue>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			config: { ...this.state.config, default: value } as SetProperty<
				TConfig,
				"default",
				TValue
			>,
		});
	}

	/**
	 * Set field label
	 */
	label(
		label: I18nText,
	): FieldBuilder<
		TType,
		SetProperty<TConfig, "label", I18nText>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			config: { ...this.state.config, label } as SetProperty<
				TConfig,
				"label",
				I18nText
			>,
		});
	}

	/**
	 * Set field description
	 */
	description(
		desc: I18nText,
	): FieldBuilder<
		TType,
		SetProperty<TConfig, "description", I18nText>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			config: { ...this.state.config, description: desc } as SetProperty<
				TConfig,
				"description",
				I18nText
			>,
		});
	}

	// NOTE: unique(), index(), searchable() chainable methods REMOVED
	// These are collection-level concerns, not field-level:
	// - Use .indexes() on CollectionBuilder for unique/index constraints
	// - Use .searchable() on CollectionBuilder for search indexing

	/**
	 * Hide field from output (write-only)
	 */
	hidden(): FieldBuilder<
		TType,
		SetProperty<TConfig, "output", false>,
		TValue,
		TColumn
	> {
		return this.clone({
			...this.state,
			config: { ...this.state.config, output: false } as SetProperty<
				TConfig,
				"output",
				false
			>,
		});
	}

	// ========================================================================
	// Build Method
	// ========================================================================

	/**
	 * Build the field definition
	 *
	 * This is called automatically when the field is used in .fields()
	 * @internal
	 */
	build(): FieldDefinition<FieldState<TType, TConfig, TValue, TColumn>> {
		const state = this.state;
		const impl = this.implementation;

		return {
			state,
			$types: {} as {
				value: TValue;
				input: TValue | null | undefined;
				output: TValue;
				select: TValue;
				column: TColumn;
				location: FieldLocation;
			},
			toColumn: (name: string) => impl.toColumn(name, state.config),
			toZodSchema: () => impl.toZodSchema(state.config),
			getOperators: () => impl.getOperators(state.config),
			getMetadata: () => impl.getMetadata(state.config),
			getNestedFields: impl.getNestedFields
				? () =>
						impl.getNestedFields!(state.config) as Record<
							string,
							FieldDefinition<FieldDefinitionState>
						>
				: undefined,
			getSelectModifier: impl.getSelectModifier
				? () => impl.getSelectModifier!(state.config)
				: undefined,
			getJoinBuilder: impl.getJoinBuilder
				? () => impl.getJoinBuilder!(state.config)
				: undefined,
			fromDb: impl.fromDb
				? (dbValue: unknown) => impl.fromDb!(dbValue, state.config)
				: undefined,
			toDb: impl.toDb
				? (value: unknown) => impl.toDb!(value as TValue, state.config)
				: undefined,
		} as FieldDefinition<FieldState<TType, TConfig, TValue, TColumn>>;
	}
}

// ============================================================================
// Field Builder Factory
// ============================================================================

/**
 * Create a field builder for a specific field type
 *
 * @param type - Field type identifier
 * @param implementation - Field implementation
 * @param baseConfig - Base configuration
 * @returns FieldBuilder instance
 *
 * @example
 * ```ts
 * const textField = createFieldBuilder("text", textImplementation, { maxLength: 255 });
 * ```
 */
export function createFieldBuilderForType<
	TType extends string,
	TConfig extends BaseFieldConfig,
	TValue,
	TColumn extends AnyPgColumn | null,
>(
	type: TType,
	implementation: FieldImplementation<TType, TConfig, TValue, TColumn>,
	baseConfig: TConfig,
): FieldBuilder<TType, TConfig, TValue, TColumn> {
	const initialState: FieldState<TType, TConfig, TValue, TColumn> = {
		type,
		config: baseConfig,
		value: undefined as TValue,
		input: undefined as TValue | null | undefined,
		output: undefined as TValue,
		select: undefined as TValue,
		column: undefined as unknown as TColumn,
		location: "main",
		operators: implementation.getOperators(baseConfig),
	};

	return new FieldBuilder(initialState, implementation);
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Extract the final field definition type from a FieldBuilder
 */
export type FieldBuilderResult<
	TBuilder extends FieldBuilder<any, any, any, any>,
> =
	TBuilder extends FieldBuilder<
		infer TType,
		infer TConfig,
		infer TValue,
		infer TColumn
	>
		? FieldDefinition<FieldState<TType, TConfig, TValue, TColumn>>
		: never;

/**
 * Extract field state from builder
 */
export type FieldBuilderState<
	TBuilder extends FieldBuilder<any, any, any, any>,
> =
	TBuilder extends FieldBuilder<
		infer TType,
		infer TConfig,
		infer TValue,
		infer TColumn
	>
		? FieldState<TType, TConfig, TValue, TColumn>
		: never;
