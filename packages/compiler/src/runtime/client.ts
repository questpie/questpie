import { canonicalBytes, compareAscii } from "../canonical";
import type { NormalizedResource } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an object while rendering declarations");
	return value as RecordValue;
}

export function renderCodecType(value: unknown): string {
	const descriptor = record(value);
	if (descriptor.kind === "nullable")
		return `${renderCodecType(descriptor.codec)} | null`;
	if (descriptor.kind === "optional") return renderCodecType(descriptor.codec);
	if (descriptor.kind === "array")
		return `ReadonlyArray<${renderCodecType(descriptor.items)}>`;
	if (descriptor.kind === "uuid" || descriptor.kind === "text") return "string";
	if (descriptor.kind === "boolean") return "boolean";
	if (descriptor.kind === "integer") return "number";
	if (descriptor.kind === "timestamp") return "string";
	if (descriptor.kind === "object") {
		const properties = Object.entries(record(descriptor.properties))
			.sort(([left], [right]) => compareAscii(left, right))
			.map(([key, child]) => {
				const childDescriptor = record(child);
				return `readonly ${JSON.stringify(key)}${childDescriptor.kind === "optional" ? "?" : ""}: ${renderCodecType(child)};`;
			})
			.join(" ");
		return `Readonly<{ ${properties} }>`;
	}
	return "never";
}

export function renderClientContract(
	resources: readonly NormalizedResource[],
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		wireDigest: string;
		path: string;
		mediaType: string;
	}>,
): string {
	const queries = resources.filter(
		(resource) =>
			resource.kind === "query" && resource.contract.exposure === "network",
	);
	const declarations = queries
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}(operationInput: ${renderCodecType(resource.contract.input)}, options?: CallOptions): Promise<${renderCodecType(resource.contract.output)}>;`,
		)
		.join("\n\t\t");
	const implementations = queries
		.map((resource) => {
			const operationInput = renderCodecType(resource.contract.input);
			const operationOutput = renderCodecType(resource.contract.output);
			return `${JSON.stringify(resource.name)}: (operationInput: ${operationInput}, options?: CallOptions): Promise<${operationOutput}> => invoke<${operationOutput}>(context, ${JSON.stringify(resource.identity)}, operationInput, options),`;
		})
		.join("\n\t\t\t");
	const outputCodecs = Object.fromEntries(
		queries.map((resource) => [resource.identity, resource.contract.output]),
	);
	return `import type { AppContextInput } from "./app";

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}

export interface GeneratedClientScope {
	readonly context: AppContextInput;
	readonly queries: Readonly<{
		${declarations}
	}>;
	withContext(input: AppContextInput): GeneratedClientScope;
}

export interface GeneratedClient {
	withContext(input: AppContextInput): GeneratedClientScope;
}

type WireRecord = Readonly<Record<string, unknown>>;
const outputCodecs: WireRecord = ${canonicalBytes(outputCodecs).trim()};
const failureCodes = new Set([
	"APPLICATION_MISMATCH", "CLIENT_OUTDATED", "DEADLINE_EXCEEDED", "INTERNAL",
	"NOT_FOUND", "PROTOCOL_UNSUPPORTED", "RESOURCE_LIMIT", "RUNTIME_UNAVAILABLE",
]);

function protocolFailure(): never { throw new Error("PROTOCOL_UNSUPPORTED"); }
function wireRecord(value: unknown): WireRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) return protocolFailure();
	return value as WireRecord;
}
function exactKeys(value: WireRecord, expected: readonly string[]): void {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index]))
		protocolFailure();
}
function decode(codecValue: unknown, value: unknown): unknown {
	const descriptor = wireRecord(codecValue);
	if (descriptor.kind === "nullable")
		return value === null ? null : decode(descriptor.codec, value);
	if (descriptor.kind === "optional") return decode(descriptor.codec, value);
	if (descriptor.kind === "array") {
		if (!Array.isArray(value)) return protocolFailure();
		return value.map((item) => decode(descriptor.items, item));
	}
	if (descriptor.kind === "boolean") {
		if (typeof value !== "boolean") return protocolFailure();
		return value;
	}
	if (descriptor.kind === "integer") {
		if (typeof value !== "number" || !Number.isSafeInteger(value)) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "text") {
		if (typeof value !== "string" || value !== value.normalize("NFC")) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "timestamp") {
		if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$/.test(value)) return protocolFailure();
		try { if (new Date(value).toISOString() !== value) return protocolFailure(); }
		catch { return protocolFailure(); }
		return value;
	}
	if (descriptor.kind === "uuid") {
		if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "object") {
		const source = wireRecord(value);
		const properties = wireRecord(descriptor.properties);
		const optional = new Set(Object.keys(properties).filter((key) => wireRecord(properties[key]).kind === "optional"));
		if (Object.keys(source).some((key) => !Object.hasOwn(properties, key))) return protocolFailure();
		if (Object.keys(properties).some((key) => !optional.has(key) && !Object.hasOwn(source, key))) return protocolFailure();
		return Object.freeze(Object.fromEntries(Object.keys(source).sort().map((key) => [key, decode(properties[key], source[key])])));
	}
	return protocolFailure();
}
function verifyCorrelation(frame: WireRecord, operation: string, callId: string): void {
	const protocol = wireRecord(frame.protocol);
	exactKeys(protocol, ["name", "version"]);
	if (protocol.name !== "questpie.operation" || protocol.version !== 1 || frame.operation !== operation || frame.callId !== callId)
		protocolFailure();
}
function immutableContext(input: AppContextInput): AppContextInput {
	const context = structuredClone(input);
	const pending: object[] = [context];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || Object.isFrozen(current)) continue;
		for (const child of Object.values(current)) if (child && typeof child === "object") pending.push(child);
		Object.freeze(current);
	}
	return context;
}

export function createClient(input: Readonly<{
	readonly baseUrl: string;
	readonly fetch?: typeof globalThis.fetch;
}>): GeneratedClient {
	const transport = input.fetch ?? globalThis.fetch;
	const invoke = async <Result>(context: AppContextInput, operation: string, operationInput: unknown, options: CallOptions = {}): Promise<Result> => {
		const callId = options.callId ?? crypto.randomUUID();
		const response = await transport(new Request(new URL(${JSON.stringify(input.path)}, input.baseUrl), {
			method: "POST",
			headers: { "content-type": ${JSON.stringify(input.mediaType)} },
			body: JSON.stringify({ protocol: { name: "questpie.operation", version: 1 }, application: ${JSON.stringify(input.application)}, clientContractDigest: ${JSON.stringify(input.clientContractDigest)}, wireDigest: ${JSON.stringify(input.wireDigest)}, operation, callId, context, input: operationInput, timeoutMilliseconds: options.timeoutMilliseconds ?? 5_000 }),
			...(options.signal === undefined ? {} : { signal: options.signal }),
		}));
		if (response.headers.get("content-type") !== ${JSON.stringify(input.mediaType)}) protocolFailure();
		const frame = wireRecord(await response.json());
		if (frame.kind === "result") {
			exactKeys(frame, ["callId", "kind", "operation", "payload", "protocol"]);
			verifyCorrelation(frame, operation, callId);
			return decode(outputCodecs[operation], frame.payload) as Result;
		}
		if (frame.kind === "failure") {
			const rejection = Object.keys(frame).length === 2;
			exactKeys(frame, rejection ? ["error", "kind"] : ["callId", "error", "kind", "operation", "protocol"]);
			if (!rejection) verifyCorrelation(frame, operation, callId);
			const detail = wireRecord(frame.error);
			exactKeys(detail, ["code", "retryable"]);
			if (typeof detail.code !== "string" || !failureCodes.has(detail.code) || typeof detail.retryable !== "boolean") protocolFailure();
			throw Object.assign(new Error(detail.code), detail);
		}
		if (frame.kind === "declaredError") {
			exactKeys(frame, ["callId", "error", "kind", "operation", "protocol"]);
			verifyCorrelation(frame, operation, callId);
			const detail = wireRecord(frame.error);
			exactKeys(detail, ["code", "payload", "status"]);
			if (typeof detail.code !== "string" || typeof detail.status !== "number") protocolFailure();
			throw Object.assign(new Error(detail.code), detail);
		}
		return protocolFailure();
	};
	const scope = (next: AppContextInput): GeneratedClientScope => {
		const context = immutableContext(next);
		return Object.freeze({ context, queries: Object.freeze({
			${implementations}
		}), withContext: scope });
	};
	return Object.freeze({ withContext: scope });
}
`;
}
