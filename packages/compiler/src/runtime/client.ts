import { canonicalBytes, compareAscii } from "../canonical";
import type { NormalizedResource } from "../types";
import type { RealtimeWireContractV1 } from "./realtime-wire";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("expected an object while rendering declarations");
	return value as RecordValue;
}

export function renderCodecType(
	value: unknown,
	timestampType: "Date" | "string" = "Date",
): string {
	const descriptor = record(value);
	if (descriptor.kind === "nullable")
		return `${renderCodecType(descriptor.codec, timestampType)} | null`;
	if (descriptor.kind === "optional")
		return renderCodecType(descriptor.codec, timestampType);
	if (descriptor.kind === "array")
		return `ReadonlyArray<${renderCodecType(descriptor.items, timestampType)}>`;
	if (descriptor.kind === "uuid" || descriptor.kind === "text") return "string";
	if (descriptor.kind === "boolean") return "boolean";
	if (descriptor.kind === "integer") return "number";
	if (descriptor.kind === "timestamp") return timestampType;
	if (descriptor.kind === "object") {
		const properties = Object.entries(record(descriptor.properties))
			.sort(([left], [right]) => compareAscii(left, right))
			.map(([key, child]) => {
				const childDescriptor = record(child);
				return `readonly ${JSON.stringify(key)}${childDescriptor.kind === "optional" ? "?" : ""}: ${renderCodecType(child, timestampType)};`;
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
		realtime?: RealtimeWireContractV1;
	}>,
): string {
	const queries = resources.filter(
		(resource) =>
			resource.kind === "query" && resource.contract.exposure === "network",
	);
	const mutations = resources.filter(
		(resource) =>
			resource.kind === "mutation" && resource.contract.exposure === "network",
	);
	const watchableQueries = new Set(
		input.realtime?.watchableQueries.map(({ identity }) => identity) ?? [],
	);
	const declarations = queries
		.map((resource) => {
			const operationInput = renderCodecType(resource.contract.input);
			const operationOutput = renderCodecType(resource.contract.output);
			return watchableQueries.has(resource.identity)
				? `${JSON.stringify(resource.name)}: WatchableQueryMethod<${operationInput}, ${operationOutput}>;`
				: `${JSON.stringify(resource.name)}(operationInput: ${operationInput}, options?: CallOptions): Promise<${operationOutput}>;`;
		})
		.join("\n\t\t");
	const implementations = queries
		.map((resource) => {
			const operationInput = renderCodecType(resource.contract.input);
			const operationOutput = renderCodecType(resource.contract.output);
			const call = `(operationInput: ${operationInput}, options?: CallOptions): Promise<${operationOutput}> => invoke<${operationOutput}>(context, ${JSON.stringify(resource.identity)}, operationInput, options)`;
			return watchableQueries.has(resource.identity)
				? `${JSON.stringify(resource.name)}: Object.assign(${call}, { watch: (operationInput: ${operationInput}, callback: (result: ${operationOutput}, delivery: QueryDelivery) => void, options?: WatchOptions): (() => void) => watchBinding<${operationOutput}>(${JSON.stringify(resource.identity)}, operationInput, callback, options) }),`
				: `${JSON.stringify(resource.name)}: ${call},`;
		})
		.join("\n\t\t\t");
	const mutationDeclarations = mutations
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}(operationInput: ${renderCodecType(resource.contract.input)}, options?: CallOptions): Promise<${renderCodecType(resource.contract.output)}>;`,
		)
		.join("\n\t\t");
	const mutationImplementations = mutations
		.map((resource) => {
			const operationInput = renderCodecType(resource.contract.input);
			const operationOutput = renderCodecType(resource.contract.output);
			return `${JSON.stringify(resource.name)}: (operationInput: ${operationInput}, options?: CallOptions): Promise<${operationOutput}> => invoke<${operationOutput}>(context, ${JSON.stringify(resource.identity)}, operationInput, options),`;
		})
		.join("\n\t\t\t");
	const outputCodecs = Object.fromEntries(
		[...queries, ...mutations].map((resource) => [
			resource.identity,
			resource.contract.output,
		]),
	);
	const declaredErrorContracts = Object.fromEntries(
		[...queries, ...mutations].map((resource) => [
			resource.identity,
			Object.values(record(resource.contract.declaredErrors ?? {})).map(
				(error) => {
					const contract = record(error);
					return {
						code: String(contract.code),
						status: contract.status,
						payload: contract.payload,
					};
				},
			),
		]),
	);
	const mutationOperations = mutations.map((resource) => resource.identity);
	const watchTypes =
		watchableQueries.size === 0
			? ""
			: `
export type QueryDelivery =
	| Readonly<{ readonly kind: "initial" }>
	| Readonly<{ readonly kind: "update" }>
	| Readonly<{ readonly kind: "reset"; readonly reason: "authority-changed" | "deployment-changed" | "resume-unavailable" }>;

export type WatchState =
	| Readonly<{ readonly kind: "connected" }>
	| Readonly<{ readonly kind: "reconnecting"; readonly attempt: number }>;

export type WatchFailure = Readonly<{
	readonly code: "AUTHORIZATION_FAILED" | "OUTPUT_INVALID" | "RESOURCE_LIMIT" | "TRANSPORT_FAILED" | "VERSION_INCOMPATIBLE";
}>;

export interface WatchOptions {
	readonly signal?: AbortSignal;
	readonly onStateChange?: (state: WatchState) => void;
	readonly onError?: (error: WatchFailure) => void;
}

export interface WatchableQueryMethod<Input, Output> {
	(input: Input, options?: CallOptions): Promise<Output>;
	watch(input: Input, callback: (result: Output, delivery: QueryDelivery) => void, options?: WatchOptions): () => void;
}
`;
	const realtimeTypes =
		watchableQueries.size === 0
			? ""
			: `
type RealtimeBinding = {
	readonly query: string;
	readonly input: unknown;
	readonly callback: (result: unknown, delivery: QueryDelivery) => void;
	readonly options: WatchOptions;
	resumeToken: string | null;
};
`;
	const realtimeScope =
		input.realtime === undefined
			? ""
			: `
		const scopeId = crypto.randomUUID();
		const bindings = new Map<string, RealtimeBinding>();
		let streamStarted = false;
		let streamReady = false;
		let streamAbort: AbortController | undefined;
		let reconnectAttempt = 0;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		const command = async (body: WireRecord): Promise<void> => {
			const response = await transport(new Request(new URL(${JSON.stringify(input.realtime.path)}, input.baseUrl), {
				method: "POST",
				headers: { "content-type": ${JSON.stringify(input.realtime.commandMediaType)} },
				body: JSON.stringify(body),
			}));
			if (response.status !== 202) protocolFailure();
		};
		const commandBase = Object.freeze({ protocol: ${canonicalBytes(input.realtime.protocol).trim()}, application: ${JSON.stringify(input.application)}, clientContractDigest: ${JSON.stringify(input.clientContractDigest)}, realtimeWireDigest: ${JSON.stringify(input.realtime.digest)}, scopeId });
		const openBinding = (bindingId: string, binding: RealtimeBinding): void => {
			void command({ ...commandBase, command: "open", bindingId, context, input: binding.input, query: binding.query, resumeToken: binding.resumeToken }).catch(() => binding.options.onError?.(Object.freeze({ code: "TRANSPORT_FAILED" })));
		};
		const consumeFrame = async (value: unknown): Promise<void> => {
			const frame = wireRecord(value);
			const protocol = wireRecord(frame.protocol);
			exactKeys(protocol, ["name", "version"]);
			if (protocol.name !== "questpie.realtime" || protocol.version !== 1) protocolFailure();
			if (frame.kind === "ready") {
				exactKeys(frame, ["kind", "protocol", "scopeId"]);
				if (frame.scopeId !== scopeId) protocolFailure();
				streamReady = true;
				reconnectAttempt = 0;
				for (const [bindingId, binding] of bindings) {
					binding.options.onStateChange?.(Object.freeze({ kind: "connected" }));
					openBinding(bindingId, binding);
				}
				return;
			}
			if (frame.kind === "delivery") {
				exactKeys(frame, ["bindingId", "delivery", "kind", "payload", "protocol", "query", "resetReason", "resumeToken"]);
				if (typeof frame.bindingId !== "string" || typeof frame.query !== "string" || typeof frame.resumeToken !== "string") protocolFailure();
				const binding = bindings.get(frame.bindingId);
				if (!binding || binding.query !== frame.query || !["initial", "reset", "update"].includes(String(frame.delivery))) protocolFailure();
				const result = decode(outputCodecs[binding.query], frame.payload);
				const delivery = frame.delivery === "reset"
					? ["authority-changed", "deployment-changed", "resume-unavailable"].includes(String(frame.resetReason))
						? Object.freeze({ kind: "reset" as const, reason: frame.resetReason as "authority-changed" | "deployment-changed" | "resume-unavailable" })
						: protocolFailure()
					: frame.resetReason === null
						? Object.freeze({ kind: frame.delivery as "initial" | "update" })
						: protocolFailure();
				binding.callback(result, delivery);
				binding.resumeToken = frame.resumeToken;
				await command({ ...commandBase, command: "ack", bindingId: frame.bindingId, resumeToken: frame.resumeToken });
				return;
			}
			if (frame.kind === "failure") {
				exactKeys(frame, ["bindingId", "error", "kind", "protocol", "query"]);
				if (typeof frame.bindingId !== "string" || typeof frame.query !== "string") protocolFailure();
				const binding = bindings.get(frame.bindingId);
				const error = wireRecord(frame.error);
				exactKeys(error, ["code"]);
				if (!binding || binding.query !== frame.query || !["AUTHORIZATION_FAILED", "OUTPUT_INVALID", "RESOURCE_LIMIT", "TRANSPORT_FAILED", "VERSION_INCOMPATIBLE"].includes(String(error.code))) protocolFailure();
				binding.options.onError?.(Object.freeze({ code: error.code as WatchFailure["code"] }));
				return;
			}
			if (frame.kind === "closed") {
				exactKeys(frame, ["kind", "protocol", "reason", "retryable", "scopeId"]);
				if (frame.scopeId !== scopeId || typeof frame.retryable !== "boolean") protocolFailure();
				throw Object.assign(new Error("REALTIME_CLOSED"), { retryable: frame.retryable });
			}
			protocolFailure();
		};
		const scheduleReconnect = (): void => {
			if (bindings.size === 0 || reconnectTimer !== undefined) return;
			reconnectAttempt += 1;
			for (const binding of bindings.values()) binding.options.onStateChange?.(Object.freeze({ kind: "reconnecting", attempt: reconnectAttempt }));
			reconnectTimer = setTimeout(() => {
				reconnectTimer = undefined;
				ensureStream();
			}, Math.min(250 * 2 ** (reconnectAttempt - 1), 5_000));
		};
		const ensureStream = (): void => {
			if (streamStarted) return;
			streamStarted = true;
			streamAbort = new AbortController();
			void (async () => {
				const response = await transport(new Request(new URL(${JSON.stringify(input.realtime.path)}, input.baseUrl), {
					method: "GET",
					headers: { accept: ${JSON.stringify(input.realtime.streamMediaType)}, "x-questpie-realtime-scope": scopeId },
					signal: streamAbort?.signal,
				}));
				if (response.status !== 200 || response.headers.get("content-type") !== ${JSON.stringify(input.realtime.streamMediaType)} || !response.body) protocolFailure();
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffered = "";
				while (true) {
					const part = await reader.read();
					buffered += decoder.decode(part.value, { stream: !part.done });
					if (new TextEncoder().encode(buffered).byteLength > ${input.realtime.limits.bufferedBytesPerClient}) throw new Error("RESOURCE_LIMIT");
					let boundary: number;
					while ((boundary = buffered.indexOf("\\n\\n")) >= 0) {
						const event = buffered.slice(0, boundary);
						buffered = buffered.slice(boundary + 2);
						const data = event.split("\\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\\n");
						if (data.length > 0) await consumeFrame(JSON.parse(data));
					}
					if (part.done) break;
				}
			})().then(() => {
				if (!streamAbort?.signal.aborted) scheduleReconnect();
			}).catch((error: unknown) => {
				if (streamAbort?.signal.aborted) return;
				if (error instanceof Error && error.message === "PROTOCOL_UNSUPPORTED") {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "VERSION_INCOMPATIBLE" }));
					return;
				}
				if (error instanceof Error && error.message === "RESOURCE_LIMIT") {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "RESOURCE_LIMIT" }));
					return;
				}
				if (error instanceof Error && (error as Error & { retryable?: boolean }).retryable === false) {
					for (const binding of bindings.values()) binding.options.onError?.(Object.freeze({ code: "TRANSPORT_FAILED" }));
					return;
				}
				scheduleReconnect();
			}).finally(() => { streamStarted = false; streamReady = false; });
		};
		const watchBinding = <Result>(query: string, operationInput: unknown, callback: (result: Result, delivery: QueryDelivery) => void, options: WatchOptions = {}): (() => void) => {
			const bindingId = crypto.randomUUID();
			const binding: RealtimeBinding = { query, input: structuredClone(operationInput), callback: callback as RealtimeBinding["callback"], options, resumeToken: null };
			bindings.set(bindingId, binding);
			ensureStream();
			if (streamReady) openBinding(bindingId, binding);
			let closed = false;
			const close = (): void => {
				if (closed) return;
				closed = true;
				bindings.delete(bindingId);
				const closing = command({ ...commandBase, command: "close", bindingId }).catch(() => undefined);
				if (bindings.size === 0) {
					void closing.finally(() => {
						if (bindings.size !== 0) return;
						streamAbort?.abort();
						if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
						reconnectTimer = undefined;
						streamStarted = false;
						streamReady = false;
					});
				}
			};
			if (options.signal?.aborted) close();
			else options.signal?.addEventListener("abort", close, { once: true });
			return close;
		};`;
	return `import type { AppContextInput } from "./app";

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}
${watchTypes}

export interface GeneratedClientScope {
	readonly context: AppContextInput;
	readonly queries: Readonly<{
		${declarations}
	}>;
	readonly mutations: Readonly<{
		${mutationDeclarations}
	}>;
	withContext(input: AppContextInput): GeneratedClientScope;
}

export interface GeneratedClient {
	withContext(input: AppContextInput): GeneratedClientScope;
}

export class CommittedResultUnavailable extends Error {
	readonly name = "CommittedResultUnavailable" as const;
	readonly code = "COMMITTED_RESULT_UNAVAILABLE" as const;
	readonly retryable = true as const;
	readonly payload: Readonly<{ readonly callId: string; readonly transactionId: string }>;
	constructor(callId: string, transactionId: string) {
		super("COMMITTED_RESULT_UNAVAILABLE");
		this.payload = Object.freeze({ callId, transactionId });
		Object.freeze(this);
	}
}

type WireRecord = Readonly<Record<string, unknown>>;
${realtimeTypes}
const outputCodecs: WireRecord = ${canonicalBytes(outputCodecs).trim()};
const declaredErrorContracts: WireRecord = ${canonicalBytes(declaredErrorContracts).trim()};
const mutationOperations = new Set<string>(${canonicalBytes(mutationOperations).trim()});
const failureCodes = new Set([
	"APPLICATION_MISMATCH", "CLIENT_OUTDATED", "COMMITTED_RESULT_UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL",
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
function isCallIdentity(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\\0")) return false;
	let scalars = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			if (index + 1 >= value.length) return false;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
		scalars += 1;
		if (scalars > 256) return false;
	}
	return value === value.normalize("NFC") && new TextEncoder().encode(value).byteLength <= 1024;
}
function isTransactionIdentity(value: unknown): value is string {
	return typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= 18446744073709551615n;
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
		return new Date(value);
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
		if (!isCallIdentity(callId)) protocolFailure();
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
			if (detail.code === "COMMITTED_RESULT_UNAVAILABLE") {
				if (rejection) protocolFailure();
				exactKeys(detail, ["code", "retryable", "transactionId"]);
				if (!mutationOperations.has(operation) || detail.retryable !== true || response.status !== 500 || !isTransactionIdentity(detail.transactionId)) protocolFailure();
				throw new CommittedResultUnavailable(callId, detail.transactionId);
			}
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
			const allowed = declaredErrorContracts[operation];
			if (!Array.isArray(allowed)) protocolFailure();
			const contract = allowed.map(wireRecord).find((candidate) => candidate.code === detail.code);
			if (!contract || detail.status !== contract.status || response.status !== contract.status) protocolFailure();
			const payload = contract.payload === null
				? detail.payload === null ? null : protocolFailure()
				: decode(contract.payload, detail.payload);
			throw Object.assign(new Error(detail.code), { code: detail.code, status: detail.status, payload });
		}
		return protocolFailure();
	};
	const scope = (next: AppContextInput): GeneratedClientScope => {
		const context = immutableContext(next);
		${realtimeScope}
		return Object.freeze({ context, queries: Object.freeze({
			${implementations}
		}), mutations: Object.freeze({
			${mutationImplementations}
		}), withContext: scope });
	};
	return Object.freeze({ withContext: scope });
}
`;
}
