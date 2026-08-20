import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { CommittedResultUnavailable } from "./committed-result-unavailable";

type OperationKind = "mutation" | "query";

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
		errors?: Readonly<Record<string, unknown>>;
	}>;
}

export class DeclaredOperationError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		readonly payload: unknown = null,
	) {
		super(code);
		this.name = "DeclaredOperationError";
	}
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

export type OperationAdmission = "authenticated" | "public" | "system";

export class OperationAdmissionError extends Error {
	constructor(readonly code: "forbidden" | "unauthenticated") {
		super(code);
		this.name = "OperationAdmissionError";
	}
}

export function assertOperationAdmission(
	admission: OperationAdmission,
	facts: Readonly<{
		authority: Readonly<{ kind: "ordinary" | "system" }>;
		principal: Readonly<{ kind: "anonymous" | "service" | "user" }>;
	}>,
): void {
	if (admission === "public") return;
	if (admission === "authenticated") {
		if (facts.principal.kind !== "anonymous") return;
		throw new OperationAdmissionError("unauthenticated");
	}
	if (facts.authority.kind === "system") return;
	throw new OperationAdmissionError("forbidden");
}

export function normalizeOperationError(
	error: unknown,
): OperationFailure | DeclaredOperationError | CommittedResultUnavailable {
	if (
		error instanceof OperationFailure ||
		error instanceof DeclaredOperationError ||
		error instanceof CommittedResultUnavailable
	)
		return error;
	return new OperationFailure("INTERNAL");
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
	inputCodec: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: readonly RuntimeDeclaredErrorContract[];
	input: unknown;
}>;

export type RuntimeDeclaredErrorContract = Readonly<{
	key: string;
	code: string;
	status: number;
	payload: RuntimeCodec | null;
}>;

export type RuntimeOperationContract = Readonly<{
	identity: string;
	input: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: readonly RuntimeDeclaredErrorContract[];
}>;

export function encodeDeclaredOperationError<View>(
	operation: PreparedOperation<View>,
	error: DeclaredOperationError,
): Readonly<{ code: string; status: number; payload: unknown }> {
	const contract = operation.declaredErrors.find(
		(candidate) => candidate.code === error.code,
	);
	if (!contract || contract.status !== error.status)
		throw new OperationFailure("INTERNAL");
	try {
		if (contract.payload === null) {
			if (error.payload !== null) throw new OperationFailure("INTERNAL");
			return Object.freeze({
				code: contract.code,
				status: contract.status,
				payload: null,
			});
		}
		return Object.freeze({
			code: contract.code,
			status: contract.status,
			payload: encodeRuntimeCodec(
				contract.payload,
				error.payload,
				`$declaredError.${contract.key}.payload`,
			),
		});
	} catch (caught) {
		if (caught instanceof OperationFailure) throw caught;
		if (caught instanceof RuntimeCodecError)
			throw new OperationFailure("INTERNAL");
		throw caught;
	}
}

export interface OperationEngine<View> {
	prepare(identity: string, input: unknown): PreparedOperation<View>;
	decodeResult(operation: PreparedOperation<View>, value: unknown): unknown;
	invokePrepared(
		operation: PreparedOperation<View>,
		ctx: View,
	): Promise<unknown>;
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
		prepare: (identity: string, input: unknown) => {
			const operation = operations.get(identity);
			const contract = codecs.get(identity);
			if (!operation || !contract) throw new OperationFailure("NOT_FOUND");
			return Object.freeze({
				binding: operation,
				inputCodec: contract.input,
				output: contract.output,
				declaredErrors: contract.declaredErrors,
				input: decode(contract.input, input),
			});
		},
		decodeResult: (operation: PreparedOperation<View>, value: unknown) =>
			decode(operation.output, value),
		invokePrepared: async (operation: PreparedOperation<View>, ctx: View) => {
			const result = await operation.binding.execute({
				input: operation.input,
				ctx,
			});
			return decode(operation.output, result);
		},
	});
}

export { readBoundedRequestBody } from "./body";
export { isOperationCallId, isPostgresTransactionId } from "./call-identity";
export {
	CommittedResultUnavailable,
	type CommittedResultUnavailablePayload,
} from "./committed-result-unavailable";
export { bindIngressPrincipal, readIngressPrincipal } from "./ingress";
export {
	committedResultUnavailableFrame,
	decodeOperationWireRequest,
	declaredErrorFrame,
	failureFrame,
	operationFailureStatus,
	operationMediaType,
	operationPath,
	operationWireResponse,
	rejectionFrame,
	resultFrame,
} from "./wire";
