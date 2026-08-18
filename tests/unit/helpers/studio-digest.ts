import {
	canonical,
	projectStudioCatalog,
	projectStudioExplain,
	type StudioArtifactBytes,
} from "../../../apps/studio/src/projection";

/**
 * Canonical digests of the projections, so two producers can be compared for
 * byte parity.
 *
 * Kept out of `projection.ts` because that module runs in the browser as well
 * as in tests, and `Bun.CryptoHasher` exists only under Bun. The projection
 * itself is pure and isomorphic; hashing is a harness concern.
 */
export function studioProjectionDigest(artifacts: StudioArtifactBytes): string {
	return new Bun.CryptoHasher("sha256")
		.update(canonical(projectStudioCatalog(artifacts)))
		.digest("hex");
}

export function studioExplainDigest(artifacts: StudioArtifactBytes): string {
	return new Bun.CryptoHasher("sha256")
		.update(canonical(projectStudioExplain(artifacts)))
		.digest("hex");
}
