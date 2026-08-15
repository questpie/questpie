import {
	decodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";

type OperationKind = "query";

export interface RuntimeExecutableBinding<View> {
	readonly identity: string;
	readonly kind: OperationKind;
	readonly slot: "handler";
	readonly runtimeGraphDigest: string;
	readonly bundleExport: string;
	readonly execute: (
		input: Readonly<{
			input: unknown;
			ctx: View;
		}>,
	) => unknown | Promise<unknown>;
	readonly definition: Readonly<{
		name: string;
		handler: RuntimeExecutableBinding<View>["execute"];
	}>;
}

export type OperationFailureCode =
	| "APPLICATION_MISMATCH"
	| "CLIENT_OUTDATED"
	| "DEADLINE_EXCEEDED"
	| "INTERNAL"
	| "NOT_FOUND"
	| "PROTOCOL_UNSUPPORTED"
	| "RESOURCE_LIMIT"
	| "RUNTIME_UNAVAILABLE";

export class OperationFailure extends Error {
	constructor(
		readonly code: OperationFailureCode,
		readonly retryable = false,
	) {
		super(code);
		this.name = "OperationFailure";
	}
}

function decode(codec: RuntimeCodec, value: unknown): unknown {
	try {
		return decodeRuntimeCodec(codec, value);
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new OperationFailure("PROTOCOL_UNSUPPORTED");
		throw error;
	}
}

export type PreparedOperation<View> = Readonly<{
	binding: RuntimeExecutableBinding<View>;
	output: RuntimeCodec;
	input: unknown;
}>;

export type RuntimeOperationContract = Readonly<{
	identity: string;
	input: RuntimeCodec;
	output: RuntimeCodec;
}>;

export interface OperationEngine<View> {
	has(identity: string): boolean;
	prepare(identity: string, input: unknown): PreparedOperation<View>;
	invokePrepared(
		operation: PreparedOperation<View>,
		ctx: View,
	): Promise<unknown>;
	invoke(identity: string, input: unknown, ctx: View): Promise<unknown>;
}

export function createOperationEngine<View>(
	bindings: readonly RuntimeExecutableBinding<View>[],
	contracts: readonly RuntimeOperationContract[],
): OperationEngine<View> {
	const operations = new Map(
		bindings.map((binding) => [binding.identity, binding]),
	);
	const codecs = new Map(
		contracts.map((contract) => [contract.identity, contract]),
	);
	if (
		operations.size !== bindings.length ||
		codecs.size !== contracts.length ||
		operations.size !== codecs.size ||
		[...operations.keys()].some((identity) => !codecs.has(identity))
	)
		throw new TypeError(
			"Runtime operation contract does not match executable binding",
		);
	return Object.freeze({
		has: (identity: string) => operations.has(identity),
		prepare: (identity: string, input: unknown) => {
			const operation = operations.get(identity);
			const contract = codecs.get(identity);
			if (!operation || !contract) throw new OperationFailure("NOT_FOUND");
			return Object.freeze({
				binding: operation,
				output: contract.output,
				input: decode(contract.input, input),
			});
		},
		invokePrepared: async (operation: PreparedOperation<View>, ctx: View) => {
			const result = await operation.binding.execute({
				input: operation.input,
				ctx,
			});
			return decode(operation.output, result);
		},
		invoke(identity: string, input: unknown, ctx: View) {
			return this.invokePrepared(this.prepare(identity, input), ctx);
		},
	});
}
