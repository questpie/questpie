import { principal, type Principal } from "questpie";

import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { RuntimeCredentialUnavailable } from "../execution";
import {
	DeclaredOperationError,
	encodeDeclaredOperationError,
	OperationFailure,
	type PreparedOperation,
	type RuntimeOperationContract,
} from "../operation";
import {
	awaitHttpPhase,
	decodeHttpIdentity as decodeIdentity,
	decodeHttpTimeout as decodeTimeout,
	createHttpExecutionControl,
	httpFailure,
	httpJsonResponse,
	httpProtocolFailure as protocol,
	httpRecord as record,
	readHttpHeader as header,
} from "./http-carrier";

const QUERY_PREFIX = "/_questpie/query/";
const QUERY_CACHE_CONTROL = "private, no-store";

function unwrap(codec: RuntimeCodec): RuntimeCodec {
	return codec.kind === "optional" || codec.kind === "nullable"
		? unwrap(codec.codec)
		: codec;
}

function staticallyBounded(codec: RuntimeCodec): boolean {
	if (codec.kind === "optional" || codec.kind === "nullable")
		return staticallyBounded(codec.codec);
	if (codec.kind === "text") return codec.maxLength !== undefined;
	if (codec.kind === "array")
		return codec.maximum !== undefined && staticallyBounded(codec.items);
	if (codec.kind === "object")
		return Object.values(codec.properties).every(staticallyBounded);
	return codec.kind !== "json";
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const encoded = JSON.stringify(value);
		if (encoded === undefined) protocol();
		return encoded;
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const source = record(value);
	return `{${Object.keys(source)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
		.join(",")}}`;
}

function lexical(codec: RuntimeCodec, value: unknown): string {
	if (value === null) return "~null";
	const kind = unwrap(codec).kind;
	if (kind === "text") {
		if (typeof value !== "string") protocol();
		return value.startsWith("~") ? `~text:${value}` : value;
	}
	if (kind === "boolean" || kind === "integer") return String(value);
	if (
		["bigint", "numeric", "uuid", "date", "timestamp", "cursor"].includes(kind)
	) {
		if (typeof value !== "string") protocol();
		return value;
	}
	return `~json:${canonicalJson(value)}`;
}

function reverseLexical(codec: RuntimeCodec, value: string): unknown {
	if (value === "~null") return null;
	const kind = unwrap(codec).kind;
	if (kind === "text")
		return value.startsWith("~text:") ? value.slice(6) : value;
	if (value.startsWith("~json:")) {
		const source = value.slice(6);
		let parsed: unknown;
		try {
			parsed = JSON.parse(source);
		} catch {
			return protocol();
		}
		if (canonicalJson(parsed) !== source) protocol();
		return parsed;
	}
	if (kind === "boolean")
		return value === "true" ? true : value === "false" ? false : protocol();
	if (kind === "integer") {
		if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(value)) protocol();
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && !Object.is(parsed, -0)
			? parsed
			: protocol();
	}
	return value;
}

function encodeQuery(codec: RuntimeCodec, input: unknown): string {
	if (codec.kind !== "object" || !staticallyBounded(codec)) protocol();
	const encoded = record(encodeRuntimeCodec(codec, input));
	const query = Object.keys(encoded)
		.sort()
		.map(
			(name) =>
				`${encodeURIComponent(name)}=${encodeURIComponent(lexical(codec.properties[name]!, encoded[name]))}`,
		)
		.join("&");
	if (Buffer.byteLength(query, "utf8") > 16_384) protocol();
	return query;
}

function decodeQuery(codec: RuntimeCodec, source: string): unknown {
	if (
		codec.kind !== "object" ||
		!staticallyBounded(codec) ||
		Buffer.byteLength(source, "utf8") > 16_384 ||
		source.includes("+") ||
		/%(?![0-9A-F]{2})/u.test(source) ||
		[...source.matchAll(/%([0-9A-Fa-f]{2})/gu)].some(
			(match) => match[1] !== match[1]?.toUpperCase(),
		)
	)
		protocol();
	const raw: Record<string, unknown> = Object.create(null);
	for (const pair of source === "" ? [] : source.split("&")) {
		const separator = pair.indexOf("=");
		if (separator < 0) protocol();
		let name: string;
		let value: string;
		try {
			name = decodeURIComponent(pair.slice(0, separator));
			value = decodeURIComponent(pair.slice(separator + 1));
		} catch {
			return protocol();
		}
		if (!Object.hasOwn(codec.properties, name) || Object.hasOwn(raw, name))
			protocol();
		raw[name] = reverseLexical(codec.properties[name]!, value);
	}
	const decoded = decodeRuntimeCodec(codec, raw);
	if (encodeQuery(codec, decoded) !== source) protocol();
	return decoded;
}

function decodeContext(codec: RuntimeCodec, value: string | null): unknown {
	if (value === null) return decodeRuntimeCodec(codec, {});
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) protocol();
	const bytes = Buffer.from(value, "base64url");
	if (bytes.byteLength > 65_536 || bytes.toString("base64url") !== value)
		protocol();
	const source = bytes.toString("utf8");
	if (Buffer.from(source, "utf8").toString("base64url") !== value) protocol();
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch {
		return protocol();
	}
	if (canonicalJson(parsed) !== source) protocol();
	return decodeRuntimeCodec(codec, parsed);
}

function queryResponse(body: unknown, status: number): Response {
	return httpJsonResponse(body, status, QUERY_CACHE_CONTROL);
}

function failure(code: string, callId?: string): Response {
	return httpFailure(code, { cacheControl: QUERY_CACHE_CONTROL, callId });
}

export function createCanonicalQueryHttp<ContextInput, View>(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
		maximumResponseBytes: number;
		contextCodec: RuntimeCodec;
		operations: readonly RuntimeOperationContract[];
		prepare(identity: string, value: unknown): PreparedOperation<View>;
		resolvePrincipal(
			request: Request,
			signal: AbortSignal,
		): Promise<Principal | null>;
		execute(
			value: Readonly<{
				principal: Principal;
				context: ContextInput;
				operation: PreparedOperation<View>;
				callId: string;
				signal: AbortSignal;
				deadline?: number;
			}>,
		): Promise<unknown>;
		now(): number;
	}>,
): Readonly<{ fetch(request: Request): Promise<Response | null> }> {
	const operations = new Map(
		input.operations
			.filter(({ identity }) => identity.startsWith("query:"))
			.map((operation) => [operation.identity, operation]),
	);
	return Object.freeze({
		fetch: async (request: Request): Promise<Response | null> => {
			const url = new URL(request.url);
			if (!url.pathname.startsWith(QUERY_PREFIX)) return null;
			const requestStartedAt = input.now();
			if (request.method !== "GET") return failure("PROTOCOL_UNSUPPORTED");
			const name = url.pathname.slice(QUERY_PREFIX.length);
			if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name))
				return failure("PROTOCOL_UNSUPPORTED");
			if (request.signal.aborted) return failure("DEADLINE_EXCEEDED");
			let callId: string;
			let timeout: number | undefined;
			try {
				const rawCallId = header(request, "Questpie-Call-Id");
				callId =
					rawCallId === null ? crypto.randomUUID() : decodeIdentity(rawCallId);
				timeout = decodeTimeout(
					header(request, "Questpie-Timeout-Milliseconds"),
				);
			} catch {
				return failure("PROTOCOL_UNSUPPORTED");
			}
			const execution = createHttpExecutionControl({
				requestSignal: request.signal,
				requestStartedAt,
				...(timeout === undefined ? {} : { timeoutMilliseconds: timeout }),
				now: input.now,
			});
			try {
				let caller: Principal | null;
				try {
					caller = await awaitHttpPhase(execution.signal, () =>
						input.resolvePrincipal(request, execution.signal),
					);
				} catch (error) {
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (
						error instanceof OperationFailure &&
						error.code === "UNAUTHENTICATED"
					)
						return failure("UNAUTHENTICATED", callId);
					return failure(
						error instanceof RuntimeCredentialUnavailable
							? "RUNTIME_UNAVAILABLE"
							: "INTERNAL",
						callId,
					);
				}
				if (execution.signal.aborted)
					return failure("DEADLINE_EXCEEDED", callId);
				if (!caller || !principal.is(caller))
					return failure("UNAUTHENTICATED", callId);
				const contract = operations.get(`query:${name}`);
				if (!contract) return failure("NOT_FOUND", callId);
				let operation: PreparedOperation<View>;
				let context: ContextInput;
				try {
					const compatibility = [
						header(request, "Questpie-Application"),
						header(request, "Questpie-Client-Contract"),
						header(request, "Questpie-Wire-Digest"),
					];
					if (
						compatibility.some((value) => value !== null) &&
						(compatibility[0] !== input.application ||
							compatibility[1] !== input.clientContractDigest ||
							compatibility[2] !== input.httpContractDigest)
					)
						protocol();
					if (
						header(request, "Idempotency-Key") !== null ||
						header(request, "Effect-Key") !== null
					)
						protocol();
					operation = input.prepare(
						contract.identity,
						decodeQuery(contract.input, url.search.slice(1)),
					);
					context = decodeContext(
						input.contextCodec,
						header(request, "Questpie-Context"),
					) as ContextInput;
				} catch (error) {
					return failure(
						error instanceof OperationFailure && error.code === "NOT_FOUND"
							? "NOT_FOUND"
							: "PROTOCOL_UNSUPPORTED",
						callId,
					);
				}
				if (execution.signal.aborted)
					return failure("DEADLINE_EXCEEDED", callId);
				try {
					const value = await input.execute({
						principal: caller,
						context,
						operation,
						callId,
						signal: execution.signal,
						...(execution.deadline === undefined
							? {}
							: { deadline: execution.deadline }),
					});
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					const body = {
						callId,
						result: encodeRuntimeCodec(operation.output, value),
					};
					if (
						Buffer.byteLength(JSON.stringify(body), "utf8") >
						input.maximumResponseBytes
					)
						return failure("RESOURCE_LIMIT", callId);
					return queryResponse(body, 200);
				} catch (error) {
					if (error instanceof DeclaredOperationError) {
						try {
							const declared = encodeDeclaredOperationError(operation, error);
							return queryResponse(
								{
									callId,
									error: { code: declared.code, payload: declared.payload },
								},
								declared.status,
							);
						} catch {
							return failure("INTERNAL", callId);
						}
					}
					if (execution.signal.aborted)
						return failure("DEADLINE_EXCEEDED", callId);
					if (error instanceof OperationFailure)
						return failure(error.code, callId);
					if (error instanceof RuntimeCodecError)
						return failure("INTERNAL", callId);
					return failure("INTERNAL", callId);
				}
			} finally {
				execution.close();
			}
		},
	});
}
