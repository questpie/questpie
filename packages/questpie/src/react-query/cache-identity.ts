import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

const version = "questpie.query-bootstrap.v1";
export type QueryBootstrap = Readonly<{
	version: typeof version;
	seed: string;
	scope: string;
}>;

/** Client-visible identity material, never authorization or Query result data. */
export function createCacheIdentity(
	canonicalScope: string,
	resume?: QueryBootstrap,
) {
	if (
		resume !== undefined &&
		(resume === null ||
			typeof resume !== "object" ||
			Object.keys(resume).sort().join(",") !== "scope,seed,version" ||
			resume.version !== version ||
			typeof resume.seed !== "string" ||
			!/^[a-f0-9]{64}$/.test(resume.seed) ||
			typeof resume.scope !== "string" ||
			!/^[a-f0-9]{64}$/.test(resume.scope))
	)
		throw new Error("QUERY_BOOTSTRAP_INVALID");
	const seed = resume ? hexToBytes(resume.seed) : randomBytes(32);
	const fingerprint = (parts: readonly string[]) =>
		bytesToHex(
			hmac(sha256, seed, new TextEncoder().encode(JSON.stringify(parts))),
		);
	const scope = fingerprint(["scope", canonicalScope]);
	if (resume && resume.scope !== scope)
		throw new Error("QUERY_BOOTSTRAP_MISMATCH");
	const bootstrap: QueryBootstrap = Object.freeze({
		version,
		seed: bytesToHex(seed),
		scope,
	});
	return Object.freeze({
		prefix: Object.freeze(["questpie", scope]),
		bootstrap,
		key(
			operation: string,
			mode: "query" | "infinite",
			canonical: string,
		): readonly string[] {
			return Object.freeze([
				"questpie",
				scope,
				operation,
				mode,
				fingerprint([mode, operation, canonical]),
			]);
		},
	});
}
