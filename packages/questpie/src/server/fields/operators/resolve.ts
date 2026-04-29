/**
 * Operator Resolution
 *
 * Resolves an OperatorSetDefinition into ContextualOperators by
 * auto-deriving JSONB operators from column operators + cast strategy.
 *
 * This eliminates ~500 lines of duplicated JSONB operator definitions.
 */

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import type {
	ContextualOperators,
	OperatorFn,
	OperatorMap,
	QueryContext,
} from "../types.js";
import type { JsonbCast, OperatorSetDefinition } from "./types.js";

/**
 * Build a JSONB path reference SQL fragment.
 *
 * - For text extraction: `col#>>'{a,b,c}'` — returns text
 * - For JSONB preservation: `col#>'{a,b,c}'` — returns jsonb
 *
 * @param column - The JSONB column
 * @param path - Path segments within the JSONB structure
 * @param preserveJsonb - If true, use #> (returns jsonb) instead of #>> (returns text)
 */
export function buildJsonbRef(
	column: AnyPgColumn,
	path: string[],
	preserveJsonb: boolean,
): ReturnType<typeof sql> {
	const pathStr = path.join(",");
	if (preserveJsonb) {
		return sql`${column}#>'{${sql.raw(pathStr)}}'`;
	}
	return sql`${column}#>>'{${sql.raw(pathStr)}}'`;
}

/**
 * Wrap a JSONB text extraction with the appropriate cast.
 *
 * - `"text"` → no cast, `#>>` already returns text
 * - `"numeric"` → `(ref)::numeric`
 * - `"boolean"` → `(ref)::boolean`
 * - `"timestamp"` → `(ref)::timestamp`
 * - `"jsonb"` → use `#>` instead of `#>>` (preserveJsonb mode)
 */
function buildCastedRef(
	column: AnyPgColumn,
	path: string[],
	cast: Exclude<JsonbCast, null>,
): ReturnType<typeof sql> {
	if (cast === "jsonb") {
		return buildJsonbRef(column, path, true);
	}

	const textRef = buildJsonbRef(column, path, false);

	switch (cast) {
		case "text":
			return textRef;
		case "numeric":
			return sql`(${textRef})::numeric`;
		case "boolean":
			return sql`(${textRef})::boolean`;
		case "timestamp":
			return sql`(${textRef})::timestamp`;
		default:
			return textRef;
	}
}

/**
 * Derive a JSONB operator from a column operator.
 *
 * For most operators, this replaces the direct column reference with
 * a JSONB path extraction + cast. For isNull/isNotNull, it uses
 * `#>` (without text extraction) since null checks on JSONB must
 * test the node existence, not the text representation.
 *
 * @param opName - The operator name (used to detect isNull/isNotNull)
 * @param columnOp - The original column operator function
 * @param cast - The JSONB cast strategy
 */
export function deriveJsonbOperator<TValue>(
	opName: string,
	columnOp: OperatorFn<TValue>,
	cast: Exclude<JsonbCast, null>,
): OperatorFn<TValue> {
	return (column: AnyPgColumn, value: TValue, ctx: QueryContext) => {
		const path = ctx.jsonbPath ?? [];

		// isNull/isNotNull must use #> (jsonb node check), not #>> (text)
		if (opName === "isNull" || opName === "isNotNull") {
			const jsonbNodeRef = buildJsonbRef(column, path, true);
			// Re-use the column operator's logic but with the jsonb ref
			return columnOp(jsonbNodeRef as any, value, ctx);
		}

		// For all other operators: extract + cast, then apply column op logic
		const ref = buildCastedRef(column, path, cast);
		return columnOp(ref as any, value, ctx);
	};
}

/**
 * Resolve an OperatorSetDefinition into ContextualOperators.
 *
 * Column operators are passed through. JSONB operators are auto-derived
 * from column operators + cast, with explicit overrides taking precedence.
 *
 * @example
 * ```ts
 * const ops = resolveContextualOperators(stringOps);
 * // ops.column = { eq, ne, in, notIn, like, ilike, ... }
 * // ops.jsonb = { eq (auto), ne (auto), in (auto), ... } — all derived from column ops
 * ```
 */
export function resolveContextualOperators<TDef extends OperatorSetDefinition>(
	def: TDef,
): ContextualOperators<TDef["column"], TDef["column"]> {
	const { column, jsonbCast, jsonbOverrides } = def;

	// No JSONB ops if cast is null
	if (jsonbCast === null) {
		return {
			column,
			jsonb: {} as any,
		};
	}

	// Auto-derive JSONB ops from column ops
	const derivedJsonb: OperatorMap = {};
	for (const [name, op] of Object.entries(column)) {
		if (!op) continue;
		derivedJsonb[name] = deriveJsonbOperator(name, op, jsonbCast);
	}

	// Merge with explicit overrides (overrides take precedence)
	const jsonb = jsonbOverrides
		? { ...derivedJsonb, ...jsonbOverrides }
		: derivedJsonb;

	return {
		column,
		jsonb: jsonb as any,
	};
}
