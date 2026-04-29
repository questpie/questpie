/**
 * Callback Context Proxy Factories
 *
 * Factory functions for creating proxy objects used in codegen callback contexts.
 * These are referenced by CallbackParamDefinition.factory and called at runtime
 * in the generated factories.ts to create typed context parameters for
 * builder extension callbacks (e.g. `.list(({ f }) => ...)`).
 */

/**
 * Create a field name proxy.
 * Accessing any property returns the property name as a string.
 *
 * Used as the `f` callback param: `f.title` → `"title"`.
 */
export function createFieldNameProxy(): Record<string, string> {
	return new Proxy(
		{},
		{
			get: (_: unknown, prop: string | symbol) => String(prop),
		},
	) as Record<string, string>;
}
