/**
 * Component Reference
 *
 * Serializable reference to a server-defined component (icon, badge, custom).
 * Used by introspection to send UI element references from server to client,
 * where the client resolves them via its component registry.
 *
 * @example
 * ```ts
 * { type: "icon", props: { name: "ph:check-circle" } }
 * ```
 */
export interface ComponentReference<
	TType extends string = string,
	TProps extends Record<string, unknown> = Record<string, unknown>,
> {
	type: TType;
	props: TProps;
}

/**
 * Component callback proxy.
 * Returns serializable {@link ComponentReference} objects keyed by component type.
 *
 * Plugins/admin packages augment this interface to add typed factories for
 * registered component types (e.g. `c.badge(...)`, `c.avatar(...)`). At runtime,
 * unknown component names fall through the Proxy and produce a generic reference.
 *
 * @example
 * ```ts
 * c.icon("ph:check-circle") // { type: "icon", props: { name: "ph:check-circle" } }
 * ```
 */
export interface ComponentCallbackProxy {
	icon(name: string): ComponentReference<"icon", { name: string }>;
}

/**
 * Create a {@link ComponentCallbackProxy}. Any property access returns a
 * factory that builds a `ComponentReference` from its arguments. Strings are
 * treated as the canonical icon `{ name }` shorthand.
 */
export function createComponentCallbackProxy(): ComponentCallbackProxy {
	return new Proxy(
		{},
		{
			get: (_target, prop: string | symbol) => {
				if (typeof prop !== "string" || prop === "then") {
					return undefined;
				}
				return (...args: unknown[]): ComponentReference => ({
					type: prop,
					props:
						typeof args[0] === "string"
							? { name: args[0] }
							: ((args[0] as Record<string, unknown>) ?? {}),
				});
			},
		},
	) as ComponentCallbackProxy;
}
