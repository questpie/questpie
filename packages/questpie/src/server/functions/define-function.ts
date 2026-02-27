import type {
	FunctionDefinition,
	JsonFunctionDefinition,
	RawFunctionDefinition,
} from "./types.js";

// ============================================================================
// Overloads for fn() - type-safe function definitions
// ============================================================================

export function fn<TInput, TOutput>(
	definition: JsonFunctionDefinition<TInput, TOutput>,
): JsonFunctionDefinition<TInput, TOutput>;
export function fn(definition: RawFunctionDefinition): RawFunctionDefinition;
export function fn(definition: FunctionDefinition): FunctionDefinition {
	return definition;
}

// ============================================================================
// Typed factory for fn<TApp>() - explicit app type without module augmentation
// ============================================================================

/**
 * @deprecated TApp generic removed; use flat context properties (db, queue, email, ...) instead.
 */
/** @deprecated TApp generic removed; flat context properties are used instead */
fn.typed = function typedFn() {
	function createFn<TInput, TOutput>(
		definition: JsonFunctionDefinition<TInput, TOutput>,
	): JsonFunctionDefinition<TInput, TOutput>;
	function createFn(
		definition: RawFunctionDefinition,
	): RawFunctionDefinition;
	function createFn(
		definition: FunctionDefinition<any, any>,
	): FunctionDefinition<any, any> {
		return definition;
	}
	return createFn;
};
