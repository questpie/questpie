import { decodeRuntimeCodecDescriptor } from "../codec";
import {
	exactRuntimeArtifactKeys as exactKeys,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as digest,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as record,
} from "./artifact-protocol";

type JsonRecord = Readonly<Record<string, unknown>>;

const ordinaryRequestKeys = [
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

function exact(value: unknown, expected: unknown, label: string): void {
	if (
		digest("questpie.private-wire-v3-contract-exact", value) !==
		digest("questpie.private-wire-v3-contract-exact", expected)
	)
		fail(`${label} is invalid`);
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		fail(`${label} must be text`);
	return value;
}

function operationIdentity(
	value: unknown,
	kinds: readonly ("action" | "mutation" | "query")[],
	label: string,
): string {
	const identity = text(value, label);
	const kind = kinds.find((candidate) => identity.startsWith(`${candidate}:`));
	if (!kind) fail(`${label} is invalid`);
	const name = identity.slice(kind.length + 1);
	const segments = name.split(".");
	if (
		name.length > 255 ||
		!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name) ||
		segments.some((segment) => segment.length > 63) ||
		(kind === "action" && segments.at(-1) === "then")
	)
		fail(`${label} is invalid`);
	return identity;
}

function declaredErrors(value: unknown, label: string): void {
	const errors = record(value, label);
	const codes = new Set<string>();
	for (const [key, raw] of Object.entries(errors)) {
		text(key, `${label} key`);
		const error = record(raw, `${label}.${key}`);
		exactKeys(error, ["code", "payload", "status"], `${label}.${key}`);
		const code = text(error.code, `${label}.${key}.code`);
		if (codes.has(code)) fail(`${label} codes must be unique`);
		codes.add(code);
		if (
			typeof error.status !== "number" ||
			!Number.isInteger(error.status) ||
			error.status < 400 ||
			error.status > 599
		)
			fail(`${label}.${key}.status is invalid`);
		if (error.payload !== null)
			decodeRuntimeCodecDescriptor(error.payload, `${label}.${key}.payload`);
	}
}

function operation(
	value: unknown,
	kinds: readonly ("action" | "mutation" | "query")[],
	label: string,
): JsonRecord {
	const candidate = record(value, label);
	exactKeys(
		candidate,
		["declaredErrors", "identity", "input", "output"],
		label,
	);
	operationIdentity(candidate.identity, kinds, `${label} identity`);
	decodeRuntimeCodecDescriptor(candidate.input, `${label}.input`);
	decodeRuntimeCodecDescriptor(candidate.output, `${label}.output`);
	declaredErrors(candidate.declaredErrors, `${label}.declaredErrors`);
	return candidate;
}

export function validatePrivateRetainedWireV2(retained: JsonRecord): void {
	if (
		typeof retained.application !== "string" ||
		retained.path !== "/_questpie/operation" ||
		retained.mediaType !==
			"application/vnd.questpie.operation+json;version=1" ||
		retained.principalSource !== "ingressOutsideBody" ||
		retained.mutationAutomaticRetry !== false
	)
		fail("retained Wire v2 base contract is invalid");
	digestValue(
		retained.clientContractDigest,
		"retained Wire v2 client contract digest",
	);
	const compatibility = record(
		retained.compatibility,
		"retained Wire v2 compatibility",
	);
	if (compatibility.clientContractDigest !== retained.clientContractDigest)
		fail("retained Wire v2 compatibility changed client contract");
	const protocol = record(retained.protocol, "retained Wire v2 protocol");
	exactKeys(protocol, ["name", "version"], "retained Wire v2 protocol");
	if (protocol.name !== "questpie.operation" || protocol.version !== 1)
		fail("retained Wire v2 protocol is invalid");
	const limits = record(retained.limits, "retained Wire v2 limits");
	exactKeys(
		limits,
		["requestBytes", "responseBytes"],
		"retained Wire v2 limits",
	);
	if (
		!Number.isSafeInteger(limits.requestBytes) ||
		Number(limits.requestBytes) <= 0 ||
		!Number.isSafeInteger(limits.responseBytes) ||
		Number(limits.responseBytes) <= 0
	)
		fail("retained Wire v2 limits are invalid");
	exact(retained.requestKeys, ordinaryRequestKeys, "retained request keys");
	exact(
		retained.responseKeys,
		{
			declaredError: ["callId", "error", "kind", "operation", "protocol"],
			failure: ["callId", "error", "kind", "operation", "protocol"],
			rejection: ["error", "kind"],
			result: ["callId", "kind", "operation", "payload", "protocol"],
		},
		"retained response keys",
	);
	if (!Array.isArray(retained.operations))
		fail("retained Wire v2 operations are invalid");
	let previous: string | undefined;
	for (const [index, raw] of retained.operations.entries()) {
		const candidate = operation(
			raw,
			["mutation", "query"],
			`retained Wire v2 operation ${index}`,
		);
		const identity = candidate.identity as string;
		if (previous !== undefined && previous >= identity)
			fail("retained Wire v2 operations must be unique and ASCII-sorted");
		previous = identity;
	}
}

export function validatePrivateActionOperation(value: unknown): JsonRecord {
	return operation(value, ["action"], "Action operation");
}
