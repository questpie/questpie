/**
 * Operator System
 *
 * Provides an abstraction for field operators that auto-derives JSONB
 * operators from column operators + a cast strategy.
 *
 * @module
 */

export type {
	JsonbCast,
	JsonbDerivationContext,
	OperatorSetDefinition,
	ResolvedOperatorSet,
} from "./types.js";
export { operatorSet, extendOperatorSet } from "./operator-set.js";
export {
	buildJsonbRef,
	deriveJsonbOperator,
	resolveContextualOperators,
} from "./resolve.js";
export {
	stringOps,
	numberOps,
	booleanOps,
	dateOps,
	emailOps,
	urlOps,
	selectSingleOps,
	selectMultiOps,
	objectOps,
	belongsToOps,
	toManyOps,
	multipleOps,
	basicOps,
} from "./builtin.js";
