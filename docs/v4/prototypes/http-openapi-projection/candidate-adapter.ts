import { randomUUID } from "node:crypto";

import {
	canonicalBytes,
	compareAscii,
} from "../../../../packages/compiler/src/canonical";
import { normalizeCodecContract } from "../../../../packages/compiler/src/codec";
import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
} from "../../../../packages/runtime/src/codec";

type Codec = Readonly<Record<string, unknown>>;
type CandidateKind = "action" | "mutation" | "query";

function invalid(reason = "PROTOCOL_UNSUPPORTED"): never {
	throw new TypeError(reason);
}

function record(value: unknown): Codec {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid();
	return value as Codec;
}

function exactKeys(value: Codec, expected: readonly string[]): void {
	const actual = Object.keys(value).sort(compareAscii);
	const sortedExpected = [...expected].sort(compareAscii);
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	)
		invalid();
}

function parseJsonWithoutDuplicateKeys(source: string): unknown {
	let offset = 0;
	const whitespace = () => {
		while (/^[\t\n\r ]$/u.test(source[offset] ?? "")) offset += 1;
	};
	const string = (): string => {
		if (source[offset] !== '"') invalid();
		const start = offset;
		offset += 1;
		let escaped = false;
		while (offset < source.length) {
			const character = source[offset]!;
			offset += 1;
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"')
				return JSON.parse(source.slice(start, offset)) as string;
		}
		return invalid();
	};
	const value = (): void => {
		whitespace();
		if (source[offset] === '"') {
			string();
			return;
		}
		if (source[offset] === "{") {
			offset += 1;
			whitespace();
			const keys = new Set<string>();
			if (source[offset] === "}") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				const key = string();
				if (keys.has(key)) invalid();
				keys.add(key);
				whitespace();
				if (source[offset] !== ":") invalid();
				offset += 1;
				value();
				whitespace();
				if (source[offset] === "}") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") invalid();
				offset += 1;
				whitespace();
			}
			return invalid();
		}
		if (source[offset] === "[") {
			offset += 1;
			whitespace();
			if (source[offset] === "]") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				value();
				whitespace();
				if (source[offset] === "]") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") invalid();
				offset += 1;
			}
			return invalid();
		}
		const start = offset;
		while (offset < source.length && !/[\t\n\r ,}\]]/u.test(source[offset]!))
			offset += 1;
		if (start === offset) invalid();
		JSON.parse(source.slice(start, offset));
	};
	value();
	whitespace();
	if (offset !== source.length) invalid();
	return JSON.parse(source);
}

function staticallyBounded(codec: Codec): boolean {
	if (codec.kind === "optional" || codec.kind === "nullable")
		return staticallyBounded(record(codec.codec));
	if (codec.kind === "text") return codec.maxLength !== undefined;
	if (codec.kind === "array")
		return (
			codec.maximum !== undefined && staticallyBounded(record(codec.items))
		);
	if (codec.kind === "object")
		return Object.values(record(codec.properties)).every((member) =>
			staticallyBounded(record(member)),
		);
	return codec.kind !== "json";
}

function withoutCanonicalTerminator(value: unknown): string {
	return canonicalBytes(value).replace(/\n$/u, "");
}

function unwrap(codec: Codec): Codec {
	if (codec.kind === "optional" || codec.kind === "nullable")
		return unwrap(record(codec.codec));
	return codec;
}

function lexicalValue(codec: Codec, value: unknown): string {
	if (value === null) return "~null";
	const kind = unwrap(codec).kind;
	if (kind === "text") {
		if (typeof value !== "string") return invalid();
		return value.startsWith("~") ? `~text:${value}` : value;
	}
	if (kind === "boolean" && typeof value === "boolean") return String(value);
	if (
		kind === "integer" &&
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		!Object.is(value, -0)
	)
		return String(value);
	if (
		(kind === "bigint" ||
			kind === "numeric" ||
			kind === "uuid" ||
			kind === "date" ||
			kind === "timestamp" ||
			kind === "cursor") &&
		typeof value === "string"
	)
		return value;
	return `~json:${withoutCanonicalTerminator(value)}`;
}

function canonicalPercent(value: string): boolean {
	if (value.includes("+") || /%(?![0-9A-F]{2})/u.test(value)) return false;
	return [...value.matchAll(/%([0-9A-Fa-f]{2})/gu)].every(
		(match) => match[1] === match[1]?.toUpperCase(),
	);
}

function reverseLexical(codec: Codec, value: string): unknown {
	if (value === "~null") return null;
	const kind = unwrap(codec).kind;
	if (kind === "text")
		return value.startsWith("~text:") ? value.slice(6) : value;
	if (value.startsWith("~json:")) {
		const source = value.slice(6);
		const decoded = JSON.parse(source);
		if (withoutCanonicalTerminator(decoded) !== source) return invalid();
		return decoded;
	}
	if (kind === "boolean")
		return value === "true" ? true : value === "false" ? false : invalid();
	if (kind === "integer") {
		if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(value)) return invalid();
		const number = Number(value);
		return Number.isSafeInteger(number) && !Object.is(number, -0)
			? number
			: invalid();
	}
	return value;
}

export function canonicalOperationPath(
	kind: CandidateKind,
	name: string,
): string {
	if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name)) invalid();
	return `/_questpie/${kind}/${name}`;
}

export function decodeCanonicalQueryString(
	inputCodec: unknown,
	source: string,
): Readonly<Record<string, unknown>> {
	if (new TextEncoder().encode(source).byteLength > 16_384) return invalid();
	if (!canonicalPercent(source)) return invalid();
	const codec = normalizeCodecContract(inputCodec, {
		requireExactMembers: true,
		invalid: () => invalid(),
	});
	if (codec.kind !== "object" || !staticallyBounded(codec))
		return invalid("queryHttpEncodingUnsupported");
	const properties = record(codec.properties);
	const output: Record<string, unknown> = {};
	for (const pair of source === "" ? [] : source.split("&")) {
		const separator = pair.indexOf("=");
		if (separator < 0) return invalid();
		let name: string;
		let value: string;
		try {
			name = decodeURIComponent(pair.slice(0, separator));
			value = decodeURIComponent(pair.slice(separator + 1));
		} catch {
			return invalid();
		}
		if (!Object.hasOwn(properties, name) || Object.hasOwn(output, name))
			return invalid();
		output[name] = reverseLexical(record(properties[name]), value);
	}
	const decoded = decodeRuntimeCodec(
		decodeRuntimeCodecDescriptor(inputCodec),
		output,
	) as Readonly<Record<string, unknown>>;
	if (canonicalQueryString(inputCodec, decoded) !== source) invalid();
	return decoded;
}

export function canonicalQueryString(
	inputCodec: unknown,
	input: Readonly<Record<string, unknown>>,
): string {
	const codec = normalizeCodecContract(inputCodec, {
		requireExactMembers: true,
		invalid: () => invalid(),
	});
	if (codec.kind !== "object" || !staticallyBounded(codec))
		return invalid("queryHttpEncodingUnsupported");
	const encoded = encodeRuntimeCodec(
		decodeRuntimeCodecDescriptor(inputCodec),
		input,
	) as Readonly<Record<string, unknown>>;
	const properties = record(codec.properties);
	const output = Object.keys(encoded)
		.sort(compareAscii)
		.map((name) => {
			if (!Object.hasOwn(properties, name)) return invalid();
			return `${encodeURIComponent(name)}=${encodeURIComponent(
				lexicalValue(record(properties[name]), encoded[name]),
			)}`;
		})
		.join("&");
	if (new TextEncoder().encode(output).byteLength > 16_384) invalid();
	return output;
}

export function canonicalContextHeader(
	contextCodec: unknown,
	context: unknown,
): string {
	const encoded = encodeRuntimeCodec(
		decodeRuntimeCodecDescriptor(contextCodec),
		context,
	);
	const bytes = withoutCanonicalTerminator(encoded);
	if (new TextEncoder().encode(bytes).byteLength > 65_536) invalid();
	return Buffer.from(bytes, "utf8").toString("base64url");
}

export function decodeCanonicalContextHeader(
	contextCodec: unknown,
	header: string,
): unknown {
	if (!/^[A-Za-z0-9_-]+$/u.test(header)) return invalid();
	const decoded = Buffer.from(header, "base64url").toString("utf8");
	if (new TextEncoder().encode(decoded).byteLength > 65_536) invalid();
	if (Buffer.from(decoded, "utf8").toString("base64url") !== header) invalid();
	const wire = JSON.parse(decoded);
	if (withoutCanonicalTerminator(wire) !== decoded) invalid();
	return decodeRuntimeCodec(decodeRuntimeCodecDescriptor(contextCodec), wire);
}

export function canonicalPostBody(
	inputCodec: unknown,
	contextCodec: unknown,
	input: unknown,
	context: unknown,
): string {
	return withoutCanonicalTerminator({
		context: encodeRuntimeCodec(
			decodeRuntimeCodecDescriptor(contextCodec),
			context,
		),
		input: encodeRuntimeCodec(decodeRuntimeCodecDescriptor(inputCodec), input),
	});
}

function identity(value: string): string {
	if (
		value.length === 0 ||
		value.includes("\0") ||
		value.normalize("NFC") !== value ||
		[...value].length > 256 ||
		new TextEncoder().encode(value).byteLength > 1_024
	)
		invalid();
	return value;
}

function identityHeader(value: string): string {
	return encodeURIComponent(identity(value));
}

function decodeIdentityHeader(value: string): string {
	if (!canonicalPercent(value)) invalid();
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return invalid();
	}
	if (identityHeader(decoded) !== value) invalid();
	return decoded;
}

export function canonicalCallHeaders(
	input: Readonly<{ callId?: string; timeoutMilliseconds?: number }>,
): Readonly<Record<string, string>> {
	if (
		input.timeoutMilliseconds !== undefined &&
		(!Number.isSafeInteger(input.timeoutMilliseconds) ||
			input.timeoutMilliseconds <= 0)
	)
		invalid();
	return Object.freeze({
		...(input.callId === undefined
			? {}
			: { "Questpie-Call-Id": identityHeader(input.callId) }),
		...(input.timeoutMilliseconds === undefined
			? {}
			: {
					"Questpie-Timeout-Milliseconds": String(input.timeoutMilliseconds),
				}),
	});
}

export function generatedCompatibilityHeaders(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		wireDigest: string;
	}>,
): Readonly<Record<string, string>> {
	if (!/^application:[a-z][A-Za-z0-9.]*$/u.test(input.application)) invalid();
	if (
		!/^[0-9a-f]{64}$/u.test(input.clientContractDigest) ||
		!/^[0-9a-f]{64}$/u.test(input.wireDigest)
	)
		invalid();
	return Object.freeze({
		"Questpie-Application": input.application,
		"Questpie-Client-Contract": input.clientContractDigest,
		"Questpie-Wire-Digest": input.wireDigest,
	});
}

export const QUERY_RESPONSE_HEADERS = Object.freeze({
	"Cache-Control": "private, no-store",
});

type ProjectedOperation = Readonly<{
	kind: CandidateKind;
	name: string;
	origin: string;
}>;

type RawRoute = Readonly<{
	identity: string;
	method: string;
	origin: string;
	path: string;
}>;

export function openApiSelected(config: unknown): boolean {
	const root = record(config);
	if (!("projections" in root)) return false;
	const projections = record(root.projections);
	if (Object.keys(projections).some((key) => key !== "openapi"))
		return invalid();
	if (!("openapi" in projections)) return false;
	if (projections.openapi !== true) return invalid();
	return true;
}

function collisionReason(
	operationPath: string,
	operationMethod: string,
	raw: RawRoute,
):
	| "ambiguousParameterCollision"
	| "exactPathCollision"
	| "rawWildcardIntersection"
	| null {
	if (raw.method !== operationMethod) return null;
	const operationSegments = operationPath.split("/").slice(1);
	const rawSegments = raw.path.split("/").slice(1);
	const wildcard = rawSegments.findIndex((segment) => segment.startsWith("*"));
	const matches = (rawSegment: string, operationSegment: string) =>
		rawSegment.startsWith(":") || rawSegment === operationSegment;
	if (
		wildcard >= 0 &&
		wildcard <= operationSegments.length &&
		rawSegments
			.slice(0, wildcard)
			.every((segment, index) =>
				matches(segment, operationSegments[index] ?? ""),
			)
	)
		return "rawWildcardIntersection";
	if (rawSegments.length !== operationSegments.length) return null;
	if (
		!rawSegments.every((segment, index) =>
			matches(segment, operationSegments[index] ?? ""),
		)
	)
		return null;
	return rawSegments.some((segment) => segment.startsWith(":"))
		? "ambiguousParameterCollision"
		: "exactPathCollision";
}

export function projectCanonicalInventory(
	application: string,
	operations: readonly ProjectedOperation[],
	rawRoutes: readonly RawRoute[] = [],
) {
	const names = new Map<string, ProjectedOperation>();
	const included = [...operations]
		.sort((left, right) =>
			compareAscii(`${left.kind}:${left.name}`, `${right.kind}:${right.name}`),
		)
		.map((operation) => {
			if (names.has(operation.name))
				throw new TypeError(
					`openApiOperationIdCollision:${names.get(operation.name)?.origin}:${operation.origin}`,
				);
			names.set(operation.name, operation);
			const path = canonicalOperationPath(operation.kind, operation.name);
			const method = operation.kind === "query" ? "GET" : "POST";
			for (const raw of rawRoutes) {
				const reason = collisionReason(path, method, raw);
				if (reason)
					throw new TypeError(`${reason}:${operation.origin}:${raw.origin}`);
			}
			return Object.freeze({
				...operation,
				method,
				operationId: operation.name,
				path,
				tag: operation.name.includes(".")
					? operation.name.split(".")[0]
					: application,
			});
		});
	return Object.freeze({
		included: Object.freeze(included),
		omitted: Object.freeze(
			[...rawRoutes]
				.sort((left, right) => compareAscii(left.identity, right.identity))
				.map(({ identity: routeIdentity, origin }) =>
					Object.freeze({
						identity: routeIdentity,
						origin,
						reason: "rawRouteUnsupported" as const,
					}),
				),
		),
	});
}

type CandidateExecutionScopeBase = Readonly<{
	callId: string;
	context: unknown;
	deadlineMilliseconds: number | null;
	input: unknown;
	principal: unknown;
	signal: AbortSignal;
	timeoutMilliseconds?: number;
}>;

export type CandidateQueryExecutionScope = CandidateExecutionScopeBase &
	Readonly<{ effectKey?: never }>;
export type CandidateMutationExecutionScope = CandidateExecutionScopeBase &
	Readonly<{ effectKey?: never }>;
export type CandidateActionExecutionScope = CandidateExecutionScopeBase &
	Readonly<{ effectKey: string }>;
export type CandidateExecutionScope =
	| CandidateActionExecutionScope
	| CandidateMutationExecutionScope
	| CandidateQueryExecutionScope;

type CandidateClock = Readonly<{
	nowMilliseconds(): number;
	schedule(callback: () => void, delayMilliseconds: number): () => void;
}>;

function clockNow(clock: CandidateClock): number {
	const value = clock.nowMilliseconds();
	if (!Number.isFinite(value) || value < 0) invalid();
	return value;
}

function deadlineFrom(startedAt: number, timeoutMilliseconds: number): number {
	return Math.min(Number.MAX_SAFE_INTEGER, startedAt + timeoutMilliseconds);
}

export type CandidateOutcome =
	| Readonly<{ kind: "result"; value: unknown }>
	| Readonly<{
			code: string;
			kind: "declaredError";
			payload: unknown;
			status: number;
	  }>
	| Readonly<{ kind: "postHandlerResourceLimit" }>;

type CandidateDefinitionBase = Readonly<{
	context: unknown;
	input: unknown;
	name: string;
	output: unknown;
}>;
type CandidateDefinition =
	| (CandidateDefinitionBase &
			Readonly<{
				execute(scope: CandidateQueryExecutionScope): Promise<CandidateOutcome>;
				kind: "query";
			}>)
	| (CandidateDefinitionBase &
			Readonly<{
				execute(
					scope: CandidateMutationExecutionScope,
				): Promise<CandidateOutcome>;
				kind: "mutation";
			}>)
	| (CandidateDefinitionBase &
			Readonly<{
				execute(
					scope: CandidateActionExecutionScope,
				): Promise<CandidateOutcome>;
				kind: "action";
			}>);

export type QueryCallOptions = Readonly<{
	callId?: string;
	signal?: AbortSignal;
	timeoutMilliseconds?: number;
}>;
export type MutationCallOptions = Readonly<{
	callId?: string;
	signal?: AbortSignal;
	timeoutMilliseconds?: number;
}>;
export type ActionCallOptions = Readonly<{
	callId?: string;
	effectKey: string;
	signal?: AbortSignal;
	timeoutMilliseconds?: number;
}>;

type CandidateFrame =
	| Readonly<{ callId: string; result: unknown }>
	| Readonly<{
			callId?: string;
			error: Readonly<{
				code: string;
				payload?: unknown;
				retryable?: boolean;
			}>;
	  }>;

function response(
	body: CandidateFrame,
	status: number,
	query: boolean,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			...(query ? QUERY_RESPONSE_HEADERS : {}),
		},
	});
}

function isQueryPath(pathname: string): boolean {
	return pathname.startsWith("/_questpie/query/");
}

function exactCompatibility(
	request: Request,
	expected: Readonly<{
		application: string;
		clientContractDigest: string;
		wireDigest: string;
	}>,
): boolean {
	const actual = [
		request.headers.get("Questpie-Application"),
		request.headers.get("Questpie-Client-Contract"),
		request.headers.get("Questpie-Wire-Digest"),
	];
	if (actual.every((value) => value === null)) return true;
	return (
		actual[0] === expected.application &&
		actual[1] === expected.clientContractDigest &&
		actual[2] === expected.wireDigest
	);
}

function optionalIdentityHeader(request: Request, name: string): string | null {
	const value = request.headers.get(name);
	return value === null ? null : decodeIdentityHeader(value);
}

function requiredIdentityHeader(request: Request, name: string): string {
	const value = optionalIdentityHeader(request, name);
	return value === null ? invalid() : value;
}

function timeoutHeader(request: Request): number | undefined {
	const value = request.headers.get("Questpie-Timeout-Milliseconds");
	if (value === null) return undefined;
	if (!/^[1-9][0-9]*$/u.test(value)) invalid();
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) invalid();
	return parsed;
}

function correlatedFailure(
	code: string,
	retryable: boolean,
	status: number,
	query: boolean,
	callId?: string,
): Response {
	return response(
		{
			...(callId === undefined ? {} : { callId }),
			error: { code, retryable },
		},
		status,
		query,
	);
}

function validateFrame(frame: Codec, callId: string): CandidateFrame {
	if (Object.hasOwn(frame, "result")) {
		exactKeys(frame, ["callId", "result"]);
		if (frame.callId !== callId) invalid();
		return frame as CandidateFrame;
	}
	if (!Object.hasOwn(frame, "error")) invalid();
	const correlated = Object.hasOwn(frame, "callId");
	exactKeys(frame, correlated ? ["callId", "error"] : ["error"]);
	if (correlated && frame.callId !== callId) invalid();
	const error = record(frame.error);
	if (Object.hasOwn(error, "payload")) {
		exactKeys(error, ["code", "payload"]);
		if (typeof error.code !== "string") invalid();
	} else {
		exactKeys(error, ["code", "retryable"]);
		if (typeof error.code !== "string" || typeof error.retryable !== "boolean")
			invalid();
	}
	return frame as CandidateFrame;
}

function immutableContext(value: unknown): unknown {
	const context = structuredClone(value);
	if (!context || typeof context !== "object") return context;
	const pending: object[] = [context];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || Object.isFrozen(current)) continue;
		for (const child of Object.values(current))
			if (child && typeof child === "object") pending.push(child);
		Object.freeze(current);
	}
	return context;
}

export class ActionOutcomeAmbiguous extends Error {
	readonly code = "ACTION_OUTCOME_AMBIGUOUS" as const;

	constructor(readonly callId: string) {
		super("ACTION_OUTCOME_AMBIGUOUS");
		this.name = "ActionOutcomeAmbiguous";
	}
}

export function createCandidateAdapter(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		clock?: CandidateClock;
		definitions: readonly CandidateDefinition[];
		resolvePrincipal(
			request: Request,
			signal: AbortSignal,
		): unknown | Promise<unknown>;
		transport?: (request: Request) => Promise<Response>;
		wireDigest: string;
	}>,
) {
	generatedCompatibilityHeaders(input);
	const clock: CandidateClock =
		input.clock ??
		Object.freeze({
			nowMilliseconds: () => performance.now(),
			schedule(callback: () => void, delayMilliseconds: number) {
				let timer: ReturnType<typeof setTimeout> | undefined;
				let cancelled = false;
				const arm = (remaining: number) => {
					const delay = Math.min(remaining, 2_147_483_647);
					timer = setTimeout(() => {
						if (cancelled) return;
						if (remaining > delay) arm(remaining - delay);
						else callback();
					}, delay);
				};
				arm(delayMilliseconds);
				return () => {
					cancelled = true;
					if (timer !== undefined) clearTimeout(timer);
				};
			},
		});
	const definitions = new Map(
		input.definitions.map((definition) => [
			`${definition.kind}:${definition.name}`,
			definition,
		]),
	);
	const fetchHandler = async (request: Request): Promise<Response> => {
		const startedAt = clockNow(clock);
		const url = new URL(request.url);
		const query = isQueryPath(url.pathname);
		const match =
			/^\/_questpie\/(query|mutation|action)\/([A-Za-z0-9.]+)$/u.exec(
				url.pathname,
			);
		const kind = match?.[1] as CandidateKind | undefined;
		const definition =
			kind && match ? definitions.get(`${kind}:${match[2]}`) : undefined;
		if (
			!kind ||
			!definition ||
			request.method !== (kind === "query" ? "GET" : "POST")
		)
			return correlatedFailure("NOT_FOUND", false, 404, query);
		if (request.signal.aborted)
			return correlatedFailure("DEADLINE_EXCEEDED", true, 408, query);
		if (!exactCompatibility(request, input))
			return correlatedFailure("PROTOCOL_UNSUPPORTED", false, 400, query);

		let callId: string | undefined;
		let effectKey: string | undefined;
		let timeoutMilliseconds: number | undefined;
		try {
			if (kind === "mutation") {
				if (request.headers.has("Questpie-Call-Id")) invalid();
				callId = requiredIdentityHeader(request, "Idempotency-Key");
			} else {
				if (request.headers.has("Idempotency-Key")) invalid();
				callId =
					optionalIdentityHeader(request, "Questpie-Call-Id") ?? randomUUID();
			}
			if (kind === "action") {
				effectKey = requiredIdentityHeader(request, "Effect-Key");
			} else if (request.headers.has("Effect-Key")) invalid();
			timeoutMilliseconds = timeoutHeader(request);
		} catch {
			return correlatedFailure(
				"PROTOCOL_UNSUPPORTED",
				false,
				400,
				query,
				callId,
			);
		}
		const deadlineMilliseconds =
			timeoutMilliseconds === undefined
				? null
				: deadlineFrom(startedAt, timeoutMilliseconds);
		const controller = new AbortController();
		const abortFromRequest = () => controller.abort(request.signal.reason);
		request.signal.addEventListener("abort", abortFromRequest, { once: true });
		let cancelDeadline = () => {};
		const observedAt = clockNow(clock);
		if (
			request.signal.aborted ||
			(deadlineMilliseconds !== null && observedAt >= deadlineMilliseconds)
		)
			controller.abort("deadline exceeded");
		else if (deadlineMilliseconds !== null)
			cancelDeadline = clock.schedule(
				() => controller.abort("deadline exceeded"),
				deadlineMilliseconds - observedAt,
			);
		const cleanup = () => {
			cancelDeadline();
			request.signal.removeEventListener("abort", abortFromRequest);
		};
		const finish = (result: Response): Response => {
			cleanup();
			return result;
		};
		const cancelled = (): boolean => {
			if (request.signal.aborted && !controller.signal.aborted)
				controller.abort(request.signal.reason);
			if (
				deadlineMilliseconds !== null &&
				clockNow(clock) >= deadlineMilliseconds &&
				!controller.signal.aborted
			)
				controller.abort("deadline exceeded");
			return controller.signal.aborted;
		};
		const cancellationResponse = () =>
			finish(correlatedFailure("DEADLINE_EXCEEDED", true, 408, query, callId));
		if (cancelled()) return cancellationResponse();

		let principal: unknown;
		try {
			principal = await input.resolvePrincipal(request, controller.signal);
		} catch {
			if (cancelled()) return cancellationResponse();
			return finish(
				correlatedFailure("RUNTIME_UNAVAILABLE", true, 503, query, callId),
			);
		}
		if (cancelled()) return cancellationResponse();

		let operationInput: unknown;
		let context: unknown;
		try {
			if (kind === "query") {
				operationInput = decodeCanonicalQueryString(
					definition.input,
					url.search.slice(1),
				);
				const header = request.headers.get("Questpie-Context");
				context =
					header === null
						? decodeRuntimeCodec(
								decodeRuntimeCodecDescriptor(definition.context),
								{},
							)
						: decodeCanonicalContextHeader(definition.context, header);
			} else {
				const contentType = request.headers.get("Content-Type");
				if (
					contentType !== "application/json" &&
					contentType?.toLowerCase() !== "application/json; charset=utf-8"
				)
					invalid();
				const bodyText = new TextDecoder("utf-8", {
					fatal: true,
					ignoreBOM: true,
				}).decode(await request.arrayBuffer());
				const body = record(parseJsonWithoutDuplicateKeys(bodyText));
				exactKeys(body, ["context", "input"]);
				operationInput = decodeRuntimeCodec(
					decodeRuntimeCodecDescriptor(definition.input),
					body.input,
				);
				context = decodeRuntimeCodec(
					decodeRuntimeCodecDescriptor(definition.context),
					body.context,
				);
			}
		} catch {
			if (cancelled()) return cancellationResponse();
			return finish(
				correlatedFailure("PROTOCOL_UNSUPPORTED", false, 400, query, callId),
			);
		}
		if (cancelled()) return cancellationResponse();

		let outcome: CandidateOutcome;
		try {
			const executionScope = {
				callId,
				context,
				deadlineMilliseconds,
				...(kind === "action" ? { effectKey: effectKey ?? invalid() } : {}),
				input: operationInput,
				principal,
				signal: controller.signal,
				...(timeoutMilliseconds === undefined ? {} : { timeoutMilliseconds }),
			} satisfies CandidateExecutionScope;
			outcome = await (
				definition.execute as (
					scope: CandidateExecutionScope,
				) => Promise<CandidateOutcome>
			)(executionScope);
		} catch {
			if (cancelled()) return cancellationResponse();
			return finish(correlatedFailure("INTERNAL", false, 500, query, callId));
		}
		if (cancelled()) return cancellationResponse();
		if (outcome.kind === "postHandlerResourceLimit") {
			if (kind !== "action")
				return finish(correlatedFailure("INTERNAL", false, 500, query, callId));
			return finish(
				correlatedFailure("RESOURCE_LIMIT", false, 429, false, callId),
			);
		}
		if (outcome.kind === "declaredError")
			return finish(
				response(
					{
						callId,
						error: { code: outcome.code, payload: outcome.payload },
					},
					outcome.status,
					query,
				),
			);
		let encodedResult: unknown;
		try {
			encodedResult = encodeRuntimeCodec(
				decodeRuntimeCodecDescriptor(definition.output),
				outcome.value,
			);
		} catch {
			if (cancelled()) return cancellationResponse();
			return finish(correlatedFailure("INTERNAL", false, 500, query, callId));
		}
		if (cancelled()) return cancellationResponse();
		return finish(response({ callId, result: encodedResult }, 200, query));
	};

	const transport = input.transport ?? fetchHandler;
	type InternalCallOptions = QueryCallOptions &
		Readonly<{ effectKey?: string }>;
	const invoke = async (
		kind: CandidateKind,
		name: string,
		operationInput: unknown,
		context: unknown,
		options: InternalCallOptions = {},
	): Promise<CandidateFrame> => {
		const definition = definitions.get(`${kind}:${name}`);
		if (!definition) invalid();
		if (options.signal?.aborted) throw options.signal.reason;
		const callId = options.callId ?? randomUUID();
		const headers = new Headers({
			...canonicalCallHeaders({
				callId,
				timeoutMilliseconds: options.timeoutMilliseconds,
			}),
			...generatedCompatibilityHeaders(input),
		});
		let url = `https://candidate.test${canonicalOperationPath(kind, name)}`;
		let body: string | undefined;
		if (kind === "query") {
			url += `?${canonicalQueryString(
				definition.input,
				operationInput as Readonly<Record<string, unknown>>,
			)}`;
			headers.set(
				"Questpie-Context",
				canonicalContextHeader(definition.context, context),
			);
		} else {
			body = canonicalPostBody(
				definition.input,
				definition.context,
				operationInput,
				context,
			);
			headers.set("Content-Type", "application/json");
		}
		if (kind === "mutation") {
			headers.delete("Questpie-Call-Id");
			headers.set("Idempotency-Key", identityHeader(callId));
		}
		if (kind === "action") {
			if (options.effectKey === undefined) invalid();
			headers.set("Effect-Key", identityHeader(options.effectKey));
		}
		const request = new Request(url, {
			body,
			headers,
			method: kind === "query" ? "GET" : "POST",
			...(options.signal === undefined ? {} : { signal: options.signal }),
		});
		let result: Response;
		try {
			result = await transport(request);
		} catch (error) {
			if (kind === "action") throw new ActionOutcomeAmbiguous(callId);
			throw error;
		}
		try {
			if (
				result.headers.get("Content-Type") !== "application/json; charset=utf-8"
			)
				invalid();
			const frame = validateFrame(record(await result.json()), callId);
			if ("result" in frame)
				return Object.freeze({
					callId,
					result: decodeRuntimeCodec(
						decodeRuntimeCodecDescriptor(definition.output),
						frame.result,
					),
				});
			return frame;
		} catch (error) {
			if (kind === "action") throw new ActionOutcomeAmbiguous(callId);
			throw error;
		}
	};
	type QueryCall = (
		operationInput: unknown,
		options?: QueryCallOptions,
	) => Promise<CandidateFrame>;
	type MutationCall = (
		operationInput: unknown,
		options?: MutationCallOptions,
	) => Promise<CandidateFrame>;
	type ActionCall = (
		operationInput: unknown,
		options: ActionCallOptions,
	) => Promise<CandidateFrame>;
	const definitionsFor = (kind: CandidateKind) =>
		input.definitions
			.filter((definition) => definition.kind === kind)
			.sort((left, right) => compareAscii(left.name, right.name));
	const queryCalls = (context: unknown) =>
		Object.freeze(
			Object.fromEntries(
				definitionsFor("query").map(
					(definition) =>
						[
							definition.name,
							((operationInput, options) =>
								invoke(
									"query",
									definition.name,
									operationInput,
									context,
									options,
								)) satisfies QueryCall,
						] as const,
				),
			),
		) as Readonly<Record<string, QueryCall>>;
	const mutationCalls = (context: unknown) =>
		Object.freeze(
			Object.fromEntries(
				definitionsFor("mutation").map(
					(definition) =>
						[
							definition.name,
							((operationInput, options) =>
								invoke(
									"mutation",
									definition.name,
									operationInput,
									context,
									options,
								)) satisfies MutationCall,
						] as const,
				),
			),
		) as Readonly<Record<string, MutationCall>>;
	const actionCalls = (context: unknown) =>
		Object.freeze(
			Object.fromEntries(
				definitionsFor("action").map(
					(definition) =>
						[
							definition.name,
							((operationInput, options) =>
								invoke(
									"action",
									definition.name,
									operationInput,
									context,
									options,
								)) satisfies ActionCall,
						] as const,
				),
			),
		) as Readonly<Record<string, ActionCall>>;
	const client = Object.freeze({
		withContext(context: unknown) {
			const scopedContext = immutableContext(context);
			return Object.freeze({
				actions: actionCalls(scopedContext),
				mutations: mutationCalls(scopedContext),
				queries: queryCalls(scopedContext),
			});
		},
	});
	return Object.freeze({ client, fetch: fetchHandler });
}
