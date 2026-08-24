import {
	canonicalJsonLine,
	CanonicalJsonError,
	sha256Digest,
	uuidFromSha256Digest,
} from "../canonical-json";

export function canonicalMutationBytes(value: unknown): Uint8Array {
	try {
		return canonicalJsonLine(value);
	} catch (error) {
		if (!(error instanceof CanonicalJsonError)) throw error;
		if (error.reason === "invalid-number")
			throw new TypeError("Mutation canonical JSON rejects this number", {
				cause: error,
			});
		if (error.reason === "invalid-unicode")
			throw new TypeError("Mutation canonical JSON rejects lone surrogates", {
				cause: error,
			});
		throw new TypeError("Mutation canonical JSON rejects this value", {
			cause: error,
		});
	}
}

export function mutationDigest(bytes: Uint8Array): string {
	return sha256Digest(bytes);
}

export function deterministicUuid(bytes: Uint8Array): string {
	return uuidFromSha256Digest(sha256Digest(bytes));
}
