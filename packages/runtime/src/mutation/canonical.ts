import { createHash } from "node:crypto";

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

function render(value: unknown): string {
	if (value === null || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			throw new TypeError("Mutation canonical JSON rejects this number");
		return JSON.stringify(value);
	}
	if (typeof value === "string") {
		if (hasLoneSurrogate(value))
			throw new TypeError("Mutation canonical JSON rejects lone surrogates");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(render).join(",")}]`;
	if (!value || typeof value !== "object")
		throw new TypeError("Mutation canonical JSON rejects this value");
	const record = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(record)
		.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
		.map((key) => {
			if (hasLoneSurrogate(key))
				throw new TypeError("Mutation canonical JSON rejects lone surrogates");
			return `${JSON.stringify(key)}:${render(record[key])}`;
		})
		.join(",")}}`;
}

export function canonicalMutationBytes(value: unknown): Uint8Array {
	return Buffer.from(`${render(value)}\n`);
}

export function mutationDigest(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function deterministicUuid(bytes: Uint8Array): string {
	const digest = createHash("sha256").update(bytes).digest("hex");
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
