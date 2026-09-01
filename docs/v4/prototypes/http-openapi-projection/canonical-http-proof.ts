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
	if (
		kind === "boolean" ||
		kind === "integer" ||
		kind === "bigint" ||
		kind === "numeric" ||
		kind === "uuid" ||
		kind === "date" ||
		kind === "timestamp" ||
		kind === "cursor"
	)
		return String(value);
	return `~json:${withoutCanonicalTerminator(value)}`;
}

export function canonicalOperationPath(
	kind: "action" | "mutation" | "query",
	name: string,
): string {
	if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name)) invalid();
	return `/_questpie/${kind}/${name}`;
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
