/**
 * Operator System Types
 *
 * Defines the core types for the operator set abstraction.
 * An OperatorSet bundles column operators with a JSONB cast strategy,
 * enabling auto-derivation of JSONB operators from column operators.
 */

import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
	ContextualOperators,
	OperatorFn,
	OperatorMap,
	QueryContext,
} from "../types.js";

// ============================================================================
// JSONB Cast Strategies
// ============================================================================

/**
 * PostgreSQL cast type for JSONB extraction.
 *
 * When a field is nested inside a JSONB column (e.g., inside f.object()),
 * we extract the value via `col#>>'{path}'` (text extraction) then cast
 * to the appropriate type for comparison.
 *
 * - `"text"` → no cast needed, `#>>` already returns text
 * - `"numeric"` → `(col#>>'{path}')::numeric`
 * - `"boolean"` → `(col#>>'{path}')::boolean`
 * - `"timestamp"` → `(col#>>'{path}')::timestamp`
 * - `"jsonb"` → `col#>'{path}'` (preserves JSONB structure, no text extraction)
 * - `null` → no JSONB operators (e.g., toMany relations have no column)
 */
export type JsonbCast =
	| "text"
	| "numeric"
	| "boolean"
	| "timestamp"
	| "jsonb"
	| null;

// ============================================================================
// Operator Set Definition
// ============================================================================

/**
 * An OperatorSet bundles column operators with a JSONB cast strategy.
 *
 * Column operators are the source of truth. JSONB operators are auto-derived
 * at resolve time by wrapping each column operator with JSONB path extraction
 * and the appropriate cast.
 *
 * Fields that need non-mechanical JSONB behavior (e.g., `@>` containment)
 * can provide explicit `jsonbOverrides` that bypass auto-derivation for
 * specific operator names.
 *
 * @template TColumnOps - The column operator map type
 * @template TJsonbOverrides - Explicit JSONB operator overrides
 */
export interface OperatorSetDefinition<
	TColumnOps extends OperatorMap = OperatorMap,
	TJsonbOverrides extends OperatorMap = OperatorMap,
> {
	/** PostgreSQL cast for JSONB extraction. null = no JSONB ops. */
	jsonbCast: JsonbCast;

	/** Column operators — the source of truth for operator names + param types */
	column: TColumnOps;

	/**
	 * Explicit JSONB operator overrides.
	 * These bypass auto-derivation for specific operator names.
	 * Used for structural JSONB ops that can't be mechanically derived
	 * (containment, path queries, array ops, etc.).
	 */
	jsonbOverrides?: TJsonbOverrides;
}

// ============================================================================
// Resolved Operator Set
// ============================================================================

/**
 * A fully resolved operator set with both column and JSONB operators.
 * This is the runtime result of resolving an OperatorSetDefinition.
 *
 * Equivalent to the existing ContextualOperators but produced from
 * an OperatorSetDefinition instead of manually paired maps.
 */
export type ResolvedOperatorSet<TDef extends OperatorSetDefinition> =
	ContextualOperators<
		TDef["column"],
		TDef["jsonbCast"] extends null
			? Record<string, never>
			: TDef["column"] &
					(TDef["jsonbOverrides"] extends OperatorMap
						? TDef["jsonbOverrides"]
						: {})
	>;

// ============================================================================
// Derivation Context
// ============================================================================

/**
 * Context for JSONB operator derivation.
 * Passed to deriveJsonbOperator() to generate the SQL expression.
 */
export interface JsonbDerivationContext {
	/** The JSONB column reference */
	column: AnyPgColumn;
	/** The path within the JSONB structure */
	path: string[];
	/** The cast to apply after extraction */
	cast: Exclude<JsonbCast, null>;
}
