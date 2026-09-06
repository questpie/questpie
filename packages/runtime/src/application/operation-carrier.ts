import { encodeRuntimeCodec, type RuntimeCodec } from "../codec";
import {
	RuntimeCredentialMalformed,
	RuntimeCredentialUnavailable,
} from "../execution";
import {
	encodeDeclaredOperationError,
	type DeclaredOperationError,
	type RuntimeOperationContract,
} from "../operation";

export function classifyOperationCredentialFailure(
	error: unknown,
	signal: AbortSignal,
): "DEADLINE_EXCEEDED" | "UNAUTHENTICATED" | "RUNTIME_UNAVAILABLE" | undefined {
	if (signal.aborted) return "DEADLINE_EXCEEDED";
	if (error instanceof RuntimeCredentialMalformed) return "UNAUTHENTICATED";
	if (error instanceof RuntimeCredentialUnavailable)
		return "RUNTIME_UNAVAILABLE";
	return undefined;
}

export function encodeOperationResult(
	codec: RuntimeCodec,
	value: unknown,
	callId: string,
	maximumBytes: number,
): Readonly<{ callId: string; result: unknown }> | null {
	const body = { callId, result: encodeRuntimeCodec(codec, value) };
	return Buffer.byteLength(JSON.stringify(body), "utf8") > maximumBytes
		? null
		: body;
}

export function encodeOperationDeclaredOutcome(
	operation: Pick<RuntimeOperationContract, "declaredErrors">,
	error: DeclaredOperationError,
	callId: string,
) {
	const declared = encodeDeclaredOperationError(operation, error);
	return {
		status: declared.status,
		body: {
			callId,
			error: { code: declared.code, payload: declared.payload },
		},
	};
}
