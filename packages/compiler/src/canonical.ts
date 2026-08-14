import { createHash } from "node:crypto";

function compareAscii(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			throw new TypeError("canonical JSON rejects non-finite numbers and -0");
		return value;
	}
	if (typeof value !== "object")
		throw new TypeError(`canonical JSON rejects ${typeof value}`);
	if (seen.has(value)) throw new TypeError("canonical JSON rejects cycles");
	seen.add(value);
	try {
		if (Array.isArray(value))
			return value.map((item) => canonicalize(item, seen));
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => compareAscii(left, right))
				.map(([key, item]) => {
					if (item === undefined)
						throw new TypeError(`canonical JSON rejects undefined at ${key}`);
					return [key, canonicalize(item, seen)];
				}),
		);
	} finally {
		seen.delete(value);
	}
}

export function canonicalBytes(value: unknown): string {
	return `${JSON.stringify(canonicalize(value, new Set()))}\n`;
}

export function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0`)
		.update(canonicalBytes(value))
		.digest("hex");
}

export function contentDigest(value: string | Uint8Array): string {
	return createHash("sha256").update(value).digest("hex");
}

export { compareAscii };
