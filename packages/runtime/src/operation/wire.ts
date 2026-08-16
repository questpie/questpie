import { isOperationCallId } from "./call-identity";
import type { OperationFailureCode } from "./index";

export const operationMediaType =
	"application/vnd.questpie.operation+json;version=1";
export const operationPath = "/_questpie/operation";
const operationProtocol = Object.freeze({
	name: "questpie.operation" as const,
	version: 1 as const,
});

const requestKeys = [
	"application",
	"callId",
	"clientContractDigest",
	"context",
	"input",
	"operation",
	"protocol",
	"timeoutMilliseconds",
	"wireDigest",
] as const;

export type OperationWireRequestV1 = Readonly<{
	application: string;
	callId: string;
	clientContractDigest: string;
	context: unknown;
	input: unknown;
	operation: string;
	protocol: typeof operationProtocol;
	timeoutMilliseconds: number | null;
	wireDigest: string;
}>;

export function decodeOperationWireRequest(
	value: unknown,
): OperationWireRequestV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const frame = value as Readonly<Record<string, unknown>>;
	const actual = Object.keys(frame).sort();
	if (
		actual.length !== requestKeys.length ||
		requestKeys.some((key, index) => key !== actual[index])
	)
		return null;
	if (
		!frame.protocol ||
		typeof frame.protocol !== "object" ||
		Array.isArray(frame.protocol)
	)
		return null;
	const protocol = frame.protocol as Readonly<Record<string, unknown>>;
	if (
		Object.keys(protocol).sort().join("\0") !== "name\0version" ||
		protocol.name !== operationProtocol.name ||
		protocol.version !== operationProtocol.version
	)
		return null;
	if (
		typeof frame.application !== "string" ||
		!isOperationCallId(frame.callId) ||
		typeof frame.clientContractDigest !== "string" ||
		typeof frame.operation !== "string" ||
		typeof frame.wireDigest !== "string" ||
		(frame.timeoutMilliseconds !== null &&
			(!Number.isSafeInteger(frame.timeoutMilliseconds) ||
				(frame.timeoutMilliseconds as number) <= 0))
	)
		return null;
	return frame as OperationWireRequestV1;
}

export function rejectionFrame(code: OperationFailureCode, retryable = false) {
	return Object.freeze({
		kind: "failure" as const,
		error: Object.freeze({ code, retryable }),
	});
}

export function failureFrame(
	frame: Pick<OperationWireRequestV1, "callId" | "operation">,
	code: OperationFailureCode,
	retryable = false,
) {
	return Object.freeze({
		protocol: operationProtocol,
		kind: "failure" as const,
		operation: frame.operation,
		callId: frame.callId,
		error: Object.freeze({ code, retryable }),
	});
}

export function declaredErrorFrame(
	frame: Pick<OperationWireRequestV1, "callId" | "operation">,
	error: Readonly<{ code: string; status: number; payload: unknown }>,
) {
	return Object.freeze({
		protocol: operationProtocol,
		kind: "declaredError" as const,
		operation: frame.operation,
		callId: frame.callId,
		error: Object.freeze({
			code: error.code,
			status: error.status,
			payload: error.payload,
		}),
	});
}

export function resultFrame(
	frame: Pick<OperationWireRequestV1, "callId" | "operation">,
	payload: unknown,
) {
	return Object.freeze({
		protocol: operationProtocol,
		kind: "result" as const,
		operation: frame.operation,
		callId: frame.callId,
		payload,
	});
}

export function operationFailureStatus(code: OperationFailureCode): number {
	if (code === "NOT_FOUND") return 404;
	if (code === "PROTOCOL_UNSUPPORTED") return 400;
	if (code === "APPLICATION_MISMATCH" || code === "CLIENT_OUTDATED") return 409;
	if (code === "DEADLINE_EXCEEDED") return 408;
	if (code === "RESOURCE_LIMIT") return 429;
	if (code === "RUNTIME_UNAVAILABLE") return 503;
	return 500;
}

export function operationWireResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": operationMediaType },
	});
}
