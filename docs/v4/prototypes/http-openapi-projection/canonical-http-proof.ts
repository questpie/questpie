import {
	canonicalBytes,
	compareAscii,
} from "../../../../packages/compiler/src/canonical";
import { normalizeCodecContract } from "../../../../packages/compiler/src/codec";

type Codec = Readonly<Record<string, unknown>>;

function invalid(): never {
	throw new TypeError("queryHttpEncodingUnsupported");
}

function record(value: unknown): Codec {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return invalid();
	return value as Codec;
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
	kind: "action" | "mutation" | "query",
	name: string,
): string {
	if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name)) invalid();
	return `/_questpie/${kind}/${name}`;
}

export function decodeCanonicalQueryString(
	inputCodec: unknown,
	source: string,
): Readonly<Record<string, unknown>> {
	if (!canonicalPercent(source)) return invalid();
	const codec = normalizeCodecContract(inputCodec, {
		requireExactMembers: true,
		invalid,
	});
	if (codec.kind !== "object" || !staticallyBounded(codec)) return invalid();
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
		if (!(name in properties) || Object.hasOwn(output, name)) return invalid();
		output[name] = reverseLexical(record(properties[name]), value);
	}
	return Object.freeze(output);
}

export function canonicalQueryString(
	inputCodec: unknown,
	input: Readonly<Record<string, unknown>>,
): string {
	const codec = normalizeCodecContract(inputCodec, {
		requireExactMembers: true,
		invalid,
	});
	if (codec.kind !== "object" || !staticallyBounded(codec)) return invalid();
	const properties = record(codec.properties);
	return Object.keys(input)
		.sort(compareAscii)
		.map((name) => {
			if (!(name in properties)) return invalid();
			return `${encodeURIComponent(name)}=${encodeURIComponent(lexicalValue(record(properties[name]), input[name]))}`;
		})
		.join("&");
}

export function canonicalContextHeader(context: unknown): string {
	return Buffer.from(withoutCanonicalTerminator(context), "utf8").toString(
		"base64url",
	);
}

export function decodeCanonicalContextHeader(header: string): unknown {
	if (!/^[A-Za-z0-9_-]*$/u.test(header)) return invalid();
	const decoded = Buffer.from(header, "base64url").toString("utf8");
	if (Buffer.from(decoded, "utf8").toString("base64url") !== header) invalid();
	return JSON.parse(decoded);
}

export function canonicalPostBody(input: unknown, context: unknown): string {
	return withoutCanonicalTerminator({ context, input });
}

export function canonicalCallHeaders(
	input: Readonly<{ callId?: string; timeoutMilliseconds?: number }>,
): Readonly<Record<string, string>> {
	if (input.callId !== undefined) {
		if (
			input.callId.length === 0 ||
			input.callId.includes("\0") ||
			input.callId.normalize("NFC") !== input.callId ||
			[...input.callId].length > 256 ||
			new TextEncoder().encode(input.callId).byteLength > 1_024
		)
			invalid();
	}
	if (
		input.timeoutMilliseconds !== undefined &&
		(!Number.isSafeInteger(input.timeoutMilliseconds) ||
			input.timeoutMilliseconds <= 0)
	)
		invalid();
	return Object.freeze({
		...(input.callId === undefined ? {} : { "Questpie-Call-Id": input.callId }),
		...(input.timeoutMilliseconds === undefined
			? {}
			: { "Questpie-Timeout-Milliseconds": String(input.timeoutMilliseconds) }),
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
	kind: "action" | "mutation" | "query";
	name: string;
	origin: string;
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

export function projectCanonicalInventory(
	application: string,
	operations: readonly ProjectedOperation[],
	rawPaths: readonly string[] = [],
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
			for (const rawPath of rawPaths) {
				const wildcard = rawPath.indexOf("*");
				if (wildcard >= 0 && path.startsWith(rawPath.slice(0, wildcard)))
					throw new TypeError(`rawWildcardIntersection:${operation.origin}`);
			}
			return Object.freeze({
				...operation,
				method: operation.kind === "query" ? "GET" : "POST",
				operationId: operation.name,
				path,
				tag: operation.name.includes(".")
					? operation.name.split(".")[0]
					: application,
			});
		});
	return Object.freeze({
		included: Object.freeze(included),
		omitted: Object.freeze([]),
	});
}
