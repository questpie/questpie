/** Internal generated-client compatibility; not a provider SPI or Authority. */
export const projectionVersion = "questpie.client-projection.v1";

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}

export type ProjectionWatchFailure = Readonly<{
	code:
		| "AUTHORIZATION_FAILED"
		| "OUTPUT_INVALID"
		| "RESOURCE_LIMIT"
		| "TRANSPORT_FAILED"
		| "VERSION_INCOMPATIBLE";
}>;

export interface CapturedRead<Output> {
	/** Internal codec material; never expose as a cache key or diagnostic. */
	readonly canonical: string;
	call(options?: CallOptions): Promise<Output>;
	readonly watch?: (
		callback: (value: Output) => void,
		onError: (failure: ProjectionWatchFailure) => void,
	) => () => void;
}

export interface CapturedForwardRead<Output> {
	readonly canonical: string;
	call(pageParam: string | null, options?: CallOptions): Promise<Output>;
}

export interface ForwardReadDescriptor<Input, Output> {
	capture(input: Input): CapturedForwardRead<Output>;
	next(page: Output): string | undefined;
}

export interface ReadDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	readonly watchable: boolean;
	capture(input: Input): CapturedRead<Output>;
	isError(error: unknown): error is DeclaredError;
	readonly forward?: ForwardReadDescriptor<never, Output>;
}

export type DecodedMutationFailure =
	| Readonly<{ kind: "committed"; callId: string; transactionId: string }>
	| Readonly<{ kind: "rejected"; callId: string }>;

export interface MutationDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	invoke(input: Input, options?: CallOptions): Promise<Output>;
	isError(error: unknown): error is DeclaredError;
	failure(error: unknown): DecodedMutationFailure | undefined;
}

export interface Projection {
	readonly version: typeof projectionVersion;
	readonly canonicalScope: string;
	readonly queries: Readonly<
		Record<string, ReadDescriptor<never, unknown, unknown>>
	>;
	readonly mutations: Readonly<
		Record<string, MutationDescriptor<never, unknown, unknown>>
	>;
}

const capabilityVersion = "questpie.client-scope.v1";
const capability = Symbol.for(capabilityVersion);
declare const scopeTypes: unique symbol;

/** Type-only brand carrying the generated Operation contracts into adapters. */
export interface ClientScope<Source extends Projection> {
	readonly [scopeTypes]: Source;
}

export function attachClientScope<
	Scope extends object,
	Source extends Projection,
>(scope: Scope, read: () => Source): Scope & ClientScope<Source> {
	Object.defineProperty(scope, capability, {
		value: Object.freeze({ version: capabilityVersion, read }),
		enumerable: false,
		configurable: false,
		writable: false,
	});
	return scope as Scope & ClientScope<Source>;
}

/** Cross-bundle compatibility plumbing, not a same-realm security boundary. */
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
		value?.version !== capabilityVersion ||
		typeof value.read !== "function"
	)
		throw new Error("CLIENT_PROJECTION_INCOMPATIBLE");
	return value.read();
}
