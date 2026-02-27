/**
 * Extract the state type from a CollectionBuilder instance.
 * Used for lazy type extraction in extension methods.
 *
 * @example
 * ```typescript
 * type MyState = StateOf<typeof myCollection>;
 * // { name: "posts", fields: { title: ..., content: ... }, ... }
 * ```
 */
export type StateOf<T> = T extends { state: infer S } ? S : never;

/**
 * Extract the fields type from a CollectionBuilder instance.
 * Returns the fields record or empty object if no fields defined.
 *
 * This type is evaluated lazily - only when the method is called,
 * not when the builder type is constructed. This prevents type explosion
 * when combining many collections via .use() and .collections().
 *
 * @example
 * ```typescript
 * // In extension method:
 * interface CollectionBuilderExtensions {
 *   list(fn: (ctx: { f: FieldsOf<this> }) => Config): this;
 * }
 *
 * // When called:
 * posts.list(({ f }) => ({
 *   columns: [f.title, f.author]  // f has correct field types
 * }))
 * ```
 */
export type FieldsOf<T> =
	StateOf<T> extends { fieldDefinitions?: infer F }
		? F extends Record<string, any>
			? F
			: Record<string, any>
		: Record<string, any>;
