// Proof-only compiler/runtime seam. No production export or wire contract.
export const projectionVersion = "questpie.client-projection.prototype.v4";

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}

export interface CapturedRead<Output> {
	/** Internal canonical material; never a public TanStack key or diagnostic. */
	readonly canonical: string;
	call(options?: CallOptions): Promise<Output>;
	readonly watch?: (
		callback: (value: Output) => void,
		onError: (failure: ProjectionWatchFailure) => void,
	) => () => void;
}

export type ProjectionWatchFailure = Readonly<{
	code:
		| "AUTHORIZATION_FAILED"
		| "OUTPUT_INVALID"
		| "RESOURCE_LIMIT"
		| "TRANSPORT_FAILED"
		| "VERSION_INCOMPATIBLE";
}>;

export interface ReadDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	readonly watchable: boolean;
	capture(input: Input): CapturedRead<Output>;
	isError(error: unknown): error is DeclaredError;
	readonly forward?: ForwardReadDescriptor<never, Output>;
}

export interface CapturedForwardRead<Output> {
	readonly canonical: string;
	call(pageParam: string | null, options?: CallOptions): Promise<Output>;
}

export interface ForwardReadDescriptor<Input, Output> {
	capture(input: Input): CapturedForwardRead<Output>;
	next(page: Output): string | undefined;
}

export interface MutationDescriptor<Input, Output, DeclaredError> {
	readonly identity: string;
	invoke(input: Input, options?: CallOptions): Promise<Output>;
	isError(error: unknown): error is DeclaredError;
	failure(error: unknown): DecodedMutationFailure | undefined;
}

export type DecodedMutationFailure =
	| Readonly<{ kind: "committed"; callId: string; transactionId: string }>
	| Readonly<{ kind: "rejected"; callId: string }>;

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
