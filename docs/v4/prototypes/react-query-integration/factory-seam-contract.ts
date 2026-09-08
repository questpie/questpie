import type { Projection } from "./projection-contract";

// Internal compatibility capability, not a same-realm security boundary.
const capability = Symbol.for("questpie.client-scope.factory-seam.v1");
const version = "questpie.client-scope.factory-seam.v1";
declare const scopeTypes: unique symbol;

/** Type-only brand: generated methods retain their exact operation contracts. */
export interface ClientScope<Source extends Projection> {
	readonly [scopeTypes]: Source;
}

export function attachClientScope<
	Scope extends object,
	Source extends Projection,
>(scope: Scope, read: () => Source): Scope & ClientScope<Source> {
	Object.defineProperty(scope, capability, {
		value: Object.freeze({ version, read }),
		enumerable: false,
		configurable: false,
		writable: false,
	});
	return scope as Scope & ClientScope<Source>;
}

export function readClientScope<Source extends Projection>(
	scope: ClientScope<Source>,
): Source {
	if (scope === null || typeof scope !== "object")
		throw new Error("CLIENT_PROJECTION_INCOMPATIBLE");
	const descriptor = Object.getOwnPropertyDescriptor(scope, capability);
	const value = descriptor?.value;
	if (
		!descriptor ||
		descriptor.enumerable ||
		descriptor.get ||
		value?.version !== version ||
		typeof value.read !== "function"
	)
		throw new Error("CLIENT_PROJECTION_INCOMPATIBLE");
	return value.read();
}
