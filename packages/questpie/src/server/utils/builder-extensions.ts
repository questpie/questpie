/**
 * Builder Extension Proxy Wrapper
 *
 * Generic Proxy wrapper that intercepts extension method calls on builders
 * (CollectionBuilder, GlobalBuilder) and delegates to `builder.set()`.
 * Re-wraps builder-returning methods so the Proxy chain is preserved
 * across immutable builder calls.
 *
 * Previously emitted inline in every generated factories.ts — now a single
 * importable utility.
 *
 */

/**
 * Extension registry entry. Maps a method name to its state key and
 * a resolve function that processes the user-provided config.
 */
export interface BuilderExtensionEntry {
	stateKey: string;
	resolve: (v: any) => any;
}

/**
 * Wrap a builder instance with a Proxy that intercepts extension method calls.
 *
 * Extension methods (e.g. `.admin()`, `.list()`) are looked up in the registry
 * and delegated to `builder.set(stateKey, resolve(config))`. Core builder
 * methods (e.g. `.fields()`, `.hooks()`) are passed through, and if they
 * return a builder instance, the result is re-wrapped to preserve the chain.
 *
 * @param builder - The builder instance to wrap
 * @param registry - Map of extension method names to their config
 * @param BuilderClass - The builder class constructor (for instanceof checks)
 */
export function wrapBuilderWithExtensions<T>(
	builder: T,
	registry: Record<string, BuilderExtensionEntry>,
	BuilderClass: abstract new (...args: any[]) => any,
): T {
	return new Proxy(builder as any, {
		get(target, prop, receiver) {
			if (typeof prop === "string" && prop in registry) {
				const ext = registry[prop];
				return (configOrFn: any) =>
					wrapBuilderWithExtensions(
						target.set(ext.stateKey, ext.resolve(configOrFn)),
						registry,
						BuilderClass,
					);
			}
			const val = Reflect.get(target, prop, receiver);
			if (typeof val === "function") {
				return function (this: any, ...args: any[]) {
					const result = val.apply(target, args);
					return result instanceof BuilderClass
						? wrapBuilderWithExtensions(result, registry, BuilderClass)
						: result;
				};
			}
			return val;
		},
	}) as T;
}
