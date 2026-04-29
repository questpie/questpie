/**
 * Field Builder — Type Definitions
 *
 * The field system uses a single generic parameter `TState` that
 * accumulates properties through intersection at each builder step,
 * exactly like Drizzle column builders.
 *
 * Each method returns `Field<TState & { ... }>` — the type grows
 * monotonically and never loses information.
 */

import type { SQL } from "drizzle-orm";
import type { PgJsonbBuilder } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";

import type { I18nText } from "#questpie/shared/i18n/types.js";

import type { OperatorSetDefinition } from "./operators/types.js";
import type {
	FieldAccess,
	FieldHooks,
	FieldMetadata,
	OperatorMap,
} from "./types.js";

// ============================================================================
// Field State — Type-Level Accumulator
// ============================================================================

/**
 * Base field state interface.
 * All fields start with this shape. Builder methods intersect additional
 * properties to narrow the type.
 */
export interface FieldState {
	/** Field type identifier ("text", "number", "select", etc.) */
	type: string;
	/** Runtime data type (string, number, boolean, etc.) */
	data: unknown;
	/** Drizzle column builder type (null for virtual/relation fields) */
	column: unknown;
	/** NOT NULL constraint applied */
	notNull: boolean;
	/** Has a default value */
	hasDefault: boolean;
	/** Field is localized (stored in i18n table) */
	localized: boolean;
	/** Field is virtual (no DB column) */
	virtual: boolean;
	/** Input behavior: true=normal, false=excluded, "optional"=always optional */
	input: boolean | "optional";
	/** Include in output */
	output: boolean;
	/** Wrapped in array via .array() */
	isArray: boolean;
	/** Operator set for WHERE clause generation */
	operators: OperatorSetDefinition;
	/** Relation/upload target collection name (for type-level dispatch) */
	relationTo?: string | Record<string, string>;
	/** Relation kind: "one" (belongsTo/upload), "many" (hasMany/manyToMany) */
	relationKind?: "one" | "many";
}

/**
 * Default field state — starting point for all field builders.
 */
export type DefaultFieldState = {
	type: string;
	data: unknown;
	column: unknown;
	notNull: false;
	hasDefault: false;
	localized: false;
	virtual: false;
	input: true;
	output: true;
	isArray: false;
	operators: OperatorSetDefinition;
};

declare global {
	namespace Questpie {
		interface ArrayFieldMeta {}
	}
}

export interface ArrayFieldMeta extends Questpie.ArrayFieldMeta {
	_?: never;
}

// ============================================================================
// State After Builder Methods
// ============================================================================

/**
 * State after .array() — wraps the inner field.
 * Column becomes jsonb, data becomes TInner["data"][].
 */
export type ArrayFieldState<TInner extends FieldState> = Omit<
	TInner,
	"data" | "column" | "isArray" | "operators" | "notNull" | "hasDefault"
> & {
	data: TInner["data"][];
	column: PgJsonbBuilder;
	isArray: true;
	notNull: false;
	hasDefault: false;
	operators: OperatorSetDefinition;
	innerState: TInner;
};

// ============================================================================
// Runtime State — Internal Implementation Detail
// ============================================================================

/**
 * Runtime state stored internally by the Field class.
 * NOT exposed in the public API — only `TState` is visible to users.
 */
export interface FieldRuntimeState {
	/** Field type identifier */
	type: string;
	/** Factory that creates a Drizzle column builder from a column name */
	columnFactory: ((name: string) => unknown) | null;
	/** Base Zod schema factory (before refinements/transforms) */
	schemaFactory: (() => ZodType) | null;
	/** Operator set definition */
	operatorSet: OperatorSetDefinition;
	/** NOT NULL */
	notNull: boolean;
	/** Has default */
	hasDefault: boolean;
	/** Default value or factory */
	defaultValue?: unknown;
	/** Display label */
	label?: I18nText;
	/** Help text */
	description?: I18nText;
	/** Localized */
	localized: boolean;
	/** Virtual field */
	virtual: boolean | SQL;
	/** Input behavior */
	input: boolean | "optional";
	/** Output behavior */
	output: boolean;
	/** Array wrapped */
	isArray: boolean;
	/** Field hooks */
	hooks?: FieldHooks;
	/** Access control */
	access?: FieldAccess;
	/** Transform applied to Drizzle column builder */
	drizzleTransform?: (col: unknown) => unknown;
	/** Transform applied to auto-derived Zod schema */
	zodTransform?: (schema: ZodType) => ZodType;
	/** fromDb transform */
	fromDbFn?: (value: unknown) => unknown;
	/** toDb transform */
	toDbFn?: (value: unknown) => unknown;

	// ---- Field-specific refinements (accumulated by chain methods) ----
	/** Max length (text/email/url) */
	maxLength?: number;
	/** Min length (text/textarea) */
	minLength?: number;
	/** Regex pattern (text) */
	pattern?: RegExp;
	/** Trim whitespace (text) */
	trim?: boolean;
	/** Lowercase (text) */
	lowercase?: boolean;
	/** Uppercase (text) */
	uppercase?: boolean;
	/** Min value (number) */
	min?: number;
	/** Max value (number) */
	max?: number;
	/** Positive constraint (number) */
	positive?: boolean;
	/** Integer constraint (number) */
	int?: boolean;
	/** Step constraint (number) */
	step?: number;
	/** Min items (array) */
	minItems?: number;
	/** Max items (array) */
	maxItems?: number;

	// ---- Relation-specific ----
	/** Relation target collection name */
	to?: string | Record<string, string | (() => unknown)> | (() => unknown);
	/** Has many flag */
	hasMany?: boolean;
	/** Multiple (jsonb array) flag */
	multiple?: boolean;
	/** Junction collection */
	through?: string | (() => unknown);
	/** Foreign key field */
	foreignKey?: string;
	/** Source field on junction */
	sourceField?: string;
	/** Target field on junction */
	targetField?: string;
	/** Morph name (polymorphic) */
	morphName?: string;
	/** On delete action */
	onDelete?: string;
	/** On update action */
	onUpdate?: string;
	/** Relation name for disambiguation */
	relationName?: string;

	// ---- Select-specific ----
	/** Select options */
	options?: unknown;
	/** Enum type flag */
	enumType?: boolean;
	/** Enum name */
	enumName?: string;

	// ---- Object-specific ----
	/** Nested field definitions */
	nestedFields?: Record<string, unknown>;

	// ---- Inner field state (for array wrapping) ----
	/** Inner field (when wrapped with .array()) */
	innerField?: unknown;

	// ---- Custom type string (for f.from()) ----
	/** Explicit type override */
	customType?: string;

	// ---- Plugin-contributed extensions (populated via .set()) ----
	/** Plugin-contributed extensions keyed by extension name */
	extensions?: Record<string, unknown>;

	// ---- Metadata factory override ----
	/** Custom metadata factory (for fields that need special metadata) */
	metadataFactory?: (state: FieldRuntimeState) => FieldMetadata;
}

// ============================================================================
// Type Extraction Utilities
// ============================================================================

/**
 * Extract the select type from a field's TState.
 * Handles notNull, hasDefault, output, isArray, virtual.
 */
export type ExtractSelectType<TState extends FieldState> = TState extends {
	output: false;
}
	? never
	: TState extends { virtual: true }
		? TState extends { notNull: true }
			? TState["data"]
			: TState["data"] | null
		: TState extends { isArray: true }
			? TState extends { notNull: true }
				? TState["data"]
				: TState["data"] | null
			: TState extends { notNull: true }
				? TState["data"]
				: TState["data"] | null;

/**
 * Extract the input type from a field's TState.
 * Handles notNull, hasDefault, input, virtual.
 */
export type ExtractInputType<TState extends FieldState> = TState extends {
	input: false;
}
	? never
	: TState extends { virtual: true }
		? TState extends { input: true }
			? TState["data"] | undefined
			: never
		: TState extends { input: "optional" }
			? TState["data"] | undefined
			: TState extends { notNull: true }
				? TState extends { hasDefault: true }
					? TState["data"] | undefined
					: TState["data"]
				: TState["data"] | null | undefined;

/**
 * Extract the where type from a field's TState operators.
 * Reads from the column operator map.
 */
export type ExtractWhereType<TState extends FieldState> = TState extends {
	operators: { column: infer TOps extends OperatorMap };
}
	? {
			[K in keyof TOps]?: TOps[K] extends (
				col: any,
				value: infer V,
				...args: any[]
			) => any
				? V
				: never;
		}
	: never;
