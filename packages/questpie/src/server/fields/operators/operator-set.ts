/**
 * Operator Set Factory
 *
 * Creates and extends OperatorSetDefinition instances.
 * These are plain frozen objects — no classes, no builders.
 */

import type { OperatorMap } from "../types.js";
import type { JsonbCast, OperatorSetDefinition } from "./types.js";

/**
 * Create an operator set definition.
 *
 * @example
 * ```ts
 * const stringOps = operatorSet({
 *   jsonbCast: "text",
 *   column: { eq, ne, in, notIn, like, ilike, contains, startsWith, endsWith, isNull, isNotNull },
 * });
 * ```
 */
export function operatorSet<
	TColumnOps extends OperatorMap,
	TJsonbOverrides extends OperatorMap = Record<string, never>,
>(def: {
	jsonbCast: JsonbCast;
	column: TColumnOps;
	jsonbOverrides?: TJsonbOverrides;
}): OperatorSetDefinition<TColumnOps, TJsonbOverrides> {
	return Object.freeze({
		jsonbCast: def.jsonbCast,
		column: Object.freeze(def.column) as TColumnOps,
		jsonbOverrides: def.jsonbOverrides
			? (Object.freeze(def.jsonbOverrides) as TJsonbOverrides)
			: undefined,
	}) as OperatorSetDefinition<TColumnOps, TJsonbOverrides>;
}

/**
 * Extend an existing operator set with additional column operators and/or JSONB overrides.
 *
 * @example
 * ```ts
 * const emailOps = extendOperatorSet(stringOps, {
 *   column: {
 *     domain: operator<string>((col, value) => ilike(col, `%@${value}`)),
 *     domainIn: operator<string[]>((col, values) => ...),
 *   },
 *   jsonbOverrides: {
 *     domain: operator<string>((col, value, ctx) => ...),
 *   },
 * });
 * ```
 */
export function extendOperatorSet<
	TBase extends OperatorSetDefinition,
	TExtraColumn extends OperatorMap = Record<string, never>,
	TExtraJsonb extends OperatorMap = Record<string, never>,
>(
	base: TBase,
	extensions: {
		jsonbCast?: JsonbCast;
		column?: TExtraColumn;
		jsonbOverrides?: TExtraJsonb;
	},
): OperatorSetDefinition<
	TBase["column"] & TExtraColumn,
	(TBase["jsonbOverrides"] extends OperatorMap ? TBase["jsonbOverrides"] : {}) &
		TExtraJsonb
> {
	return Object.freeze({
		jsonbCast: extensions.jsonbCast ?? base.jsonbCast,
		column: Object.freeze({
			...base.column,
			...extensions.column,
		}),
		jsonbOverrides: Object.freeze({
			...(base.jsonbOverrides ?? {}),
			...(extensions.jsonbOverrides ?? {}),
		}),
	}) as any;
}
