/**
 * Internal AsyncLocalStorage keys.
 *
 * These symbols let framework internals carry request plumbing through existing
 * context propagation without adding new public handler arguments.
 *
 * @internal
 */

export const INTERNAL_ADAPTER_CONTEXT = Symbol.for(
	"questpie.internal.adapterContext",
);

export type InternalContextStore = {
	[INTERNAL_ADAPTER_CONTEXT]?: unknown;
};

export function attachInternalAdapterContext<T extends object>(
	store: T,
	adapterContext: unknown,
): T {
	const existing = getInternalAdapterContext(store);
	if (existing !== undefined) {
		if (existing === adapterContext) return store;
		throw new Error("[QUESTPIE] Internal adapter context is already attached.");
	}

	Object.defineProperty(store, INTERNAL_ADAPTER_CONTEXT, {
		value: adapterContext,
		enumerable: false,
		configurable: false,
		writable: false,
	});
	return store;
}

export function getInternalAdapterContext(store: unknown): unknown {
	if (!store || typeof store !== "object") return undefined;
	return (store as InternalContextStore)[INTERNAL_ADAPTER_CONTEXT];
}
