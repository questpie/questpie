/**
 * Extract the state type from a GlobalBuilder instance.
 * Used for lazy type extraction in extension methods.
 */
export type GlobalStateOf<T> = T extends { state: infer S } ? S : never;

/**
 * Extract the fields type from a GlobalBuilder instance.
 * Returns the fields record or empty object if no fields defined.
 *
 * This type is evaluated lazily - only when the method is called,
 * not when the builder type is constructed. This prevents type explosion.
 */
export type GlobalFieldsOf<T> =
	GlobalStateOf<T> extends {
		fieldDefinitions?: infer F;
	}
		? F extends Record<string, any>
			? F
			: Record<string, any>
		: Record<string, any>;
