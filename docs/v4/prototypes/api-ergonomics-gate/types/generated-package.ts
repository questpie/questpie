import type { Codec, CodecValue } from "./core";

type OperationCall<Input, Output> = (input: Input) => Promise<Output>;

export interface PackageActions {
	readonly audit: Readonly<{
		write: OperationCall<
			Readonly<{ messageId: string }>,
			Readonly<{ auditId: string }>
		>;
	}>;
}

export interface PackageContext {
	readonly actions: Readonly<PackageActions>;
}

export declare const defineReaction: <
	const Name extends string,
	InputCodec extends Codec<unknown>,
	Output,
>(input: {
	readonly name: Name;
	readonly input: InputCodec;
	handler(input: {
		input: CodecValue<InputCodec>;
		ctx: PackageContext;
	}): Output | Promise<Output>;
}) => Readonly<{ kind: "reaction"; name: Name }>;
