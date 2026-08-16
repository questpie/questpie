import {
	canonicalJsonLine,
	CanonicalJsonError,
	sha256Digest,
} from "../canonical-json";

export function canonicalMutationBytes(value: unknown): Uint8Array {
	try {
		return canonicalJsonLine(value);
	} catch (error) {
		if (!(error instanceof CanonicalJsonError)) throw error;
		if (error.reason === "invalid-number")
			throw new TypeError("Mutation canonical JSON rejects this number");
		if (error.reason === "invalid-unicode")
			throw new TypeError("Mutation canonical JSON rejects lone surrogates");
		throw new TypeError("Mutation canonical JSON rejects this value");
	}
}

export function mutationDigest(bytes: Uint8Array): string {
	return sha256Digest(bytes);
}

export function deterministicUuid(bytes: Uint8Array): string {
	const digest = sha256Digest(bytes);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
