import {
	canonicalJsonLine,
	CanonicalJsonError,
	sha256Digest,
} from "../canonical-json";

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

export function runtimeArtifactDigest(domain: string, value: unknown): string {
	let bytes: Uint8Array;
	try {
		bytes = canonicalJsonLine(value);
	} catch (error) {
		if (!(error instanceof CanonicalJsonError)) throw error;
		if (error.reason === "invalid-number")
			failRuntimeArtifact("invalid number");
		if (error.reason === "invalid-unicode")
			failRuntimeArtifact("invalid Unicode");
		if (error.reason === "cycle")
			failRuntimeArtifact("canonical value contains a cycle");
		failRuntimeArtifact("invalid canonical value");
	}
	return sha256Digest(Buffer.concat([Buffer.from(`${domain}\0`), bytes]));
}
