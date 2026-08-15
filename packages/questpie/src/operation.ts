import type { Codec, CodecValue } from "./codec";

export interface OperationErrorDefinition<
	Code extends string,
	Status extends number,
	Payload extends Codec<unknown> | null = null,
> {
	readonly kind: "operationError";
	readonly code: Code;
	readonly status: Status;
	readonly payload: Payload;
}

export type OperationErrorMap = Readonly<
	Record<
		string,
		OperationErrorDefinition<string, number, Codec<unknown> | null>
	>
>;

export type OperationErrorFactories<Errors extends OperationErrorMap> = {
	readonly [Key in keyof Errors]: Errors[Key]["payload"] extends Codec<unknown>
		? (payload: CodecValue<Errors[Key]["payload"]>) => Error
		: () => Error;
};

function error<const Code extends string, const Status extends number>(
	definition: Readonly<{ code: Code; status: Status }>,
): OperationErrorDefinition<Code, Status>;
function error<
	const Code extends string,
	const Status extends number,
	const Payload extends Codec<unknown>,
>(
	definition: Readonly<{ code: Code; status: Status; payload: Payload }>,
): OperationErrorDefinition<Code, Status, Payload>;
function error(
	definition: Readonly<{
		code: string;
		status: number;
		payload?: Codec<unknown>;
	}>,
): OperationErrorDefinition<string, number, Codec<unknown> | null> {
	return Object.freeze({
		kind: "operationError",
		code: definition.code,
		status: definition.status,
		payload: definition.payload ?? null,
	});
}

export const operation = Object.freeze({ error });
