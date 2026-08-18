import { expect, test } from "bun:test";

import {
	studioArtifactAllowListed,
	studioArtifactPath,
	studioArtifactResponse,
	studioAssetPath,
	studioBundleResponse,
} from "../../packages/runtime/src/application/studio-mount";

/**
 * `docs/v4/beta1-build-spec.md:29` names `apps/studio/` a "minimal same-origin
 * operational projection". Same-origin means the application serves it, and
 * `app.fetch` served exactly one path — the Operation wire — returning
 * NOT_FOUND for everything else. That was an absence, not a prohibition:
 * ADR-0014 says `createApp()` exposes `fetch`, and says nothing about fetch
 * serving one path only.
 *
 * The mount is deliberately a read-only asset surface. It carries no Operation,
 * no durable read, and no application data, so it raises no disclosure question
 * of its own — what Studio may see is decided by what it can call, not by how
 * its bytes arrive.
 */
test("the Studio bundle answers a same-origin GET", async () => {
	const response = await studioBundleResponse(
		new Request(`https://app.example${studioAssetPath}`),
	);
	expect(response).not.toBeNull();
	expect(response!.status).toBe(200);
	expect(response!.headers.get("content-type")).toContain("text/html");
	const body = await response!.text();
	expect(body).toContain("<!doctype html>");
});

test("the mount declines every path that is not its own", async () => {
	for (const path of ["/", "/_questpie/operation", "/_questpie/studio/../x"]) {
		const response = await studioBundleResponse(
			new Request(`https://app.example${path}`),
		);
		expect(response).toBeNull();
	}
});

test("the mount serves reads only", async () => {
	const response = await studioBundleResponse(
		new Request(`https://app.example${studioAssetPath}`, { method: "POST" }),
	);
	expect(response).not.toBeNull();
	expect(response!.status).toBe(405);
});

/**
 * A shell that shows nothing is half an artifact. The page needs the compiled
 * contract to project, and those artifacts are public contract rather than
 * operational fact, so serving them raises no disclosure question — the same
 * reason the explain lane is buildable while the operational reads are not.
 *
 * The allow-list is the safety property. `artifactFiles` also holds the wire
 * contract, the durable kernel contract, and the executable inventory; the
 * mount names the artifacts Studio projects and serves nothing else, so a
 * future artifact cannot become browser-reachable by being added.
 */
const artifactFiles = {
	"manifest.json": '{"application":{"name":"x"}}',
	"operation-contracts.json": '{"operations":[]}',
	"runtime-executables.json": '{"secret":"must not be served"}',
};

test("the mount serves only the allow-listed contract artifacts", async () => {
	const response = await studioArtifactResponse(
		new Request(`https://app.example${studioArtifactPath}`),
		artifactFiles,
	);
	expect(response).not.toBeNull();
	expect(response!.status).toBe(200);
	expect(response!.headers.get("content-type")).toContain("application/json");

	const served = (await response!.json()) as Record<string, unknown>;
	expect(Object.keys(served)).toContain("manifest.json");
	expect(Object.keys(served)).toContain("operation-contracts.json");
	// Needed to explain why a run pinned to retired bytes is not progressing.
	expect(studioArtifactAllowListed).toContain("reaction-projection.json");
	// Present in artifactFiles, absent from the allow-list, so never served.
	expect(Object.keys(served)).not.toContain("runtime-executables.json");
	expect(JSON.stringify(served)).not.toContain("must not be served");
});

test("the artifact path declines writes and unknown paths", async () => {
	const posted = await studioArtifactResponse(
		new Request(`https://app.example${studioArtifactPath}`, { method: "POST" }),
		artifactFiles,
	);
	expect(posted!.status).toBe(405);

	const elsewhere = await studioArtifactResponse(
		new Request("https://app.example/_questpie/operation"),
		artifactFiles,
	);
	expect(elsewhere).toBeNull();
});
