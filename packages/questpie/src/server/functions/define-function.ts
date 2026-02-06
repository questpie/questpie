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
 * Create a typed function factory for a specific app type.
 *
 * Use this when you want type-safe `ctx.app` access without relying on
 * module augmentation.
 *
 * @example
 * ```ts
 * import type { AppCMS } from './cms';
 *
 * // ctx.app is fully typed as AppCMS
 * const getStats = fn<AppCMS>()({
 *   schema: z.object({ period: z.string() }),
 *   handler: async ({ input, app }) => {
 *     // app is typed as AppCMS
 *     return app.api.collections.orders.find({ ... });
 *   }
 * });
 * ```
 */
fn.typed = function typedFn<TApp = any>() {
  function createFn<TInput, TOutput>(
    definition: JsonFunctionDefinition<TInput, TOutput, TApp>,
  ): JsonFunctionDefinition<TInput, TOutput, TApp>;
  function createFn(
    definition: RawFunctionDefinition<TApp>,
  ): RawFunctionDefinition<TApp>;
  function createFn(
    definition: FunctionDefinition<any, any, TApp>,
  ): FunctionDefinition<any, any, TApp> {
    return definition;
  }
  return createFn;
};
