import { canonicalBytes, compareAscii } from "../canonical";
import type { NormalizedResource } from "../types";
import { renderClientQueryHttp } from "./client-query-http";
import { renderClientQueryResource } from "./client-query-resource";
import { renderClientRealtime } from "./client-realtime";
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
	if (
		descriptor.kind === "cursor" ||
		descriptor.kind === "uuid" ||
		descriptor.kind === "text"
	)
		return "string";
	if (
		descriptor.kind === "bigint" ||
		descriptor.kind === "numeric" ||
		descriptor.kind === "date"
	)
		return "string";
	if (descriptor.kind === "json") return "TaggedJsonValue";
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
		contextCodec?: unknown;
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
	const actions = resources.filter(
		(resource) =>
			resource.kind === "action" && resource.contract.exposure === "network",
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
				? `${JSON.stringify(resource.name)}: Object.assign(${call}, { watch: (operationInput: ${operationInput}, callback: (result: ${operationOutput}, delivery: QueryDelivery) => void, options?: WatchOptions): (() => void) => watchBinding<${operationOutput}>(${JSON.stringify(resource.identity)}, operationInput, callback, options), observe: (operationInput: ${operationInput}): QueryResource<${operationOutput}> => queryResources.observe<${operationOutput}>(${JSON.stringify(resource.identity)}, encode(inputCodecs[${JSON.stringify(resource.identity)}], operationInput)) }),`
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
	const actionDeclarations = actions
		.map(
			(resource) =>
				`${JSON.stringify(resource.name)}(operationInput: ${renderCodecType(resource.contract.input)}, options: ActionCallOptions): Promise<${renderCodecType(resource.contract.output)}>;`,
		)
		.join("\n\t\t");
	const actionImplementations = actions
		.map((resource) => {
			const operationInput = renderCodecType(resource.contract.input);
			const operationOutput = renderCodecType(resource.contract.output);
			return `${JSON.stringify(resource.name)}: (operationInput: ${operationInput}, options: ActionCallOptions): Promise<${operationOutput}> => invoke<${operationOutput}>(context, ${JSON.stringify(resource.identity)}, operationInput, options),`;
		})
		.join("\n\t\t\t");
	const outputCodecs = Object.fromEntries(
		[...queries, ...mutations, ...actions].map((resource) => [
			resource.identity,
			resource.contract.output,
		]),
	);
	const inputCodecs = Object.fromEntries(
		[...queries, ...mutations, ...actions].map((resource) => [
			resource.identity,
			resource.contract.input,
		]),
	);
	const declaredErrorContracts = Object.fromEntries(
		[...queries, ...mutations, ...actions].map((resource) => [
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
	const actionOperations = actions.map((resource) => resource.identity);
	const queryOperations = queries.map((resource) => resource.identity);
	const { watchTypes, realtimeTypes, realtimeScope } = renderClientRealtime({
		application: input.application,
		clientContractDigest: input.clientContractDigest,
		enabled: watchableQueries.size > 0,
		realtime: input.realtime,
	});
	const queryResource = renderClientQueryResource(watchableQueries.size > 0);
	return `import type { AppContextInput } from "./app";

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };

export interface TaggedJsonValue {
	readonly kind: "json";
	readonly value: JsonValue;
}

export interface CallOptions {
	readonly callId?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMilliseconds?: number;
}
export interface ActionCallOptions extends CallOptions {
	readonly effectKey: string;
}
${watchTypes}
${queryResource.types}

export interface GeneratedClientScope {
	readonly context: AppContextInput;
	readonly queries: Readonly<{
		${declarations}
	}>;
	readonly mutations: Readonly<{
		${mutationDeclarations}
	}>;
	readonly actions: Readonly<{
		${actionDeclarations}
	}>;
	withContext(input: AppContextInput): GeneratedClientScope;
}

export interface GeneratedClient {
	withContext(input: AppContextInput): GeneratedClientScope;
}

type FetchTransport = (request: Request) => Promise<Response>;

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

export class ActionOutcomeAmbiguous extends Error {
	readonly name = "ActionOutcomeAmbiguous" as const;
	readonly code = "ACTION_OUTCOME_AMBIGUOUS" as const;
	readonly retryable = false as const;
	readonly payload: Readonly<{ readonly callId: string }>;
	constructor(callId: string) {
		super("ACTION_OUTCOME_AMBIGUOUS");
		this.payload = Object.freeze({ callId });
		Object.freeze(this);
	}
}

type WireRecord = Readonly<Record<string, unknown>>;
${realtimeTypes}
${queryResource.runtime}
const inputCodecs: WireRecord = ${canonicalBytes(inputCodecs).trim()};
const outputCodecs: WireRecord = ${canonicalBytes(outputCodecs).trim()};
const declaredErrorContracts: WireRecord = ${canonicalBytes(declaredErrorContracts).trim()};
const contextCodec: WireRecord = ${canonicalBytes(input.contextCodec ?? { kind: "object", properties: {} }).trim()};
const queryOperations = new Set<string>(${canonicalBytes(queryOperations).trim()});
const mutationOperations = new Set<string>(${canonicalBytes(mutationOperations).trim()});
const actionOperations = new Set<string>(${canonicalBytes(actionOperations).trim()});
const failureCodes = new Set([
	"APPLICATION_MISMATCH", "CLIENT_OUTDATED", "COMMITTED_RESULT_UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL",
	"NOT_FOUND", "PROTOCOL_UNSUPPORTED", "RESOURCE_LIMIT", "RUNTIME_UNAVAILABLE",
]);

class ProtocolFailure extends Error {
	constructor() { super("PROTOCOL_UNSUPPORTED"); }
}
function protocolFailure(): never { throw new ProtocolFailure(); }
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
const publicErrorPrototype = Object.create(Error.prototype, {
	message: {
		configurable: false,
		get(this: WireRecord) { return typeof this.code === "string" ? this.code : ""; },
	},
});
function publicError(detail: WireRecord): Error & WireRecord {
	const error = Object.assign(new Error(), detail) as Error & WireRecord;
	Object.setPrototypeOf(error, publicErrorPrototype);
	for (const key of Object.getOwnPropertyNames(error))
		if (!Object.prototype.hasOwnProperty.call(detail, key)) delete (error as unknown as Record<string, unknown>)[key];
	return error;
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
function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}
function decodeJson(value: unknown, active = new Set<object>()): unknown {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0)) return protocolFailure();
		return value;
	}
	if (typeof value === "string") {
		if (hasLoneSurrogate(value) || value.normalize("NFC") !== value) return protocolFailure();
		return value;
	}
	if (!value || typeof value !== "object" || active.has(value)) return protocolFailure();
	active.add(value);
	try {
		if (Array.isArray(value)) {
			for (let index = 0; index < value.length; index += 1) if (!(index in value)) return protocolFailure();
			return Object.freeze(value.map((item) => decodeJson(item, active)));
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return protocolFailure();
		const source = value as WireRecord;
		const output: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(source).sort()) {
			if (hasLoneSurrogate(key) || key.normalize("NFC") !== key) return protocolFailure();
			output[key] = decodeJson(source[key], active);
		}
		return Object.freeze(output);
	} finally { active.delete(value); }
}
function transform(codecValue: unknown, value: unknown, direction: "decode" | "encode"): unknown {
	const descriptor = wireRecord(codecValue);
	if (descriptor.kind === "nullable")
		return value === null ? null : transform(descriptor.codec, value, direction);
	if (descriptor.kind === "optional")
		return direction === "decode"
			? transform(descriptor.codec, value, direction)
			: protocolFailure();
	if (descriptor.kind === "array") {
		if (!Array.isArray(value)) return protocolFailure();
		if (descriptor.maximum !== undefined && (!Number.isSafeInteger(descriptor.maximum) || Number(descriptor.maximum) < 1 || value.length > Number(descriptor.maximum))) return protocolFailure();
		const result = value.map((item) => transform(descriptor.items, item, direction));
		return direction === "encode" ? Object.freeze(result) : result;
	}
	if (descriptor.kind === "boolean") {
		if (typeof value !== "boolean") return protocolFailure();
		return value;
	}
	if (descriptor.kind === "integer") {
		if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)) return protocolFailure();
		if (descriptor.minimum !== undefined && value < Number(descriptor.minimum)) return protocolFailure();
		if (descriptor.maximum !== undefined && value > Number(descriptor.maximum)) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "bigint") {
		if (typeof value !== "string" || !/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) return protocolFailure();
		const parsed = BigInt(value);
		if (parsed < -9223372036854775808n || parsed > 9223372036854775807n) return protocolFailure();
		if (descriptor.minimum !== undefined && parsed < BigInt(String(descriptor.minimum))) return protocolFailure();
		if (descriptor.maximum !== undefined && parsed > BigInt(String(descriptor.maximum))) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "numeric") {
		const precision = Number(descriptor.precision);
		const scale = Number(descriptor.scale);
		if (!Number.isSafeInteger(precision) || precision < 1 || precision > 1000 || !Number.isSafeInteger(scale) || scale < 0 || scale > precision) return protocolFailure();
		const pattern = scale === 0 ? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/ : new RegExp("^(?:0|-[1-9][0-9]*|[1-9][0-9]*)\\\\.[0-9]{" + scale + "}$");
		if (typeof value !== "string" || !pattern.test(value) || value.replace(/[-.]/g, "").length > precision) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "cursor") {
		if (
			direction === "decode" ||
			typeof value !== "string" ||
			hasLoneSurrogate(value) ||
			value !== value.normalize("NFC")
		)
			return protocolFailure();
		return value;
	}
	if (descriptor.kind === "text") {
		if (typeof value !== "string" || hasLoneSurrogate(value) || value !== value.normalize("NFC")) return protocolFailure();
		const length = [...value].length;
		if (descriptor.minLength !== undefined && length < Number(descriptor.minLength)) return protocolFailure();
		if (descriptor.maxLength !== undefined && length > Number(descriptor.maxLength)) return protocolFailure();
		return value;
	}
	if (descriptor.kind === "timestamp") {
		if (direction === "encode") {
			if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
				return protocolFailure();
			const encoded = value.toISOString();
			return descriptor.withTimezone === false
				? encoded.slice(0, -1)
				: encoded;
		}
		const withTimezone = descriptor.withTimezone !== false;
		const pattern = withTimezone ? /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$/ : /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}$/;
		if (typeof value !== "string" || !pattern.test(value)) return protocolFailure();
		const comparable = withTimezone ? value : value + "Z";
		try { if (new Date(comparable).toISOString() !== comparable) return protocolFailure(); }
		catch { return protocolFailure(); }
		return new Date(comparable);
	}
	if (descriptor.kind === "date") {
		if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return protocolFailure();
		try { if (new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) !== value) return protocolFailure(); }
		catch { return protocolFailure(); }
		return value;
	}
	if (descriptor.kind === "json") {
		const tagged = wireRecord(value);
		exactKeys(tagged, ["kind", "value"]);
		if (tagged.kind !== "json") return protocolFailure();
		return Object.freeze({ kind: "json", value: decodeJson(tagged.value) });
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
		if (direction === "decode")
			return Object.freeze(
				Object.fromEntries(
					Object.keys(source)
						.sort()
						.map((key) => [
							key,
							transform(properties[key], source[key], direction),
						]),
				),
			);
		const output: Record<string, unknown> = Object.create(null);
		for (const key of Object.keys(properties).sort()) {
			const child = wireRecord(properties[key]);
			if (child.kind === "optional") {
				if (Object.hasOwn(source, key))
					output[key] = transform(child.codec, source[key], direction);
				continue;
			}
			output[key] = transform(child, source[key], direction);
		}
		return Object.freeze(output);
	}
	return protocolFailure();
}
function decode(codecValue: unknown, value: unknown): unknown {
	return transform(codecValue, value, "decode");
}
function encode(codecValue: unknown, value: unknown): unknown {
	return transform(codecValue, value, "encode");
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
${renderClientQueryHttp(input)}

export function createClient(input: Readonly<{
	readonly baseUrl: string;
	readonly fetch?: typeof globalThis.fetch;
}>): GeneratedClient {
	const transport: FetchTransport =
		input.fetch ?? ((request) => globalThis.fetch(request));
	const invoke = async <Result>(context: AppContextInput, operation: string, operationInput: unknown, options: CallOptions | ActionCallOptions = {}): Promise<Result> => {
		const callId = options.callId ?? crypto.randomUUID();
		if (!isCallIdentity(callId)) protocolFailure();
		const action = actionOperations.has(operation);
		if (action) {
			const optionKeys = Object.keys(options).sort();
			if (!optionKeys.includes("effectKey") || optionKeys.some((key) => !["callId", "effectKey", "signal", "timeoutMilliseconds"].includes(key))) protocolFailure();
			if (!isCallIdentity((options as ActionCallOptions).effectKey)) protocolFailure();
			if (options.timeoutMilliseconds !== undefined && (!Number.isSafeInteger(options.timeoutMilliseconds) || options.timeoutMilliseconds <= 0)) protocolFailure();
		}
		if (options.signal?.aborted) throw options.signal.reason;
		if (queryOperations.has(operation))
			return invokeCanonicalQuery<Result>({ transport, baseUrl: input.baseUrl, context, operation, operationInput, options, callId });
		const encodedInput = encode(inputCodecs[operation], operationInput);
		let request: Request;
		try {
			request = new Request(new URL(${JSON.stringify(input.path)}, input.baseUrl), {
				method: "POST",
				headers: { "content-type": ${JSON.stringify(input.mediaType)} },
				body: JSON.stringify({ protocol: { name: "questpie.operation", version: 1 }, application: ${JSON.stringify(input.application)}, clientContractDigest: ${JSON.stringify(input.clientContractDigest)}, wireDigest: ${JSON.stringify(input.wireDigest)}, operation, callId, context, input: encodedInput, timeoutMilliseconds: action ? options.timeoutMilliseconds ?? null : options.timeoutMilliseconds ?? 5_000, ...(action ? { effectKey: (options as ActionCallOptions).effectKey } : {}) }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
		} catch {
			protocolFailure();
		}
		let response: Response;
		let frame: WireRecord;
		try {
			response = await transport(request);
			if (response.headers.get("content-type") !== ${JSON.stringify(input.mediaType)}) protocolFailure();
			frame = wireRecord(await response.json());
		} catch (error) {
			if (action) throw new ActionOutcomeAmbiguous(callId);
			throw error;
		}
		try {
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
			throw publicError(detail);
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
			throw publicError({ code: detail.code, status: detail.status, payload });
		}
		if (action) throw new ActionOutcomeAmbiguous(callId);
		return protocolFailure();
		} catch (error) {
			if (action && error instanceof ProtocolFailure) throw new ActionOutcomeAmbiguous(callId);
			throw error;
		}
	};
	const scope = (next: AppContextInput): GeneratedClientScope => {
		const context = immutableContext(next);
		${realtimeScope}
		${queryResource.scope}
		return Object.freeze({ context, queries: Object.freeze({
			${implementations}
		}), mutations: Object.freeze({
			${mutationImplementations}
		}), actions: Object.freeze({
			${actionImplementations}
		}), withContext: scope });
	};
	return Object.freeze({ withContext: scope });
}
`;
}
