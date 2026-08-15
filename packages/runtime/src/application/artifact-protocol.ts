import { createHash } from "node:crypto";

export type RecordValue = Readonly<Record<string, unknown>>;

const digestPattern = /^[0-9a-f]{64}$/;

export function failRuntimeArtifact(message: string): never {
	throw new TypeError(`Invalid Runtime artifact: ${message}`);
}

export function runtimeArtifactRecord(
	value: unknown,
	label: string,
): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		failRuntimeArtifact(`${label} must be an object`);
	return value as RecordValue;
}

export function exactRuntimeArtifactKeys(
	value: RecordValue,
	keys: readonly string[],
	label: string,
): void {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		failRuntimeArtifact(`${label} has invalid keys`);
}

export function runtimeArtifactString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0)
		failRuntimeArtifact(`${label} must be text`);
	return value;
}

export function runtimeArtifactDigestValue(
	value: unknown,
	label: string,
): string {
	const result = runtimeArtifactString(value, label);
	if (!digestPattern.test(result))
		failRuntimeArtifact(`${label} must be a sha256 digest`);
	return result;
}

function hasLoneUnicodeSurrogate(value: string): boolean {
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

function canonicalProtocolBytes(value: unknown): string {
	const active = new Set<object>();
	const encode = (item: unknown): string => {
		if (item === null || typeof item === "boolean") return JSON.stringify(item);
		if (typeof item === "number") {
			if (!Number.isFinite(item) || Object.is(item, -0))
				failRuntimeArtifact("invalid number");
			return JSON.stringify(item);
		}
		if (typeof item === "string") {
			if (hasLoneUnicodeSurrogate(item)) failRuntimeArtifact("invalid Unicode");
			return JSON.stringify(item);
		}
		if (!item || typeof item !== "object")
			failRuntimeArtifact("invalid canonical value");
		if (active.has(item))
			failRuntimeArtifact("canonical value contains a cycle");
		active.add(item);
		let encoded: string;
		if (Array.isArray(item)) encoded = `[${item.map(encode).join(",")}]`;
		else {
			const source = item as RecordValue;
			encoded = `{${Object.keys(source)
				.sort()
				.map((key) => {
					if (hasLoneUnicodeSurrogate(key))
						failRuntimeArtifact("invalid Unicode");
					return `${JSON.stringify(key)}:${encode(source[key])}`;
				})
				.join(",")}}`;
		}
		active.delete(item);
		return encoded;
	};
	return `${encode(value)}\n`;
}

export function runtimeArtifactDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0${canonicalProtocolBytes(value)}`)
		.digest("hex");
}
