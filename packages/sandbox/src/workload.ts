import type {
	SandboxBindings,
	SandboxCapabilities,
	SandboxRunRequest,
} from "./types.js";

export const SANDBOX_WORKLOAD_DENIAL_MESSAGE =
	"The workload is not authorized for this sandbox operation.";

export class SandboxWorkloadDeniedError extends Error {
	readonly code = "sandbox_authority_denied" as const;

	constructor() {
		super(SANDBOX_WORKLOAD_DENIAL_MESSAGE);
		this.name = "SandboxWorkloadDeniedError";
	}
}

export interface SandboxWorkloadPolicy {
	readonly source: string;
	readonly input?: unknown;
	readonly capabilities: SandboxCapabilities;
	readonly secrets?: Readonly<Record<string, string>>;
	readonly bindings?: SandboxBindings;
	/** Optional consumer deadline; transport admission is additionally capped at 5s. */
	readonly validUntil?: string;
}

export type SandboxWorkloadAuthorizationPhase = "prepare" | "dispatch";

export interface SandboxWorkloadAuthorizationContext {
	readonly phase: SandboxWorkloadAuthorizationPhase;
	readonly signal: AbortSignal;
}

export type SandboxWorkloadAuthorizer = (
	envelope: unknown,
	context: SandboxWorkloadAuthorizationContext,
) => SandboxWorkloadPolicy | null | Promise<SandboxWorkloadPolicy | null>;

export interface SandboxWorkloadAuditEvent {
	readonly boundary: "sandbox.workload";
	readonly phase: SandboxWorkloadAuthorizationPhase | "transport";
	readonly decision: "allowed" | "denied";
	readonly reason:
		| "authorization_failed"
		| "authorization_timed_out"
		| "cancelled"
		| "egress_denied"
		| "policy_changed"
		| "policy_invalid"
		| "authorization_succeeded"
		| "transport_completed"
		| "transport_denied"
		| "transport_cancelled"
		| "transport_timed_out"
		| "transport_invalid_response"
		| "transport_failed";
}

export interface SandboxWorkloadAuditContext {
	readonly signal: AbortSignal;
}

export interface SandboxWorkloadRunOptions {
	/** Consumer-owned opaque value. QUESTPIE never parses or persists it. */
	readonly envelope: unknown;
	readonly signal?: AbortSignal;
}

const MAX_SOURCE_BYTES = 1_048_576;
const MAX_NAMED_VALUES = 64;
const MAX_HOSTS_PER_AXIS = 32;
const MAX_TOTAL_HOSTS = 32;
const MAX_SECRET_VALUE_BYTES = 65_536;
const MAX_TOTAL_SECRET_BYTES = 262_144;
const MAX_INPUT_DEPTH = 32;
const MAX_INPUT_NODES = 10_000;
const MAX_INPUT_BYTES = 1_048_576;
const MAX_BINDINGS_URL_BYTES = 2_048;
const MAX_BINDINGS_TOKEN_BYTES = 8_192;
const utf8Encoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copy enumerable data descriptors without invoking getters. Proxy traps and
 * exotic prototypes are rejected by the caller's fail-closed catch.
 */
function snapshotDataRecord(value: unknown): Record<string, unknown> | null {
	if (!isRecord(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return null;
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string") return null;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
			return null;
		}
		result[key] = descriptor.value;
	}
	return result;
}

function exactOrOptionalKeys(
	value: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
): boolean {
	const keys = Object.keys(value);
	return (
		required.every((key) => keys.includes(key)) &&
		keys.every((key) => required.includes(key) || optional.includes(key))
	);
}

function normalizeHosts(value: unknown): readonly string[] | null {
	if (!Array.isArray(value) || value.length > MAX_HOSTS_PER_AXIS) return null;
	const hosts: string[] = [];
	for (const host of value) {
		if (
			typeof host !== "string" ||
			host.length === 0 ||
			host.length > 253 ||
			host.includes("*") ||
			host.includes("/") ||
			/\s/.test(host)
		) {
			return null;
		}
		hosts.push(host);
	}
	return Object.freeze(hosts);
}

function normalizeCapabilities(value: unknown): SandboxCapabilities | null {
	const record = snapshotDataRecord(value);
	if (
		!record ||
		!exactOrOptionalKeys(record, ["net", "import", "timeoutMs", "memoryMb"], [])
	) {
		return null;
	}
	const net = normalizeHosts(record.net);
	const imports = normalizeHosts(record.import);
	if (
		!net ||
		!imports ||
		net.length + imports.length > MAX_TOTAL_HOSTS ||
		typeof record.timeoutMs !== "number" ||
		!Number.isInteger(record.timeoutMs) ||
		record.timeoutMs < 1 ||
		record.timeoutMs > 30_000 ||
		typeof record.memoryMb !== "number" ||
		!Number.isInteger(record.memoryMb) ||
		record.memoryMb < 16 ||
		record.memoryMb > 1_024
	) {
		return null;
	}
	return Object.freeze({
		net: [...net],
		import: [...imports],
		timeoutMs: record.timeoutMs,
		memoryMb: record.memoryMb,
	});
}

function normalizeSecrets(
	value: unknown,
): Readonly<Record<string, string>> | null {
	const record = snapshotDataRecord(value);
	if (!record || Object.keys(record).length > MAX_NAMED_VALUES) return null;
	const result: Record<string, string> = Object.create(null);
	let totalBytes = 0;
	for (const [name, secret] of Object.entries(record)) {
		const nameBytes = utf8Encoder.encode(name).byteLength;
		const secretBytes =
			typeof secret === "string"
				? utf8Encoder.encode(secret).byteLength
				: Number.POSITIVE_INFINITY;
		totalBytes += nameBytes + secretBytes;
		if (
			!/^[A-Za-z0-9_.-]+$/.test(name) ||
			typeof secret !== "string" ||
			secretBytes > MAX_SECRET_VALUE_BYTES ||
			totalBytes > MAX_TOTAL_SECRET_BYTES
		) {
			return null;
		}
		result[name] = secret;
	}
	return Object.freeze(result);
}

function normalizeBindings(value: unknown): SandboxBindings | null {
	const record = snapshotDataRecord(value);
	if (
		!record ||
		!exactOrOptionalKeys(record, ["url", "token"], []) ||
		typeof record.url !== "string" ||
		record.url.length === 0 ||
		utf8Encoder.encode(record.url).byteLength > MAX_BINDINGS_URL_BYTES ||
		typeof record.token !== "string" ||
		record.token.length === 0 ||
		utf8Encoder.encode(record.token).byteLength > MAX_BINDINGS_TOKEN_BYTES
	) {
		return null;
	}
	if (!URL.canParse(record.url)) return null;
	return Object.freeze({ url: record.url, token: record.token });
}

interface JsonSnapshotBudget {
	nodes: number;
	bytes: number;
}

function consumeJsonBudget(budget: JsonSnapshotBudget, bytes: number): boolean {
	budget.nodes += 1;
	budget.bytes += bytes;
	return budget.nodes <= MAX_INPUT_NODES && budget.bytes <= MAX_INPUT_BYTES;
}

function snapshotJson(
	value: unknown,
	seen = new Set<object>(),
	budget: JsonSnapshotBudget = { nodes: 0, bytes: 0 },
	depth = 0,
): { ok: true; value: unknown } | { ok: false } {
	if (depth > MAX_INPUT_DEPTH) return { ok: false };
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		const bytes =
			typeof value === "string" ? utf8Encoder.encode(value).byteLength : 5;
		return consumeJsonBudget(budget, bytes)
			? { ok: true, value }
			: { ok: false };
	}
	if (typeof value === "number") {
		return Number.isFinite(value) && consumeJsonBudget(budget, 24)
			? { ok: true, value }
			: { ok: false };
	}
	if (typeof value !== "object" || seen.has(value)) return { ok: false };
	if (!consumeJsonBudget(budget, 2)) return { ok: false };
	seen.add(value);

	if (Array.isArray(value)) {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
		const arrayLength =
			lengthDescriptor && "value" in lengthDescriptor
				? lengthDescriptor.value
				: null;
		if (
			typeof arrayLength !== "number" ||
			!Number.isInteger(arrayLength) ||
			arrayLength < 0 ||
			arrayLength > MAX_INPUT_NODES ||
			Object.keys(descriptors).some(
				(key) => key !== "length" && !/^(0|[1-9]\d*)$/.test(key),
			)
		) {
			return { ok: false };
		}
		const result: unknown[] = [];
		for (let index = 0; index < arrayLength; index += 1) {
			const descriptor = descriptors[String(index)];
			if (!descriptor) {
				if (!consumeJsonBudget(budget, 4)) return { ok: false };
				result.push(null);
				continue;
			}
			if (!descriptor.enumerable || !("value" in descriptor)) {
				return { ok: false };
			}
			const item = snapshotJson(descriptor.value, seen, budget, depth + 1);
			if (!item.ok) return item;
			result.push(item.value);
		}
		seen.delete(value);
		return { ok: true, value: Object.freeze(result) };
	}

	const record = snapshotDataRecord(value);
	if (!record) return { ok: false };
	const result: Record<string, unknown> = Object.create(null);
	for (const [key, itemValue] of Object.entries(record)) {
		if (!consumeJsonBudget(budget, utf8Encoder.encode(key).byteLength)) {
			return { ok: false };
		}
		const item = snapshotJson(itemValue, seen, budget, depth + 1);
		if (!item.ok) return item;
		result[key] = item.value;
	}
	seen.delete(value);
	return { ok: true, value: Object.freeze(result) };
}

export function snapshotSandboxWorkloadPolicy(
	value: unknown,
	now = new Date(),
): SandboxWorkloadPolicy | null {
	try {
		const policy = snapshotDataRecord(value);
		if (
			!policy ||
			!exactOrOptionalKeys(
				policy,
				["source", "capabilities"],
				["input", "secrets", "bindings", "validUntil"],
			) ||
			typeof policy.source !== "string" ||
			policy.source.length === 0 ||
			new TextEncoder().encode(policy.source).byteLength > MAX_SOURCE_BYTES
		) {
			return null;
		}
		const capabilities = normalizeCapabilities(policy.capabilities);
		const secrets = normalizeSecrets(policy.secrets ?? {});
		const bindings =
			policy.bindings === undefined
				? undefined
				: normalizeBindings(policy.bindings);
		if (
			!capabilities ||
			!secrets ||
			(policy.bindings !== undefined && !bindings)
		) {
			return null;
		}
		if (
			policy.validUntil !== undefined &&
			(typeof policy.validUntil !== "string" ||
				!Number.isFinite(Date.parse(policy.validUntil)) ||
				Date.parse(policy.validUntil) <= now.getTime())
		) {
			return null;
		}
		const input = snapshotJson(policy.input ?? null);
		if (!input.ok) return null;
		return Object.freeze({
			source: policy.source,
			input: input.value,
			capabilities,
			secrets,
			...(bindings ? { bindings } : {}),
			...(typeof policy.validUntil === "string"
				? { validUntil: policy.validUntil }
				: {}),
		});
	} catch {
		return null;
	}
}

export function serializeSandboxWorkloadPolicy(
	policy: SandboxWorkloadPolicy,
): string {
	return JSON.stringify({
		source: policy.source,
		input: policy.input ?? null,
		capabilities: policy.capabilities,
		secrets: policy.secrets ?? {},
		...(policy.bindings ? { bindings: policy.bindings } : {}),
		...(policy.validUntil ? { validUntil: policy.validUntil } : {}),
	});
}

export function parseSandboxRunRequest(
	value: unknown,
): SandboxRunRequest | null {
	try {
		const request = snapshotDataRecord(value);
		if (
			!request ||
			!exactOrOptionalKeys(
				request,
				["mode", "source", "input", "capabilities"],
				["secrets", "bindings"],
			) ||
			(request.mode !== "host" && request.mode !== "workload") ||
			typeof request.source !== "string" ||
			request.source.length === 0 ||
			utf8Encoder.encode(request.source).byteLength > MAX_SOURCE_BYTES
		) {
			return null;
		}
		const input = snapshotJson(request.input);
		const capabilities = normalizeCapabilities(request.capabilities);
		const secrets = normalizeSecrets(request.secrets ?? {});
		const bindings =
			request.bindings === undefined
				? undefined
				: normalizeBindings(request.bindings);
		if (
			!input.ok ||
			!capabilities ||
			!secrets ||
			(request.bindings !== undefined && !bindings)
		) {
			return null;
		}
		return Object.freeze({
			mode: request.mode,
			source: request.source,
			input: input.value,
			capabilities,
			secrets,
			...(bindings ? { bindings } : {}),
		});
	} catch {
		return null;
	}
}
