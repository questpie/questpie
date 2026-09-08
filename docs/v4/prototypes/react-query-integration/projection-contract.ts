// Proof-only compiler/runtime seam. No production export or wire contract.
export const projectionVersion = "questpie.client-projection.prototype.v1";

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}

export interface CapturedRead<Output> {
	/** Internal canonical material; never a public TanStack key or diagnostic. */
	readonly canonical: string;
	call(options?: CallOptions): Promise<Output>;
}

export interface ReadDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	capture(input: Input): CapturedRead<Output>;
	isError(error: unknown): error is DeclaredError;
}

export interface MutationDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	invoke(input: Input, options?: CallOptions): Promise<Output>;
	isError(error: unknown): error is DeclaredError;
}

export interface Projection {
	readonly version: typeof projectionVersion;
	readonly scopeId: string;
	readonly queries: Readonly<
		Record<string, ReadDescriptor<never, unknown, unknown>>
	>;
	readonly mutations: Readonly<
		Record<string, MutationDescriptor<never, unknown, unknown>>
	>;
}
